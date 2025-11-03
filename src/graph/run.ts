import { compiledGraph, initialState } from './machine.js';
import { env } from '../config/env.js';
import type { GraphState } from '../core/types.js';

export interface RunGraphOptions {
  projectRoot?: string;
  filteredAstPath?: string;
  promptMode?: 'slice' | 'full';
}

/**
 * 질문 한 건을 입력으로 LangGraph 파이프라인 실행
 * (간략 AST → 파일결정 → 상세 AST → PRUNE → 코드 범위 → 코드 로드 → 코드 기반 답변)
 *
 * @param {string} question 사용자 질문
 * @param {RunGraphOptions} [options] 프로젝트 루트/filtered AST 경로 등 실행 옵션
 * @returns {Promise<{answer:string, followups:string[], wantFiles:string[], modeUsed:'slice'|'full', trace?:GraphState['_trace']}>}
 */
export async function runGraph(question: string, options: RunGraphOptions = {}): Promise<{
  answer: string;
  followups: string[];
  wantFiles: string[];
  modeUsed: 'slice' | 'full';
  trace?: GraphState['_trace'];
}> {
  const init = initialState({
    promptMode: options.promptMode ?? env.PROMPT_MODE,
    projectRoot: options.projectRoot,
    filteredAstPath: options.filteredAstPath,
  });
  init.question = question;
  const result = (await compiledGraph.invoke(init)) as GraphState;
  return {
    answer: result.answer,
    followups: result.followups || [],
    wantFiles: result.wantFiles || [],
    modeUsed: (result.modeUsed as 'slice' | 'full') || env.PROMPT_MODE,
    trace: result._trace,
  };
}
