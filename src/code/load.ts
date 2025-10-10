import fs from 'fs/promises';
import path from 'path';
import type { CodeSlice, GraphState } from '../core/types.js';
import { env } from '../config/env.js';

/**
 * 파일에서 특정 라인 범위를 1-based(포함/포함)로 읽어 문자열을 반환합니다.
 * 범위는 자동으로 [1..length] 내로 클램프되며, 실패 시 null을 반환합니다.
 *
 * @param {string} absPath 절대 경로
 * @param {number} lineStart 시작 라인(1-based, inclusive)
 * @param {number} lineEnd 끝 라인(1-based, inclusive)
 * @returns {Promise<string|null>} 범위 문자열 또는 null
 */
export async function readFileLines(absPath: string, lineStart: number, lineEnd: number): Promise<string | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const s = Math.max(1, lineStart | 0);
    const e = Math.max(s, lineEnd | 0);
    return lines.slice(s - 1, e).join('\n');
  } catch {
    return null;
  }
}

/**
 * LangGraph 노드: 선택된 코드 라인 범위를 실제 파일에서 읽어
 * {@link CodeSlice} 배열을 구성하고 상태에 기록합니다.
 *
 * - CODE_MAX_FILES, CODE_MAX_BYTES 상한이 적용됩니다.
 * - MAX_CODE_TOKENS가 설정된 경우, 근사 토큰 기준으로 자릅니다.
 *
 * @param {GraphState} state 현재 상태( codeRanges 필요 )
 * @returns {Promise<GraphState>} codeSlices가 채워진 새 상태
 */
export async function nodeLoadCodeSlices(state: GraphState): Promise<GraphState> {
  const ranges = state.codeRanges ?? [];
  if (!ranges.length) return { ...state, codeSlices: [] };

  const picked = env.CODE_MAX_FILES > 0 ? ranges.slice(0, env.CODE_MAX_FILES) : ranges;

  const slices: CodeSlice[] = [];
  let totalBytes = 0;

  for (const r of picked) {
    const abs = path.resolve(env.PROJECT_ROOT, r.file);
    const code = await readFileLines(abs, r.startLine, r.endLine);
    if (code == null) continue;

    const bytes = Buffer.byteLength(code, 'utf8');
    if (env.CODE_MAX_BYTES > 0 && totalBytes + bytes > env.CODE_MAX_BYTES) break;

    slices.push({ file: r.file, startLine: r.startLine, endLine: r.endLine, code, rationale: r.rationale });
    totalBytes += bytes;
  }

  // 선택적 토큰 컷 (컨텍스트 창 기반/레거시)
  const hardBudget = env.MAX_CODE_TOKENS;
  if (hardBudget > 0) {
    let used = 0;
    const trimmed: CodeSlice[] = [];
    for (const s of slices) {
      const t = Math.ceil(s.code.length / 4);
      if (used + t > hardBudget) break;
      used += t;
      trimmed.push(s);
    }
    return { ...state, codeSlices: trimmed };
  }

  return { ...state, codeSlices: slices };
}
