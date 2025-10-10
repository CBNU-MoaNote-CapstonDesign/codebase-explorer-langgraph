import 'dotenv/config';
import path from 'path';

/**
 * 문자열 환경변수를 boolean으로 파싱 (기본 false)
 * @param {string|undefined|null} val 값
 * @param {boolean} def 기본값
 * @returns {boolean} boolean 값
 */
function envFlag(val: string | undefined | null, def = false): boolean {
  if (val == null) return def;
  const s = String(val).trim();
  return s === '1' || /^true$/i.test(s) || /^yes$/i.test(s) || /^on$/i.test(s);
}

/**
 * 숫자 환경변수 파싱 (기본값 반환)
 * @param {string|undefined|null} val 값
 * @param {number} def 기본값
 * @returns {number} 숫자 값
 */
function envNum(val: string | undefined | null, def = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

/**
 * 런타임 환경설정 객체
 * - .env를 파싱하여 읽기 전용 상수로 노출
 */
export const env = {
  PROJECT_ROOT: process.env.PROJECT_ROOT || path.resolve(process.cwd(), 'project'),
  FILTERED_AST_PATH: process.env.FILTERED_AST_PATH || path.resolve(process.cwd(), 'data/filtered_ast.json'),

  TRACE_LANGGRAPH: String(process.env.TRACE_LANGGRAPH || '0') === '1',
  TRACE_MAX_JSON: envNum(process.env.TRACE_MAX_JSON, 2000),

  PROMPT_MODE: ((process.env.PROMPT_MODE || 'slice').toLowerCase() as 'slice' | 'full') || 'slice',
  MAX_LOOPS: envNum(process.env.MAX_LOOPS, 1),

  PRUNE_ALLOW_DROP_ALL: envFlag(process.env.PRUNE_ALLOW_DROP_ALL, true),
  PRUNE_SERVER_ENFORCE_LIMITS: envFlag(process.env.PRUNE_SERVER_ENFORCE_LIMITS, true),
  PROMPT_MAX_FILES: envNum(process.env.PROMPT_MAX_FILES, 0),
  MAX_AST_TOKENS: envNum(process.env.MAX_AST_TOKENS, 0),

  MODEL_CTX_TOKENS: envNum(process.env.MODEL_CTX_TOKENS, 0),
  OUTPUT_TOKENS_BUDGET: envNum(process.env.OUTPUT_TOKENS_BUDGET, 1500),
  PROMPT_SAFETY: Number(process.env.PROMPT_SAFETY ?? 0.8),

  CODE_MAX_FILES: envNum(process.env.CODE_MAX_FILES, 6),
  CODE_MAX_BYTES: envNum(process.env.CODE_MAX_BYTES, 200_000),
  CODE_SAFETY: Number(process.env.CODE_SAFETY ?? 0.8),
  MAX_CODE_TOKENS: envNum(process.env.MAX_CODE_TOKENS, 0),

  OPENAI_API_KEY: (process.env.OPENAI_API_KEY || '').trim(),
  OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5-mini',

  PORT: Number(process.env.PORT || 3000),
};

export default env;