# LangGraph AST Explorer Server

LLM이 **필터링된 AST → 상세 AST → (선택적) 프루닝 → 코드 스니펫 → 최종 답변**까지 **능동적으로 탐색**하는 서버입니다.

* **Tree-sitter**로 C/CPP/JAVA/KTS/JS/TS/TSX/JSX/HTML/CSS를 파싱
* **LangGraph**로 탐색 플로우 구성
* **두 단계 프롬프트**(AST 기반 소스 코드 후보 선정 → 실제 코드 스니펫 기반 답변)
* **Pruning(가지치기)**로 불필요한 AST를 줄이고 **모델 컨텍스트 창** 고려한 소스 코드 탐색 및 수집
* **Trace 데코레이터**로 LangGraph 내의 계획 과정 출력으로 이해하기 쉬운 동작

---

## 🚀 빠른 시작

### Requirements
- node (>=18)
- npm

### 1) 설치

```bash
npm i
npm i -D
```

### 2) Tree-sitter 언어

> 현재 코드는 C/CPP/JAVA/KTS/JS/TS/TSX/JSX/HTML/CSS/PY 지원 (구버전 파서를 이용하여 비교적 최근 문법은 파싱을 하지 못할 수 있습니다)

이미 `tree-sitter-*` 패키지를 사용 중이라 추가 빌드는 필요 없습니다.
만약 다른 언어를 추가하려면 해당 grammar 패키지를 설치 후 `ast/parse.ts` 의 `getLanguageByExt`에 매핑을 추가하세요.

### 3) 빌드

```bash
npm run build      # "rm -r dist && tsc -p tsconfig.json"
```

### 4) 세팅
```
# .env
# 탐색할 프로젝트가 위치한 디렉토리
# 예를 들어 codebase-explorer/target-project 에 위치하여있다면, `PROJECT_ROOT = ./target-project`
PROJECT_ROOT= <codebase-explorer 프로젝트 루트 디렉토리 대비 상대 경로>


# 프로젝트 파싱 결과가 생성될 위치 (LLM 의 추론 레퍼런스에 쓰입니다)
# 예를 들어 `FILTERED_AST_PATH= ./filtered_ast.json` 으로 충분합니다. 해당 위치에 이미 파일이 있다면 삭제해주세요.
FILTERED_AST_PATH= <임의의 위치>


# API 키
OPENAI_API_KEY= <OPENAI_API_KEY>
```

PROJECT_ROOT 에 탐색하고자 하는 프로젝트 디렉토리를 위치해주세요.

---
### 5) 실행
```bash
npm run start
```

## 데모 사용 시 참고
- 스탠드얼론으로 쓸 수 있게 한 UI 는 임시로 만든 것입니다 (GPT 로 만든거라 질문 답변 기능은 동작하는데 나머지는 신경안써도 됩니다)
- 예를 들어 연속적인 대화는 아직 불가능 (후속 질문 버튼도 그래서 의미가 없습니다)
- 정상적으로 동작하지 않는 언어가 있을 수 있습니다
- 로컬에서 tree-sitter 를 통해 컴파일하기 어려운 사이즈의 프로젝트 대상으로는 안될 수 있습니다
- 각 언어 별 문법 패키지가 구버전이라 최신 언어 문법은 파싱하지 못할 수 있습니다

## 🧪 cURL 예시

### 헬스체크

```bash
curl -s http://localhost:3000/health | jq
```

### 간략 AST 확인 (요구사항 1)

```bash
curl -s http://localhost:3000/ast/filtered | jq
```

### 상세 AST 생성 (요구사항 3)

```bash
curl -s -X POST http://localhost:3000/ast/detailed \
  -H "Content-Type: application/json" \
  -d '{"files":["src/components/document/CodeEditor.tsx","src/components/document/MarkdownEditor.tsx"]}' | jq
```

### LangGraph 한 번에 수행 (/graph/ask)

