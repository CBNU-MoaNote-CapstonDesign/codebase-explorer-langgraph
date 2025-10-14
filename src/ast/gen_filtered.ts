// src/ast/filtered.ts
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import Parser from 'tree-sitter';
import { env } from '../config/env.js';
import { getLanguageByExt } from './languages.js';

/** ---------- 타입들 ---------- */

/** 함수 시그니처(언어 공통) */
export interface FuncSig {
  type: 'function';
  name: string;
  params: string[];
  /** C/C++에서 definition/declaration 등 힌트 */
  where?: string;
}

/** 메서드 시그니처 */
export interface MethodSig {
  type: 'method';
  name: string;
  params: string[];
  where?: string;
}

/** 클래스 시그니처(메서드 포함) */
export interface ClassSig {
  type: 'class';
  name: string;
  methods: MethodSig[];
}

/** 파일별 요약 엔트리 */
export interface FileIndexItem {
  /** PROJECT_ROOT 기준 상대 경로 */
  file: string;
  /** 언어 키(확장자 기반) */
  lang: string;
  /** 시그니처 목록 */
  ast: Array<FuncSig | MethodSig | ClassSig>;
}

/** 필터링(간략) AST 루트 */
export interface FilteredAst {
  root: string;
  files: string[];
  index: FileIndexItem[];
  generatedAt: string;
}

/** ---------- 내부 유틸 ---------- */

/**
 * 간단한 디렉터리 제외 규칙
 */
function isExcluded(p: string): boolean {
  const parts = p.split(path.sep);
  const excludes = [
    'node_modules', '.git', 'out', 'build', 'dist', 'gen', 'generated',
    '__snapshots__', '__fixtures__', '.next', '.turbo',
  ];
  return parts.some((seg) => excludes.includes(seg));
}

/**
 * 프로젝트 전체에서 지원 확장자 파일만 모읍니다.
 * @param {string} dirAbs 절대 경로(프로젝트 루트)
 * @returns {string[]} 파일 절대 경로 목록
 */
function walkSupportedFiles(dirAbs: string): string[] {
  const exts = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.html', '.css',
    '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx',
    '.java', '.kt', '.kts',
  ]);
  const out: string[] = [];
  const stk = [dirAbs];
  while (stk.length) {
    const dir = stk.pop()!;
    if (isExcluded(dir)) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stk.push(full);
      } else {
        const ext = path.extname(e.name).toLowerCase();
        if (exts.has(ext)) out.push(full);
      }
    }
  }
  return out;
}

/** 코드 슬라이스 */
const slice = (code: string, a: number, b: number) => code.slice(a, b);

/**
 * 안전하게 `namedChildren`를 배열로 반환합니다.
 * - 트리시터 노드가 `null/undefined`이거나 `namedChildren`가 없을 때 빈 배열을 반환합니다.
 * - 내부적으로 falsy/undefined 자식들을 걸러냅니다.
 *
 * @param {any} node - Tree-sitter 노드(또는 null/undefined)
 * @returns {any[]} `node.namedChildren`의 안전한 복사본(없으면 빈 배열)
 */
function safeNamedChildren(node: any): any[] {
  const arr = (node && Array.isArray(node.namedChildren) ? node.namedChildren : []) as any[];
  return arr.filter(Boolean);
}

/**
 * DFS로 노드와 모든 자손을 순회합니다(자식은 `namedChildren` 기준).
 * - 스택에 `undefined`가 섞여도 안전하게 무시합니다.
 * - 방문 순서는 후입선출(LIFO) 기반의 전형적인 DFS입니다.
 *
 * @param {any} node - 시작 노드(루트)
 * @param {(n:any) => void} visit - 각 노드를 방문할 때 호출되는 콜백
 * @returns {void}
 */
function walkNamed(node: any, visit: (n: any) => void): void {
  if (!node) return;
  const stack: any[] = [node];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    visit(cur);
    const kids = safeNamedChildren(cur);
    for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
  }
}

/**
 * (self 포함) 하위 노드에서 주어진 조건을 만족하는 **첫 노드**를 찾습니다.
 * - DFS 중 최초로 `pred`가 true가 되는 노드를 반환합니다.
 * - `pred` 내부에서 발생한 에러는 무시하고 탐색을 계속합니다.
 *
 * @param {any} node - 시작 노드(루트)
 * @param {(n:any) => boolean} pred - 찾고자 하는 조건(예: `n.type === 'identifier'`)
 * @returns {any|null} 일치하는 첫 노드 또는 `null`
 */
