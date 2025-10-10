import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { PROMPT_SELECT_CODE_RANGES } from '../config/prompts.js';
import type { CodeRange, GraphState } from '../core/types.js';
import { countNodesQuick, topKTypes } from '../ast/meta.js';
import { env } from '../config/env.js';

/**
 * 코드 단계용 **컨텍스트 창 기반** 토큰 예산을 계산합니다.
 *
 * - CTX에서 출력/오버헤드를 제외하고, CODE_SAFETY 비율을 적용해
 *   코드 조각(code slices)에 할당할 수 있는 안전한 예산을 근사합니다.
 *
 * @param {{question:string; filteredAst:any; pruned:boolean; droppedAll:boolean}} opts
 * @returns {number} 코드 조각에 배정 가능한 토큰 예산
 */
export function calcCodeBudget(opts: {
  question: string;
  filteredAst: any;
  pruned: boolean;
  droppedAll: boolean;
}): number {
  if (env.MODEL_CTX_TOKENS <= 0) return 0;
  const baseOverhead =
    1200 +
    Math.ceil((opts.question?.length ?? 0) / 4) +
    Math.ceil(JSON.stringify({ files: (opts.filteredAst?.files ?? []).slice(0, 200) }).length / 4) +
    200;
  const usable = env.MODEL_CTX_TOKENS - env.OUTPUT_TOKENS_BUDGET - baseOverhead;
  const safe = Math.floor(usable * env.CODE_SAFETY);
  return Math.max(0, safe);
}

/**
 * LangGraph 노드: **프룬된 AST 메타**를 입력으로
 * LLM(또는 데모)에게 **보수적** 코드 라인 범위를 선택시키고 상태에 기록합니다.
 *
 * - LLM 부재 시 데모 정책: 파일 상단 200줄 선택
 * - 반환 형식: {@link CodeRange}[]
 *
 * @param {ChatOpenAI|null} llm OpenAI 챗 모델 인스턴스(없으면 데모 경로)
 * @param {GraphState} state 현재 그래프 상태
 * @returns {Promise<GraphState>} codeRanges가 채워진 새 상태
 */
export async function nodeSelectCodeRanges(llm: ChatOpenAI | null, state: GraphState): Promise<GraphState> {
  const sourceForPlan = state.prunedAsts && state.prunedAsts.length ? state.prunedAsts : state.detailedAsts;
  if (!sourceForPlan.length) {
    return { ...state, codeRanges: [] };
  }

  // LLM 부재 시: 파일당 상단 200줄
  if (!llm || typeof (llm as any).invoke !== 'function') {
    const ranges: CodeRange[] = sourceForPlan
      .slice(0, env.CODE_MAX_FILES > 0 ? env.CODE_MAX_FILES : sourceForPlan.length)
      .map((a) => ({ file: a.filePath, startLine: 1, endLine: 200, rationale: 'demo: first 200 lines' }));
    return { ...state, codeRanges: ranges };
  }

  const system = PROMPT_SELECT_CODE_RANGES;
  const meta = sourceForPlan.map((a) => ({
    file: a.filePath,
    approxNodes: countNodesQuick(a.root),
    topTypes: topKTypes(a.root, 5),
  }));

  const user = JSON.stringify({
    question: state.question,
    filteredAstMeta: { files: (state.filteredAst as any)?.files ?? [] },
    astMeta: meta,
  });

  const resp = await (llm as any).invoke([new SystemMessage(system), new HumanMessage(user)]);
  try {
    const parsed = JSON.parse((resp as any).content);
    const ranges: CodeRange[] = Array.isArray(parsed?.ranges) ? parsed.ranges : [];
    return { ...state, codeRanges: ranges };
  } catch {
    return { ...state, codeRanges: [] };
  }
}