```bash
curl -s -X POST http://localhost:3000/graph/ask \
  -H "Content-Type: application/json" \
  -d '{"question":"이 프로젝트에서 편집기 관련 컴포넌트를 모두 알려줘","projectPath":"./project"}' | jq
```

---

## 🧠 파이프라인 개요 (LangGraph)

1. **`load_filtered`**: 요청별 생성된 `filtered_ast.json` 로드
2. **`decide_files`**: 질문과 간략 AST로 **확대할 파일 결정**(LLM or 데모)
3. **`get_details`**: tree-sitter로 **상세 AST 생성**
4. **`prune_ast`**: LLM 계획 수집 → 서버에서 **keep_full/slice/paths/drop** 적용 (컨텍스트 창 고려)
5. **`select_code_ranges`**: (2-스테이지) AST 메타로 **코드 라인 범위** 보수적으로 선택
6. **`load_code_slices`**: 실제 **소스코드 스니펫 로드**
7. **`answer_from_code`**: 코드 스니펫 기반 최종 답변 생성

> 반복은 `MAX_LOOPS`와 `shouldLoop()` 조건을 만족할 때만 1회 추가 탐색.

---

## ✂️ Pruning(가지치기)

* **planner**: LLM이 `DROP_ALL | KEEP_SOME | KEEP_MIN` 전략과 파일별 `keep_full`/`slice`/`paths`/`drop` 계획을 JSON으로 반환
* **apply**: 서버가 계획을 적용하고, 필요 시

  * `PROMPT_MAX_FILES`
  * `MODEL_CTX_TOKENS`, `OUTPUT_TOKENS_BUDGET`, `PROMPT_SAFETY`에 따른 **AST 토큰 예산**
  * (옵션) `MAX_AST_TOKENS`
    를 사용해 추가 컷팅합니다.
* **topKTypes**, **estimateTokensForAsts**, **calcAstBudget** 등 유틸로 설명 가능한 정책 제공

---

## 🧩 두 단계 프롬프트

1. **AST 기반 후보 선정**

   * 관련 파일 및 (선택) AST 경로/타입 기반 슬라이스
   * 필요 시 `DROP_ALL`로 상세 AST 무시

2. **실제 코드 스니펫 기반 답변**

   * 1단계 결과로 선택된 라인 범위를 가져와 LLM에 입력
   * 코드가 장문일 경우 `CODE_MAX_BYTES` 또는 파일 수 제한으로 컷팅

---

## 🔍 Trace 데코레이터 (핵심 인자만 로깅)

`src/core/tracing.ts`의 `@Trace`는 아래 옵션을 지원합니다.

* `tag`: 로그 태그(기본: 메서드명)
* `pickArgs(args)`: **원하는 인자만** 가공해서 출력
* `argIndices: number[]`: 특정 인덱스 인자만 출력
* `pickResult(result)`: 결과의 일부만 출력

```ts
@Trace({ tag: 'nodeDecideFiles', pickArgs: ([s]) => ({ q: s.question }), pickResult: (o: any) => ({ want: o?.wantFiles?.length ?? 0 }) })
static async nodeDecideFiles(state: GraphState) { ... }
```

.env:

* `TRACE_LANGGRAPH=1` 활성화
* `TRACE_MAX_JSON=2000` 길이 제한

## 현재 인지 중인 한계점

- 아주 큰 규모의 코드베이스에서는 (예를 들어 chromium 이나 linux kernel) 코드베이스 전체 ast 를 이용하여 탐색 목표를 정하기 어려움
- C/C++ 언어는 전처리기 이후에 파싱하는 언어인데, 현재 프로젝트는 전처리기 도구가 없어서 올바른 참조 추적이 어려울 수 있음
- C++ 코드베이스에서도 `.h` 확장자를 사용하는 경우에 C 파서를 이용하는 문제
- 큰 코드베이스를 대상으로는 증분 파싱이 성능에 크게 유리할 것으로 보이나, 현재 코드는 증분 파싱을 지원하지 않음