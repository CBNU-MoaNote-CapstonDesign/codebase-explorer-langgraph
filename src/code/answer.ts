import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import type { ChatOpenAI } from '@langchain/openai';
import { PROMPT_ANSWER_FROM_CODE, PROMPT_ANSWER_FROM_AST } from '../config/prompts.js';
import type { DetailedAst, GraphState } from '../core/types.js';

/**
 * LangGraph 노드: **코드 중심 최종 답변**을 생성합니다.
 *
 * - 코드 조각(codeSlices)만을 근거로 답변하도록 지시합니다.
 * - LLM이 없으면 데모 응답을 생성합니다.
 *
 * @param {ChatOpenAI|null} llm OpenAI 챗 모델 인스턴스(없으면 데모 경로)
 * @param {GraphState} state 현재 상태( codeSlices 필요 )
 * @returns {Promise<GraphState>} answer/followups가 채워진 새 상태
 */
export async function nodeAnswerFromCode(llm: ChatOpenAI | null, state: GraphState): Promise<GraphState> {
  const { question, prunedAsts, filteredAst, codeSlices = [] } = state;

  if (!llm || typeof (llm as any).invoke !== 'function') {
    const answer =
      `데모(코드 기반):\n- 질문: ${question}\n- 코드 조각 수: ${codeSlices.length}\n` +
      codeSlices
        .slice(0, 2)
        .map((s) => `\n[${s.file}:${s.startLine}-${s.endLine}]\n${s.code.slice(0, 500)}...`)
        .join('\n');
    return { ...state, answer, followups: [] };
  }

  const astMeta = (prunedAsts ?? []).map((a) => ({ file: a.filePath }));
  const system = PROMPT_ANSWER_FROM_CODE;
  const user = JSON.stringify({
    question,
    codeSlices: codeSlices.map((s) => ({
      file: s.file, startLine: s.startLine, endLine: s.endLine, code: s.code, rationale: s.rationale,
    })),
    astMeta,
    filteredAstMeta: { files: (filteredAst as any)?.files ?? [] },
  });

  const resp = await (llm as any).invoke([new SystemMessage(system), new HumanMessage(user)]);
  try {
    const parsed = JSON.parse((resp as any).content);
    return { ...state, answer: parsed.answer || '', followups: parsed.followups || [] };
  } catch {
    return { ...state, answer: (resp as any).content || '(파싱 실패)', followups: [] };
  }
}

/**
 * (옵션) LangGraph 노드: **AST만으로** 답변 생성 (백업 경로)
 *
 * - 프룬 결과가 있으면 우선 사용하고, 없으면 상세 AST 전체를 사용합니다.
 * - 프롬프트 모드는 외부에서 제어합니다.
 *
 * @param {ChatOpenAI|null} llm OpenAI 챗 모델
 * @param {GraphState} state 현재 상태
 * @returns {Promise<GraphState>} answer/followups 채워진 상태
 */
export async function nodeAnswerFromAst(llm: ChatOpenAI | null, state: GraphState): Promise<GraphState> {
  const { question, filteredAst, detailedAsts, sliceHints, prunedAsts, droppedAll } = state;
  const inputAsts: DetailedAst[] = prunedAsts ?? detailedAsts;
  const astsForPrompt: DetailedAst[] =
    !prunedAsts && sliceHints
      ? detailedAsts.map((ast) => ({
          ...ast,
          root: { ...ast.root, children: ast.root.children.slice(0, sliceHints.maxNodes ?? 200) },
        }))
      : inputAsts;

  if (!llm || typeof (llm as any).invoke !== 'function') {
    const answer = `데모(AST 기반): 파일 ${astsForPrompt.length}개 사용`;
    return { ...state, answer, followups: [] };
  }

  const system = PROMPT_ANSWER_FROM_AST;
  const user = JSON.stringify({
    question,
    filteredAst,
    detailedAsts: astsForPrompt,
    pruned: !!prunedAsts,
    droppedAll: !!droppedAll,
  });

  const resp = await (llm as any).invoke([new SystemMessage(system), new HumanMessage(user)]);
  try {
    const parsed = JSON.parse((resp as any).content);
    return { ...state, answer: parsed.answer || '', followups: parsed.followups || [] };
  } catch {
    return { ...state, answer: (resp as any).content || '(파싱 실패)', followups: [] };
  }
}