function findDescendant(node: any, pred: (n: any) => boolean): any | null {
  let found: any | null = null;
  walkNamed(node, (n) => {
    if (found) return;
    try {
      if (pred(n)) found = n;
    } catch {
      /* pred 내부 오류 무시 */
    }
  });
  return found;
}

/**
 * `function_declarator`로부터 함수 이름을 추출합니다(C 버전).
 * - 가능한 식별자 후보( `identifier` / `qualified_identifier` / `field_identifier` )를
 *   하위에서 찾아 가장 먼저 발견되는 것을 이름으로 사용합니다.
 *
 * @param {any} decl - tree-sitter의 `function_declarator` 노드
 * @param {string} code - 원본 소스(슬라이스에 사용)
 * @returns {string} 함수 이름(없으면 빈 문자열)
 */
function getFunctionNameFromDeclarator(decl: any, code: string): string {
  const idNode = findDescendant(
    decl,
    (x) => x?.type === 'identifier' || x?.type === 'qualified_identifier' || x?.type === 'field_identifier'
  );
  return idNode ? code.slice(idNode.startIndex, idNode.endIndex) : '';
}

/**
 * `function_declarator`로부터 함수 이름을 추출합니다(C++ 버전).
 * - 네임스페이스/클래스 한정자(예: `A::m1`, `ns::foo`)를 보존하도록
 *   `qualified_identifier` 우선으로 탐색합니다.
 *
 * @param {any} decl - tree-sitter의 `function_declarator` 노드
 * @param {string} code - 원본 소스(슬라이스에 사용)
 * @returns {string} 함수(또는 메서드) 이름(없으면 빈 문자열)
 */
function getFunctionNameFromDeclaratorCpp(decl: any, code: string): string {
  // 우선 qualified → 그다음 identifier/field_identifier
  const idNode =
    findDescendant(decl, (x) => x?.type === 'qualified_identifier') ||
    findDescendant(decl, (x) => x?.type === 'identifier' || x?.type === 'field_identifier');
  return idNode ? code.slice(idNode.startIndex, idNode.endIndex) : '';
}

/**
 * `function_declarator` 하위의 파라미터 목록을 슬라이스하여 문자열 배열로 반환합니다.
 * - 각 항목은 **원문 토큰**을 그대로 잘라내어 보존합니다(타입/이름/포인터/참조 등).
 * - 파라미터가 없거나 `parameter_list`가 없으면 빈 배열을 반환합니다.
 *
 * @param {any} decl - tree-sitter의 `function_declarator` 노드
 * @param {string} code - 원본 소스
 * @returns {string[]} 파라미터 텍스트 배열 (예: `["int a", "const Foo& b"]`)
 */
function getParamsFromDeclarator(decl: any, code: string): string[] {
  const paramsNode = findDescendant(decl, (x) => x?.type === 'parameter_list');
  if (!paramsNode) return [];
  const out: string[] = [];
  for (const p of safeNamedChildren(paramsNode)) {
    // parameter_declaration
    const s = code.slice(p.startIndex, p.endIndex).trim();
    if (s) out.push(s);
  }
  return out;
}

/** 하위에서 첫 identifier류 텍스트를 찾아 반환(C/C++) */
function findIdentifierText(node: any, code: string): string | null {
  if (!node) return null;
  const stack = [node];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.type === 'identifier' || n.type === 'field_identifier' || n.type === 'type_identifier') {
      return slice(code, n.startIndex, n.endIndex);
    }
    if (n.namedChildren) for (const ch of n.namedChildren) stack.push(ch);
  }
  return null;
}

/** DFS로 모든 매칭 하위 노드를 수집합니다. */
function findAllDescendants(node: any, pred: (n: any) => boolean): any[] {
  const out: any[] = [];
  const st = [node];
  while (st.length) {
    const n = st.pop()!;
    if (pred(n)) out.push(n);
    if (n.namedChildren) for (const ch of n.namedChildren) st.push(ch);
  }
  return out;
}

/** ---------- JS/TS/JSX 시그니처 추출 ---------- */

/**
 * 파라미터 목록을 문자열 배열로 수집(JS/TS)
 * @param paramsNode 파라미터 노드
 * @param code 원본 코드
 */
