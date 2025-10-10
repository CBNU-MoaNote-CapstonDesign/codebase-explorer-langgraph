import type { DetailedAst, GraphState, PruneTraceItem, SliceHints } from '../core/types.js';
import { sliceDetailedAST, sliceByPaths, isNonEmptySlice } from '../ast/parse.js';
import { estimateTokensForAsts } from '../ast/meta.js';
import { env } from '../config/env.js';

/**
 * **AST 이외 프롬프트 오버헤드**(시스템/질문/메타)를 경험적으로 근사합니다.
 *
 * @param {{question:string; filteredAst:any; pruned:boolean; droppedAll:boolean}} params
 * @returns {number} 오버헤드 토큰 근사
 */
export function estimateFixedPromptTokens(params: {
  question: string;
  filteredAst: any;
  pruned: boolean;
  droppedAll: boolean;
}): number {
  const { question, filteredAst, pruned, droppedAll } = params;

  let base = 1200;
  base += Math.ceil((question?.length ?? 0) / 4);

  const filesArr = Array.isArray(filteredAst?.files) ? filteredAst.files : [];
  const metaStr = JSON.stringify({ files: filesArr.slice(0, 200) });
  base += Math.ceil(metaStr.length / 4);

  if (pruned) base += 50;
  if (droppedAll) base += 30;

  return base;
}

/**
 * **모델 컨텍스트 창 기반** AST 본문 예산을 계산합니다.
 *
 * @param {{question:string; filteredAst:any; pruned:boolean; droppedAll:boolean}} opts
 * @returns {number} AST 본문 예산(토큰)
 */
export function calcAstBudget(opts: {
  question: string;
  filteredAst: any;
  pruned: boolean;
  droppedAll: boolean;
}): number {
  if (env.MODEL_CTX_TOKENS <= 0) return 0;
  const fixed = estimateFixedPromptTokens(opts);
  const usable = env.MODEL_CTX_TOKENS - env.OUTPUT_TOKENS_BUDGET - fixed;
  const safe = Math.floor(usable * env.PROMPT_SAFETY);
  return Math.max(0, safe);
}

/**
 * 간단한 휴리스틱 점수로 **상위 K개 파일만 유지**합니다.
 *
 * @param {DetailedAst[]} asts 대상 AST
 * @param {string} question 사용자 질문
 * @param {number} k 유지할 개수
 * @returns {DetailedAst[]} 상위 K개 AST
 */
