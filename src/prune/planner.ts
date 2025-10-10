import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { PROMPT_PRUNE_PLAN } from '../config/prompts.js';
import type { GraphState } from '../core/types.js';
import { countNodesQuick, topKTypes } from '../ast/meta.js';

/**
 * LLM 미사용 시에 사용하는 **데모 프루닝 플랜**을 생성합니다.
 *
 * - 기존 sliceHints가 있으면 각 파일에 동일하게 적용합니다.
 * - KEEP_SOME 전략으로 기본 슬라이스를 구성합니다.
 *
 * @param {GraphState} state 현재 상태
 * @returns {any} 프루닝 플랜(JSON)
 */
export function demoPrunePlan(state: GraphState): any {
  const { detailedAsts, sliceHints } = state;
  return {
    mode: 'KEEP_SOME',
    keep_full: [],
    slice: sliceHints
      ? detailedAsts.map((a) => ({
          file: a.filePath,
          by: { ...sliceHints, maxNodes: Math.min(200, sliceHints?.maxNodes ?? 200) },
          paths: [],
        }))
      : [],
    drop: [],
    rationale: 'demo plan by sliceHints',
  };
}

/**
 * LangGraph 노드(내부): LLM을 호출하여 **프루닝 플랜**을 수집합니다.
 * 실패 시 {@link demoPrunePlan}으로 대체합니다.
 *
 * @param {ChatOpenAI|null} llm OpenAI 챗 모델 인스턴스(없으면 데모 경로)
 * @param {GraphState} state 현재 상태 (detailedAsts 필요)
 * @returns {Promise<any>} 프루닝 플랜(JSON)
 */
export async function collectPrunePlan(llm: ChatOpenAI | null, state: GraphState): Promise<any> {
  const { question, filteredAst, detailedAsts } = state;

  if (!llm || typeof (llm as any).invoke !== 'function') {
    return demoPrunePlan(state);
  }

  const meta = detailedAsts.map((d) => ({
    file: d.filePath,
    approxNodes: countNodesQuick(d.root),
    topTypes: topKTypes(d.root, 5),
  }));

  const system = PROMPT_PRUNE_PLAN;
  const user = JSON.stringify({
    question,
    filteredAstMeta: { files: (filteredAst as any)?.files ?? [] },
    files: detailedAsts.map((d) => d.filePath),
    astMeta: meta,
  });

  const resp = await (llm as any).invoke([new SystemMessage(system), new HumanMessage(user)]);
  try {
    return JSON.parse((resp as any).content);
  } catch {
    return demoPrunePlan(state);
  }
}
