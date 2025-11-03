/** tree-sitter의 위치 정보 */
export type Position = { row: number; column: number };

/** 간략화된 AST 노드(프롬프트 친화) */
export interface AstNodeLite {
  type: string;
  startPosition: Position;
  endPosition: Position;
  sample: string;
  children: AstNodeLite[];
}

/** 상세 AST(파일 단위) */
export interface DetailedAst {
  filePath: string; // 서버 실행 위치 기준 상대 경로
  language: string; // tree-sitter 언어명
  root: AstNodeLite;
}

/** 상세 AST 슬라이싱 힌트 */
export interface SliceHints {
  symbols?: string[];
  hintTypes?: string[];
  maxNodes?: number;
}

/** 코드 범위(LLM이 선택) */
export interface CodeRange {
  file: string;      // 서버 실행 위치 기준 상대 경로
  startLine: number; // 1-based inclusive
  endLine: number;   // 1-based inclusive
  rationale?: string;
}

/** 코드 슬라이스(서버가 로드) */
export interface CodeSlice {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  rationale?: string;
}

/** 프롬프트 모드 */
export type PromptMode = 'slice' | 'full';

/** Prune 단계 추적 항목 */
export interface PruneTraceItem {
  mode: 'DROP_ALL' | 'KEEP_SOME' | 'KEEP_MIN';
  plannedFiles: string[];
  keptFiles: string[];
  droppedFiles: string[];
  estTokensBefore: number;
  estTokensAfter: number;
}

/** 실행 추적 버퍼 */
export interface TraceBuffer {
  iterations: number;
  filesRequested: string[][];
  filesParsed: string[][];
  prune?: PruneTraceItem[];
}

/**
 * LangGraph 전체 파이프라인에서 공유하는 상태 모델
 * - prune/코드 단계 산출물 포함
 */
export type GraphState = {
  question: string;
  projectRoot?: string;
  filteredAstPath?: string;
  filteredAst: any | null;
  wantFiles: string[];
  sliceHints: SliceHints | null;
  detailedAsts: DetailedAst[];
  modeUsed: PromptMode;
  answer: string;
  followups: string[];
  _loopCount: number;

  prunedAsts?: DetailedAst[];
  prunePlan?: any;
  prunePlanApplied?: any;
  droppedAll?: boolean;

  codeRanges?: CodeRange[];
  codeSlices?: CodeSlice[];

  _trace?: TraceBuffer;
};