export function rankAndTrim(asts: DetailedAst[], question: string, k: number): DetailedAst[] {
  if (k <= 0 || asts.length <= k) return asts;
  const query = (question || '').toLowerCase();
  const score = (a: DetailedAst) => {
    let s = 0;
    if (query && a.filePath.toLowerCase().includes(query)) s += 3;
    const childCount = (a as any).root?.children?.length || 0;
    s += Math.min(3, childCount);
    return s;
  };
  return asts
    .map((a) => ({ a, s: score(a) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, k)
    .map((x) => x.a);
}

/**
 * **토큰 예산 이하**가 될 때까지 파일 단위로 잘라냅니다.
 *
 * @param {DetailedAst[]} asts 입력 AST
 * @param {number} budget 예산(토큰)
 * @returns {DetailedAst[]} 제한된 AST
 */
export function trimToTokenBudget(asts: DetailedAst[], budget: number): DetailedAst[] {
  if (budget <= 0) return asts;
  const out: DetailedAst[] = [];
  let used = 0;
  for (const a of asts) {
    const t = estimateTokensForAsts([a]);
    if (used + t > budget) break;
    out.push(a);
    used += t;
  }
  return out;
}

/**
 * prune 단계 실행 추적을 버퍼에 추가합니다.
 *
 * @param {GraphState['_trace']|undefined} tr 기존 버퍼
 * @param {PruneTraceItem} item 추가 항목
 * @returns {GraphState['_trace']} 갱신된 버퍼
 */
export function pushPruneTrace(tr: GraphState['_trace'] | undefined, item: PruneTraceItem) {
  const base = tr ?? { iterations: 0, filesRequested: [], filesParsed: [] };
  (base as any).prune = (base as any).prune || [];
  (base as any).prune.push(item);
  return base;
}

/**
 * **프루닝 플랜(JSON)** 을 실제 AST에 적용합니다.
 *
 * 처리 순서:
 * 1) DROP_ALL 처리
 * 2) keep_full / slice(by/paths) / drop
 * 3) 서버 상한(파일 수/토큰 예산) 적용
 * 4) 트레이싱 기록 업데이트
 *
 * @param {GraphState} state 현재 상태
 * @param {any} plan 프루닝 플랜(JSON)
 * @returns {GraphState} 적용된 새 상태
 */
export function applyPrunePlan(state: GraphState, plan: any): GraphState {
  const { detailedAsts, question, filteredAst } = state;

  // 1) DROP_ALL
  if (env.PRUNE_ALLOW_DROP_ALL && plan?.mode === 'DROP_ALL') {
    const before = estimateTokensForAsts(detailedAsts);
    return {
      ...state,
      prunedAsts: [],
      prunePlan: plan,
      prunePlanApplied: { mode: 'DROP_ALL' },
      droppedAll: true,
      followups: [],
      _trace: pushPruneTrace(state._trace, {
        mode: 'DROP_ALL',
        plannedFiles: detailedAsts.map((x) => x.filePath),
        keptFiles: [],
        droppedFiles: detailedAsts.map((x) => x.filePath),
        estTokensBefore: before,
        estTokensAfter: 0,
      }),
    };
  }

  // 2) keep/slice/drop
  const keepFull = new Set<string>(plan?.keep_full ?? []);
  const sliceRules = new Map<string, { by?: SliceHints; paths?: string[] }>();
  for (const s of plan?.slice ?? []) sliceRules.set(s.file, { by: s.by, paths: s.paths });
  const dropSet = new Set<string>(plan?.drop ?? []);

  const kept: DetailedAst[] = [];
  const droppedNames: string[] = [];

  for (const ast of detailedAsts) {
    const file = ast.filePath;

    if (dropSet.has(file)) {
      droppedNames.push(file);
      continue;
    }
    if (keepFull.has(file)) {
      kept.push(ast);
      continue;
    }
    const rule = sliceRules.get(file);
    if (rule) {
      let sliced: DetailedAst = ast;
      if (rule.by) sliced = sliceDetailedAST(ast, rule.by);
      if (rule.paths && rule.paths.length) sliced = sliceByPaths(sliced, rule.paths);
      if (isNonEmptySlice(sliced)) {
        kept.push(sliced);
      } else {
        droppedNames.push(file);
      }
      continue;
    }
    // 언급 없는 파일은 제거
    droppedNames.push(file);
  }

  // 3) 상한 강제
  let pruned = kept;
  const before = estimateTokensForAsts(detailedAsts);
  const dynamicBudget = calcAstBudget({
    question,
    filteredAst,
    pruned: true,
    droppedAll: false,
  });

  if (env.PRUNE_SERVER_ENFORCE_LIMITS) {
    if (env.PROMPT_MAX_FILES > 0 && pruned.length > env.PROMPT_MAX_FILES) {
      pruned = rankAndTrim(pruned, question, env.PROMPT_MAX_FILES);
    }
    if (dynamicBudget > 0) {
      pruned = trimToTokenBudget(pruned, dynamicBudget);
    } else if (env.MAX_AST_TOKENS > 0) {
      pruned = trimToTokenBudget(pruned, env.MAX_AST_TOKENS);
    }
  }

  const after = estimateTokensForAsts(pruned);

  // 4) 트레이싱
  return {
    ...state,
    prunedAsts: pruned,
    prunePlan: plan,
    prunePlanApplied: { ...plan, drop: Array.from(new Set([...droppedNames, ...(plan?.drop ?? [])])) },
    droppedAll: pruned.length === 0,
    _trace: pushPruneTrace(state._trace, {
      mode: plan?.mode ?? 'KEEP_SOME',
      plannedFiles: detailedAsts.map((d) => d.filePath),
      keptFiles: pruned.map((p) => p.filePath),
      droppedFiles: detailedAsts.map((d) => d.filePath).filter((f) => !pruned.some((p) => p.filePath === f)),
      estTokensBefore: before,
      estTokensAfter: after,
    }),
  };
}
