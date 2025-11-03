import path from 'path';
import fs from 'fs/promises';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { Trace } from '../core/tracing.js';
import { env } from '../config/env.js';
import type { GraphState, SliceHints } from '../core/types.js';
import { parseFileToAST, loadFilteredAst as loadFilteredAstFile } from '../ast/parse.js';
import { collectPrunePlan } from '../prune/planner.js';
import { applyPrunePlan } from '../prune/apply.js';
import { nodeSelectCodeRanges } from '../code/ranges.js';
import { nodeLoadCodeSlices } from '../code/load.js';
import { nodeAnswerFromCode } from '../code/answer.js';
import { PROMPT_DECIDE_FILES } from '../config/prompts.js';

/** OpenAI Chat 모델 인스턴스. OPENAI_API_KEY가 없으면 null(데모 모드). */
export const llm: ChatOpenAI | null = env.OPENAI_API_KEY
  ? new ChatOpenAI({ model: env.OPENAI_MODEL, apiKey: env.OPENAI_API_KEY })
  : null;

/**
 * 초기 상태 생성 (모드/경로 적용)
 * @param {{promptMode:'slice'|'full'; projectRoot?:string; filteredAstPath?:string}} options 초기 설정
 * @returns {GraphState} 초기 상태
 */
export function initialState(options: {
  promptMode: 'slice' | 'full';
  projectRoot?: string;
  filteredAstPath?: string;
}): GraphState {
  return {
    question: '',
    projectRoot: options.projectRoot,
    filteredAstPath: options.filteredAstPath,
    filteredAst: null,
    wantFiles: [],
    sliceHints: null,
    detailedAsts: [],
    modeUsed: options.promptMode,
    answer: '',
    followups: [],
    _loopCount: 0,
    _trace: { iterations: 0, filesRequested: [], filesParsed: [] },
  };
}

/**
 * LangGraph 노드 집합
 * - 각 메서드에 Trace 데코레이터를 적용해 **필요한 요약 정보만** 로깅합니다.
 */
export class GraphNodes {
  /**
   * (요구사항 1) 간략 AST 로드
   * - state.filteredAstPath가 지정되면 해당 경로를 사용합니다.
   * @param {GraphState} state 현재 상태
   * @returns {Promise<GraphState>} filteredAst가 주입된 새 상태
   */
  @Trace({
    tag: 'nodeLoadFilteredAst',
    pickArgs: ([s]) => ({ q: s?.question.length }),
    pickResult: (o: any) => ({ hasFiles: Array.isArray(o?.filteredAst?.files), fileCount: (o?.filteredAst?.files ?? []).length }),
  })
  static async nodeLoadFilteredAst(state: GraphState): Promise<GraphState> {
    const filteredAstPath = state.filteredAstPath ?? env.FILTERED_AST_PATH;
    const filteredAst = await loadFilteredAstFile(filteredAstPath);
    return { ...state, filteredAst };
  }