function getParamsJS(paramsNode: any, code: string): string[] {
  if (!paramsNode) return [];
  return paramsNode.namedChildren.map((param: any) => {
    if (['required_parameter', 'rest_parameter', 'optional_parameter'].includes(param.type)) {
      const idNode = param.childForFieldName?.('name');
      if (idNode) return slice(code, idNode.startIndex, idNode.endIndex);
    }
    return slice(code, param.startIndex, param.endIndex);
  });
}

/**
 * JS/TS/JSX 트리에서 함수/클래스/메서드 시그니처를 추출합니다.
 * @param root 루트 노드
 * @param code 원본 코드
 */
function extractNodeInfoJS(root: any, code: string): Array<FuncSig | ClassSig> {
  let results: Array<FuncSig | ClassSig> = [];

  const visit = (node: any) => {
    // function foo(...) {}
    if (node.type === 'function_declaration') {
      const nameNode = node.childForFieldName?.('name');
      const paramsNode = node.childForFieldName?.('parameters');
      const params = getParamsJS(paramsNode, code);
      if (nameNode) {
        results.push({
          type: 'function',
          name: slice(code, nameNode.startIndex, nameNode.endIndex),
          params,
        });
      }
    }

    // class Foo { method() {} }
    if (node.type === 'class_declaration') {
      const nameNode = node.childForFieldName?.('name');
      const bodyNode = node.childForFieldName?.('body');
      const methods: MethodSig[] = [];
      if (bodyNode) {
        for (const ch of bodyNode.namedChildren) {
          if (ch.type === 'method_definition') {
            const mName = ch.childForFieldName?.('name');
            const mParams = ch.childForFieldName?.('parameters');
            const params = getParamsJS(mParams, code);
            if (mName) methods.push({
              type: 'method',
              name: slice(code, mName.startIndex, mName.endIndex),
              params,
            });
          }
        }
      }
      if (nameNode) {
        results.push({
          type: 'class',
          name: slice(code, nameNode.startIndex, nameNode.endIndex),
          methods,
        });
      }
    }

    // const foo = () => {} / const bar = function() {}
    if (node.type === 'lexical_declaration') {
      for (const decl of node.namedChildren) {
        const idNode = decl.childForFieldName?.('name');
        const initNode = decl.childForFieldName?.('value');
        if (!idNode || !initNode) continue;
        if (['arrow_function', 'function_expression', 'function'].includes(initNode.type)) {
          const paramsNode = initNode.childForFieldName?.('parameters');
          const params = getParamsJS(paramsNode, code);
          results.push({
            type: 'function',
            name: slice(code, idNode.startIndex, idNode.endIndex),
            params,
          });
        }
      }
    }

    for (const ch of node.namedChildren ?? []) visit(ch);
  };

  visit(root);
  return results;
}

/** ---------- C/C++ 시그니처 추출 ---------- */

/**
 * C 소스의 함수 **정의/선언** 시그니처를 추출합니다.
 * - 정의: `function_definition` 아래의 `function_declarator`로 이름/파라미터를 얻습니다.
 * - 선언: `declaration` 아래의 `function_declarator`로 이름/파라미터를 얻습니다.
 * - 클래스/메서드 개념이 없는 C 특성상, 반환은 일반 함수 시그니처(`FuncSig`)만 포함합니다.
 *
 * @param {any} root - tree-sitter C 파서의 루트 노드
 * @param {string} code - 해당 파일의 원본 소스 코드
 * @returns {(FuncSig|MethodSig|ClassSig)[]} 파싱된 시그니처 목록 (C에서는 실질적으로 FuncSig 배열)
 */
function extractFunctionsC(root: any, code: string): Array<FuncSig | MethodSig | ClassSig> {
  const out: Array<FuncSig | MethodSig | ClassSig> = [];

  walkNamed(root, (n) => {
    // 함수 정의: function_definition
    if (n?.type === 'function_definition') {
      const decl = findDescendant(n, (x) => x?.type === 'function_declarator');
      if (decl) {
        const name = getFunctionNameFromDeclarator(decl, code);
        const params = getParamsFromDeclarator(decl, code);
        out.push({ type: 'function', where: 'definition', name, params });
      }
      return;
    }

    // 함수 선언: declaration 안의 function_declarator
    if (n?.type === 'declaration') {
      const fdecl = findDescendant(n, (x) => x?.type === 'function_declarator');
      if (fdecl) {
        const name = getFunctionNameFromDeclarator(fdecl, code);
        const params = getParamsFromDeclarator(fdecl, code);
        out.push({ type: 'function', where: 'declaration', name, params });
      }
      return;
    }
  });

  return out;
}

