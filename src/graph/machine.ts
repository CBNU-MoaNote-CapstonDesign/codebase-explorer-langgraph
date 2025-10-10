import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { env } from '../config/env.js';
import type { GraphState } from '../core/types.js';
import { GraphNodes, initialState, shouldLoop } from './nodes.js';

/**
 * LangGraph 채널(상태 스키마) 정의
 * - core/types 의 GraphState 구조와 1:1로 대응
 */
export const State = Annotation.Root({
  question:          Annotation<string>(),
  filteredAst:       Annotation<any | null>(),
  wantFiles:         Annotation<string[]>(),
  sliceHints:        Annotation<any | null>(),
  detailedAsts:      Annotation<any[]>(),
  modeUsed:          Annotation<'slice' | 'full'>(),
  answer:            Annotation<string>(),
  followups:         Annotation<string[]>(),
  _loopCount:        Annotation<number>(),
  prunedAsts:        Annotation<any[] | undefined>(),
  prunePlan:         Annotation<any | undefined>(),
  prunePlanApplied:  Annotation<any | undefined>(),
  droppedAll:        Annotation<boolean | undefined>(),
  codeRanges:        Annotation<any[] | undefined>(),
  codeSlices:        Annotation<any[] | undefined>(),
  _trace:            Annotation<any | undefined>(),
});

/**
 * 그래프 구성 및 컴파일
 * - 간략 AST → 파일결정 → 상세 AST → PRUNE → 코드 범위 → 코드 로드 → 코드 기반 답변
 */
export const graph = new StateGraph(State)
  .addNode('load_filtered',      GraphNodes.nodeLoadFilteredAst as any)
  .addNode('decide_files',       GraphNodes.nodeDecideFiles as any)
  .addNode('get_details',        GraphNodes.nodeGetDetailedAsts as any)
  .addNode('prune_ast',          GraphNodes.nodePruneAst as any)
  .addNode('select_code_ranges', GraphNodes.nodeSelectCodeRanges as any)
  .addNode('load_code_slices',   GraphNodes.nodeLoadCodeSlices as any)
  .addNode('answer_from_code',   GraphNodes.nodeAnswerFromCode as any)
  .addEdge(START,                 'load_filtered')
  .addEdge('load_filtered',       'decide_files')
  .addEdge('decide_files',        'get_details')
  .addEdge('get_details',         'prune_ast')
  .addEdge('prune_ast',           'select_code_ranges')
  .addEdge('select_code_ranges',  'load_code_slices')
  .addEdge('load_code_slices',    'answer_from_code')
  .addConditionalEdges('answer_from_code', (state: any) =>
    shouldLoop(state) ? 'decide_files_again' : END
  )
  .addNode('decide_files_again', async (state: any) => {
    const next = await GraphNodes.nodeDecideFiles(state as GraphState);
    (next as GraphState)._loopCount = ((state as GraphState)._loopCount || 0) + 1;

    const tr = (next as GraphState)._trace ?? { iterations: 0, filesRequested: [], filesParsed: [] };
    tr.iterations = (tr.iterations || 0) + 1;

    const parsedAll = new Set((tr.filesParsed ?? []).flat());
    const filtered = (next as GraphState).wantFiles.filter((f) => !parsedAll.has(f));
    (next as GraphState).wantFiles = filtered;

    if (filtered.length === 0) (next as GraphState).followups = [];
    (next as GraphState)._trace = tr;
    return next;
  })
  .addEdge('decide_files_again', 'get_details');

export const compiledGraph = graph.compile();
export { initialState };