  /**
   * 파일 결정 (LLM 또는 데모)
   * - 입력: 질문/이전 파싱 파일 수
   * - 출력: 선택된 파일 수
   * @param {GraphState} state 현재 상태 (filteredAst 필요)
   * @returns {Promise<GraphState>} wantFiles/sliceHints가 채워진 상태
   */
  @Trace({
    tag: 'nodeDecideFiles',
    pickArgs: ([s]) => ({
      q: s?.question.length,
      prevParsed: ((s?._trace?.filesParsed ?? []).flat() as string[]).length,
      droppedAllPrev: !!s?.droppedAll,
    }),
    pickResult: (o: any) => ({ want: (o?.wantFiles ?? []).length }),
  })
  static async nodeDecideFiles(state: GraphState): Promise<GraphState> {
    if (!state.filteredAst) throw new Error('filteredAst missing');

    // LLM 부재 → 데모
    if (!llm || typeof (llm as any).invoke !== 'function') {
      const files = (state.filteredAst?.files || []).filter(
        (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.jsx') || f.endsWith('.js')
      );
      const wantFiles = files.slice(0, 3);
      const sliceHints: SliceHints = {
        symbols: state.question ? [state.question] : [],
        hintTypes: ['function_declaration', 'method_definition'],
        maxNodes: 200,
      };
      const next = { ...state, wantFiles, sliceHints };
      const it = state._trace?.iterations ?? 0;
      const tr = state._trace ?? { iterations: 0, filesRequested: [], filesParsed: [] };
      tr.filesRequested[it] = [...wantFiles];
      next._trace = tr;
      return next;
    }

    const system = PROMPT_DECIDE_FILES;
    const user = JSON.stringify({
      question: state.question,
      filteredAst: state.filteredAst,
      hint: {
        previousParsed: (state._trace?.filesParsed ?? []).flat(),
        droppedAllInLastPrune: !!state.droppedAll,
      },
    });

    const resp = await (llm as any).invoke([new SystemMessage(system), new HumanMessage(user)]);
    let wantFiles: string[] = [];
    let sliceHints: SliceHints | null = null;
    try {
      const parsed = JSON.parse((resp as any).content);
      wantFiles = Array.isArray(parsed.wantFiles) ? parsed.wantFiles : [];
      sliceHints = parsed.sliceHints || null;
    } catch {
      const files = (state.filteredAst?.files || []).filter(
        (f: string) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.jsx') || f.endsWith('.js')
      );
      wantFiles = files.slice(0, 3);
      sliceHints = { symbols: state.question ? [state.question] : [], hintTypes: ['function_declaration'], maxNodes: 200 };
    }

    const next = { ...state, wantFiles, sliceHints };
    const it = state._trace?.iterations ?? 0;
    const tr = state._trace ?? { iterations: 0, filesRequested: [], filesParsed: [] };
    tr.filesRequested[it] = [...wantFiles];
    next._trace = tr;
    return next;
  }

  /**
   * 상세 AST 생성
   * - 입력: 요청 파일 수
   * - 출력: 파싱 성공 파일 수
   * - state.projectRoot가 지정되면 해당 루트를 기준으로 파일을 탐색합니다.
   * @param {GraphState} state 현재 상태 (wantFiles 필요)
   * @returns {Promise<GraphState>} detailedAsts가 채워진 상태
   */
  @Trace({
    tag: 'nodeGetDetailedAsts',
    pickArgs: ([s]) => ({ want: s?.wantFiles ?? [] }),
    pickResult: (o: any) => ({ parsed: (o?.detailedAsts ?? []).length }),
  })
  static async nodeGetDetailedAsts(state: GraphState): Promise<GraphState> {
    const projectRoot = state.projectRoot ?? env.PROJECT_ROOT;
    const files = state.wantFiles || [];
    if (!files.length) {
      const it0 = state._trace?.iterations ?? 0;
      const tr0 = state._trace ?? { iterations: 0, filesRequested: [], filesParsed: [] };
      tr0.filesParsed[it0] = [];
      return { ...state, detailedAsts: [], _trace: tr0 };
    }

    const results: any[] = [];
    const parsedFiles: string[] = [];
    for (const rel of files) {
      const abs = path.resolve(projectRoot, rel);
      try {
        const stat = await fs.stat(abs);
        if (!stat.isFile()) continue;
        const ast = await parseFileToAST(abs, projectRoot);
        results.push(ast);
        parsedFiles.push(ast.filePath);
        
      } catch (e: any) {
        console.warn('Parse error:', rel, e.message);
      }
    }

    const next = { ...state, detailedAsts: results };
    const it = state._trace?.iterations ?? 0;
    const tr = state._trace ?? { iterations: 0, filesRequested: [], filesParsed: [] };
    tr.filesParsed[it] = parsedFiles;
    next._trace = tr;
    return next;
  }

  /**
   * 프루닝: 계획 수집 → 적용
   * - 입력: 상세 AST 개수
   * - 출력: kept 개수, 전체 드랍 여부
   * @param {GraphState} state 현재 상태
   * @returns {Promise<GraphState>} prunedAsts/droppedAll/trace 갱신
   */
  @Trace({
    tag: 'nodePruneAst',
    pickArgs: ([s]) => ({ files: (s?.detailedAsts ?? []).length }),
    pickResult: (o: any) => ({ kept: (o?.prunedAsts ?? []).length, droppedAll: !!o?.droppedAll }),
  })
  static async nodePruneAst(state: GraphState): Promise<GraphState> {
    if (!state.detailedAsts?.length) {
      return { ...state, prunedAsts: [], droppedAll: false };
    }
    const plan = await collectPrunePlan(llm, state);
    return applyPrunePlan(state, plan);
  }

  /**
   * 코드 범위 선택
   * - 입력: pruned/detailed AST 개수 요약
   * - 출력: 범위(ranges) 개수
   * @param {GraphState} state 현재 상태
   * @returns {Promise<GraphState>} codeRanges가 채워진 상태
   */
  @Trace({
    tag: 'nodeSelectCodeRanges',
    pickArgs: ([s]) => ({ pruned: s?.prunedAsts ?? [], total: s?.detailedAsts ?? [] }),
    pickResult: (o: any) => ({ ranges: o?.codeRanges ?? [] }),
  })
  static async nodeSelectCodeRanges(state: GraphState): Promise<GraphState> {
    return nodeSelectCodeRanges(llm, state);
  }

  /**
   * 코드 슬라이스 로드
   * - 입력: 선택된 범위 개수
   * - 출력: 로드된 슬라이스 개수
   * - state.projectRoot가 지정되면 해당 루트에서 파일을 읽습니다.
   * @param {GraphState} state 현재 상태
   * @returns {Promise<GraphState>} codeSlices가 채워진 상태
   */
  @Trace({
    tag: 'nodeLoadCodeSlices',
    pickArgs: ([s]) => ({ ranges: s?.codeRanges ?? [] }),
    pickResult: (o: any) => ({ slices: (o?.codeSlices ?? []).length }),
  })
  static async nodeLoadCodeSlices(state: GraphState): Promise<GraphState> {
    return nodeLoadCodeSlices(state);
  }

  /**
   * 코드 기반 최종 답변
   * - 입력: 코드 슬라이스 개수
   * - 출력: answer 길이
   * @param {GraphState} state 현재 상태
   * @returns {Promise<GraphState>} answer/followups 채워진 상태
   */
  @Trace({
    tag: 'nodeAnswerFromCode',
    pickArgs: ([s]) => ({ slices: s?.codeSlices ?? [] }),
    pickResult: (o: any) => ({ answerLen: (o?.answer ?? '').length }),
  })
  static async nodeAnswerFromCode(state: GraphState): Promise<GraphState> {
    return nodeAnswerFromCode(llm, state);
  }
}

/**
 * 루프 여부 판단
 * - droppedAll이면 반복 금지
 * - followups 문구에 "더/expand" 유사 키워드 없으면 금지
 * - 이미 본 파일만 재요청하면 금지
 *
 * @param {GraphState} state 현재 상태
 * @returns {boolean} true면 반복
 */
export function shouldLoop(state: GraphState): boolean {
  if (state.droppedAll) return false;
  const arr = Array.isArray(state.followups) ? state.followups : [];
  if (arr.length === 0) return false;
  const text = arr.join(' ');
  const wantsMore = /파일|file|module|더|expand|detail/i.test(text);
  if (!wantsMore) return false;

  const parsedAll = new Set((state._trace?.filesParsed ?? []).flat());
  const want = state.wantFiles ?? [];
  const hasNew = want.some((f) => !parsedAll.has(f));
  return hasNew;
}
