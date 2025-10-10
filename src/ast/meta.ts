import type { AstNodeLite, DetailedAst } from '../core/types.js';

/**
 * AST 루트에서 빠르게 노드 수를 샘플링 카운트합니다.
 * @param {AstNodeLite} root AST 루트
 * @param {number} cap 방문 상한
 * @returns {number} 노드 수 근사
 */
export function countNodesQuick(root: AstNodeLite, cap = 5000): number {
  let count = 0;
  const stack: AstNodeLite[] = [root];
  while (stack.length && count < cap) {
    const n = stack.pop()!;
    count++;
    if (n.children) for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]);
  }
  return count;
}

/**
 * 루트에서 등장하는 노드 type의 빈도를 전수 조사하여 상위 K개를 반환합니다.
 * - 전체 순회로 정확한 빈도 산출
 * @param {AstNodeLite} root AST 루트
 * @param {number} k 상위 개수
 * @param {{ stopTypes?: Set<string>; normalize?: (t: string) => string; withCounts?: boolean; }} [opts] 옵션
 * @returns {string[] | {type:string; count:number}[]} 상위 K 타입(또는 타입/카운트)
 */
export function topKTypes(
  root: AstNodeLite,
  k = 5,
  opts?: {
    stopTypes?: Set<string>;
    normalize?: (t: string) => string;
    withCounts?: boolean;
  }
): string[] | { type: string; count: number }[] {
  const stop = opts?.stopTypes ?? new Set<string>();
  const normalize = opts?.normalize ?? ((t: string) => t);

  const freq = new Map<string, number>();
  const stack: AstNodeLite[] = [root];

  while (stack.length) {
    const n = stack.pop()!;
    const t0 = normalize(n.type);
    if (t0 && !stop.has(t0)) {
      freq.set(t0, (freq.get(t0) || 0) + 1);
    }
    if (n.children && n.children.length) {
      for (let i = 0; i < n.children.length; i++) stack.push(n.children[i]);
    }
  }

  const arr = [...freq.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, k);

  return opts?.withCounts ? arr : arr.map((x) => x.type);
}

/**
 * 노드의 sample 길이/노드 수를 재귀 합산합니다.
 * @param {AstNodeLite} node 노드
 * @returns {[number, number]} [총 sample 문자수, 총 노드수]
 */
export function summarizeAst(node: AstNodeLite): [number, number] {
  let c = node.sample ? node.sample.length : 0;
  let n = 1;
  if (node.children) {
    for (const ch of node.children) {
      const [cc, nn] = summarizeAst(ch);
      c += cc;
      n += nn;
    }
  }
  return [c, n];
}

/**
 * (chars/4 + nodes/10) 근사치로 프롬프트 토큰을 추정합니다.
 * @param {DetailedAst[]} asts AST 배열
 * @returns {number} 토큰 근사
 */
export function estimateTokensForAsts(asts: DetailedAst[]): number {
  let chars = 0;
  let nodes = 0;
  for (const a of asts) {
    const [c, n] = summarizeAst(a.root);
    chars += c;
    nodes += n;
  }
  return Math.ceil(chars / 4) + Math.ceil(nodes / 10);
}