/**
 * C++ 소스의 함수/메서드 시그니처를 추출합니다.
 * - 자유 함수 정의/선언은 C와 동일하게 `function_declarator` 기반으로 추출합니다.
 * - 클래스 내부 메서드 선언(`class_specifier` 내부)과
 *   클래스 외부에서의 한정자(qualified) 정의(`A::m1`)도 처리할 수 있도록
 *   이름 해석 단계에서 qualifier를 보존하는 파서를 사용하세요.
 *
 * @param {any} root - tree-sitter C++ 파서의 루트 노드
 * @param {string} code - 해당 파일의 원본 소스 코드
 * @returns {(FuncSig|MethodSig|ClassSig)[]} 파싱된 시그니처 목록
 */
function extractFunctionsCpp(root: any, code: string): Array<FuncSig | MethodSig | ClassSig> {
  const out: Array<FuncSig | MethodSig | ClassSig> = [];

  walkNamed(root, (n) => {
    if (!n) return;

    // 함수 정의
    if (n.type === 'function_definition') {
      const decl = findDescendant(n, (x) => x?.type === 'function_declarator');
      if (decl) {
        // C++의 경우, 네임스페이스/클래스 한정자(A::m1 등) 보존
        const name = getFunctionNameFromDeclaratorCpp(decl, code);
        const params = getParamsFromDeclarator(decl, code);
        out.push({ type: 'function', where: 'definition', name, params });
      }
      return;
    }

    // 함수 선언
    if (n.type === 'declaration') {
      const fdecl = findDescendant(n, (x) => x?.type === 'function_declarator');
      if (fdecl) {
        const name = getFunctionNameFromDeclaratorCpp(fdecl, code);
        const params = getParamsFromDeclarator(fdecl, code);
        out.push({ type: 'function', where: 'declaration', name, params });
      }
      return;
    }

    // (선택) 클래스/메서드 선언도 여기서 추출 가능
    // class_specifier 내부의 method 선언 등을 처리하려면
    // 필요 시 `ClassSig`/`MethodSig` 구성 로직을 추가하세요.
  });

  return out;
}

/**
 * C/C++ 파라미터 목록을 문자열 배열로 수집
 * @param paramListNode parameter_list 노드
 * @param code 원본 코드
 */
function getParamsC(paramListNode: any, code: string): string[] {
  if (!paramListNode) return [];
  const out: string[] = [];
  for (const ch of paramListNode.namedChildren ?? []) {
    if (ch.type === 'parameter_declaration' || ch.type === 'optional_parameter_declaration') {
      out.push(slice(code, ch.startIndex, ch.endIndex).replace(/\s+/g, ' ').trim());
    }
  }
  return out;
}

function extractClassesCPP(root: any, code: string): ClassSig[] {
  const classes: ClassSig[] = [];

  walkNamed(root, (n) => {
    if (!n) return;
    if (n.type !== 'class_specifier' && n.type !== 'struct_specifier') return;

    const name = findIdentifierText(n, code) || '(anonymous)';
    const methods: MethodSig[] = [];

    // class body 내부의 method 선언 추출
    const body = n.childForFieldName?.('body');
    if (body) {
      for (const ch of safeNamedChildren(body)) {
        // method_definition 또는 선언부(method_declaration-like)
        if (ch.type === 'function_definition' || ch.type === 'declaration') {
          const decl = findDescendant(ch, (x) => x?.type === 'function_declarator');
          if (decl) {
            const mname = getFunctionNameFromDeclaratorCpp(decl, code);
            const params = getParamsFromDeclarator(decl, code);
            if (mname) methods.push({ type: 'method', where: ch.type === 'function_definition' ? 'definition' : 'declaration', name: mname, params });
          }
        }
        // C++에서 클래스 내부 순수 method 선언 노드가 별도 타입으로 들어오는 경우 대비
        if (ch.type === 'field_declaration') {
          const fdecl = findDescendant(ch, (x) => x?.type === 'function_declarator');
          if (fdecl) {
            const mname = getFunctionNameFromDeclaratorCpp(fdecl, code);
            const params = getParamsFromDeclarator(fdecl, code);
            if (mname) methods.push({ type: 'method', where: 'declaration', name: mname, params });
          }
        }
      }
    }

    classes.push({ type: 'class', name, methods });
  });

  return classes;
}

