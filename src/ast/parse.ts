import fs from 'fs/promises';
import path from 'path';
import Parser from 'tree-sitter';
import { getLanguageByExt } from './languages.js';
import { env } from '../config/env.js';
import type { AstNodeLite, DetailedAst, SliceHints } from '../core/types.js';

/**
 * 소스 파일을 tree-sitter로 파싱하여 간결한 JSON AST를 생성합니다.
 * 각 노드에는 type/position과 최대 200자의 sample 코드가 포함됩니다.
 * @param {string} absFilePath 절대 경로의 소스 파일 경로
 * @returns {Promise<DetailedAst>} 파일 상대경로, 언어명, 루트 노드를 포함한 AST JSON
 * @throws {Error} 미지원 확장자 또는 파일 접근/파싱 에러
 */
export async function parseFileToAST(absFilePath: string): Promise<DetailedAst> {
  const code = await fs.readFile(absFilePath, 'utf8');
  const parser = new Parser();
  const ext = path.extname(absFilePath).toLowerCase();
  const lang = getLanguageByExt(ext);
  if (!lang) throw new Error(`Unsupported extension: ${ext} (${absFilePath})`);
  parser.setLanguage(lang);

  const tree = parser.parse(code);

  /** 내부 재귀: tree-sitter 노드를 간결한 JSON으로 변환 */
  function nodeToJSON(node: any, text: string): AstNodeLite {
    const obj: AstNodeLite = {
      type: node.type,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      sample: text.slice(node.startIndex, Math.min(node.endIndex, node.startIndex + 200)),
      children: [],
    };
    for (let i = 0; i < node.namedChildCount; i++) {
      obj.children.push(nodeToJSON(node.namedChild(i), text));
    }
    return obj;
  }

  return {
    filePath: path.relative(env.PROJECT_ROOT, absFilePath).replaceAll('\\', '/'),
    language: (lang as any).name,
    root: nodeToJSON(tree.rootNode, code),
  };
}

/**
 * 상세 AST에서 심볼/타입 힌트를 기준으로 관련 노드만 추출(슬라이싱)합니다.
 * @param {DetailedAst} fullAst 전체 상세 AST
 * @param {SliceHints} options 슬라이스 조건
 * @returns {DetailedAst} 추출된 노드만 포함한 AST
 */
export function sliceDetailedAST(fullAst: DetailedAst, { symbols = [], hintTypes = [], maxNodes = 200 }: SliceHints): DetailedAst {
  const results: AstNodeLite[] = [];
  function dfs(node: AstNodeLite): void {
    if (results.length >= maxNodes) return;
    const matchByType = hintTypes.length ? hintTypes.includes(node.type) : false;
    const matchBySymbol = symbols.length ? symbols.some((sym) => node.sample && node.sample.includes(sym)) : false;
    if (matchByType || matchBySymbol) results.push(node);
    if (node.children) node.children.forEach(dfs);
  }
  dfs(fullAst.root);
  return {
    ...fullAst,
    root: { type: 'root', startPosition: { row: 0, column: 0 }, endPosition: { row: 0, column: 0 }, sample: '', children: results },
  };
}


/**
 * "0.3.2" 같은 경로 인덱스로 서브트리를 뽑아, 선택된 노드들만 루트 children에 담아 반환합니다.
 * @param {DetailedAst} ast 상세 AST
 * @param {string[]} paths 경로 문자열 배열
 * @returns {DetailedAst} 경로에 해당하는 서브트리만 담긴 AST
 */
export function sliceByPaths(ast: DetailedAst, paths: string[]): DetailedAst {
  const picked: AstNodeLite[] = [];
  const getNodeByPath = (node: AstNodeLite, indices: number[]): AstNodeLite | null => {
    let cur: AstNodeLite | null = node;
    for (const idx of indices) {
      if (!cur || !cur.children || idx < 0 || idx >= cur.children.length) return null;
      cur = cur.children[idx];
    }
    return cur;
  };
  for (const p of paths || []) {
    const parts = p.split('.').filter(Boolean);
    const idxs = parts.map((s) => Number(s)).filter((n) => Number.isInteger(n));
    if (idxs.length !== parts.length) continue;
    const found = getNodeByPath(ast.root, idxs);
    if (found) picked.push(found);
  }
  const out: DetailedAst = {
    ...ast,
    root: {
      type: 'root',
      startPosition: { row: 0, column: 0 },
      endPosition: { row: 0, column: 0 },
      sample: '',
      children: picked,
    },
  };
  return out;
}


/**
 * 파일에 저장된 필터링(간략) AST JSON을 로드합니다.
 * [TODO]
 */
export async function loadFilteredAst(filePath: string): Promise<any> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * 슬라이스가 비었는지(유지된 자식 노드가 있는지) 판단합니다.
 * @param {DetailedAst} ast 상세 AST
 * @returns {boolean} 비어있지 않으면 true
 */
export function isNonEmptySlice(ast: DetailedAst): boolean {
  return Array.isArray((ast as any).root?.children) && (ast as any).root.children.length > 0;
}