/** ---------- 메인 빌드 루틴 ---------- */

/**
 * 단일 파일을 파싱하고, 언어에 맞춰 함수/클래스 시그니처를 추출합니다.
 * @param {string} fileAbs 파일 절대 경로
 * @returns {FileIndexItem|null} 파일 인덱스 항목(없으면 null)
 */
export function parseOneForFiltered(fileAbs: string): FileIndexItem | null {
  const ext = path.extname(fileAbs).toLowerCase();
  const lang = getLanguageByExt(ext);
  if (!lang) return null;

  const parser = new Parser();
  parser.setLanguage(lang);

  const code = fs.readFileSync(fileAbs, 'utf8');
  const tree = parser.parse(code);

  let items: Array<FuncSig | MethodSig | ClassSig> = [];
  // JS/TS/JSX
  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
    items = extractNodeInfoJS(tree.rootNode, code);
  }
  // C
  else if (ext === '.c' || (ext === '.h' && !env.C_HEADER_AS_CPP)) {
    items = extractFunctionsC(tree.rootNode, code);
  }
  // C++
  else if (['.cc', '.cpp', '.cxx', '.hh', '.hpp', '.hxx'].includes(ext) || (ext === '.h' && env.C_HEADER_AS_CPP)) {
    const funcs = extractFunctionsC(tree.rootNode, code);
    const clazz = extractClassesCPP(tree.rootNode, code);
    items = [...funcs, ...clazz];
  }
  // HTML/CSS는 시그니처 없음 → 빈 배열

  return {
    file: path.relative(env.PROJECT_ROOT, fileAbs).replaceAll('\\', '/'),
    lang: ext.replace('.', ''), // 간단 표기
    ast: items,
  };
}

/**
 * 프로젝트 전체를 스캔해 **filtered AST**(간략 인덱스)를 생성합니다.
 * @param {string} projectRoot 프로젝트 루트(절대 경로)
 * @returns {Promise<FilteredAst>} filtered_ast 모델
 */
export async function buildFilteredAst(projectRoot: string): Promise<FilteredAst> {
  const filesAbs = walkSupportedFiles(projectRoot);
  const index: FileIndexItem[] = [];

  for (const abs of filesAbs) {
    try {
      const item = parseOneForFiltered(abs);
      if (item) index.push(item);
    } catch (e: any) {
      console.warn(`[filtered] parse error at ${abs}: ${e?.message || e}`);
    }
  }

  index.sort((a, b) => a.file.localeCompare(b.file));
  const files = index.map((x) => x.file);

  return {
    root: projectRoot,
    files,
    index,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * `FILTERED_AST_PATH` 위치에 filtered_ast를 기록합니다.
 * @param {FilteredAst} fa 결과 모델
 * @returns {Promise<void>}
 */
export async function writeFilteredAst(fa: FilteredAst): Promise<void> {
  await fsp.mkdir(path.dirname(env.FILTERED_AST_PATH), { recursive: true });
  await fsp.writeFile(env.FILTERED_AST_PATH, JSON.stringify(fa, null, 2), 'utf8');
}

/**
 * 서버 부트 전에 filtered_ast가 없으면 생성합니다.
 * - 존재하면 스킵
 * - 강제 재생성(`REGENERATE_FILTERED=1`)이면 항상 재생성
 * @returns {Promise<void>}
 */
export async function ensureFilteredAst(): Promise<void> {
  const force = String(process.env.REGENERATE_FILTERED || '0') === '1';
  try {
    if (!force) {
      await fsp.access(env.FILTERED_AST_PATH, fs.constants.F_OK);
      return; // 이미 있음 → 스킵
    }
  } catch {
    // not exists → 생성으로 진행
  }
  const fa = await buildFilteredAst(env.PROJECT_ROOT);
  await writeFilteredAst(fa);
  console.log(`[filtered] generated at ${env.FILTERED_AST_PATH} (files=${fa.files.length})`);
}
