import { env } from '../config/env.js';

/**
 * Trace 데코레이터 옵션
 */
export type TraceOptions = {
  /** 로그 태그(기본: 메서드명) */
  tag?: string;
  /**
   * 인자 중 로그로 남길 **가공값** 선택자.
   * - `([state]) => ({ q: state.question, want: state.wantFiles?.length })`
   * - 반환값은 JSON 직렬화되어 출력됨.
   */
  pickArgs?: (args: any[]) => unknown;
  /**
   * 인자 인덱스 배열로 필요한 것만 부분 출력.
   * - 예: `[0, 2]` → 0번, 2번 인자만 출력
   * - `pickArgs` 가 있으면 무시됨.
   */
  argIndices?: number[];
  /**
   * 결과 출력 선택자.
   * - `(result) => ({ answer: result.answer, kept: result?.prunedAsts?.length })`
   * - 미설정 시 결과 전체를 요약 출력.
   */
  pickResult?: (result: unknown) => unknown;
  /** 한 로그에서 JSON 문자열 최대 길이(기본: env.TRACE_MAX_JSON) */
  maxLen?: number;
};

/**
 * 긴 JSON 문자열을 잘라 로깅합니다.
 */
export function j(obj: unknown): string {
  try {
    const s = JSON.stringify(obj);
    return s.length > env.TRACE_MAX_JSON ? s.slice(0, env.TRACE_MAX_JSON) + ` ...(+${s.length - env.TRACE_MAX_JSON})` : s;
  } catch {
    return String(obj);
  }
}

/**
 * 표준 Trace 데코레이터
 *
 * - 인자 전체 대신 **일부만** 로깅하고 싶을 때 `pickArgs` 또는 `argIndices` 사용
 * - 결과도 `pickResult` 로 요약 가능
 * - 비동기/동기 함수 모두 안전하게 래핑 (이중 Promise 없음)
 *
 * @example
 * ```ts
 * // state.question 만 출력
 * @Trace({ tag: 'nodeDecideFiles', pickArgs: ([s]) => ({ q: s.question }) })
 * static async nodeDecideFiles(state: GraphState) { ... }
 *
 * // 0번 인자만 그대로 출력
 * @Trace({ argIndices: [0] })
 * someFunc(a, b, c) { ... }
 *
 * // 결과에서 answer 길이와 pruned 개수만 출력
 * @Trace({ pickResult: (out) => ({ answerLen: out?.answer?.length ?? 0, pruned: out?.prunedAsts?.length ?? 0 }) })
 * ```
 */
export function Trace(opts?: string | TraceOptions) {
  const normalized: TraceOptions =
    typeof opts === 'string' ? { tag: opts } : (opts ?? {});

  return function <T extends (this: unknown, ...a: any[]) => any>(
    value: T,
    context: ClassMethodDecoratorContext
  ) {
    if (context.kind !== 'method') return;
    const name = normalized.tag || String(context.name);

    const pickArgsView = (args: any[]) => {
      if (normalized.pickArgs) return normalized.pickArgs(args);
      if (normalized.argIndices && normalized.argIndices.length > 0) {
        return normalized.argIndices.map((i) => args[i]);
      }
      return args;
    };

    const pickResultView = (out: unknown) => {
      return normalized.pickResult ? normalized.pickResult(out) : out;
    };

    return function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
      if (env.TRACE_LANGGRAPH) {
        const argView = pickArgsView(args);
        const s = JSON.stringify(argView);
        const maxLen = normalized.maxLen ?? env.TRACE_MAX_JSON;
        const clipped = s.length > maxLen ? s.slice(0, maxLen) + ` ...(+${s.length - maxLen})` : s;
        console.debug(`[TRACE] enter ${name}: args=${clipped}`);
      }

      const t0 = Date.now();
      try {
        const result = value.apply(this, args) as ReturnType<T>;

        // Promise 처리 (이중 Promise 방지)
        if (result && typeof (result as any).then === 'function') {
          return (result as Promise<any>)
            .then((out) => {
              if (env.TRACE_LANGGRAPH) {
                const view = pickResultView(out);
                const s = JSON.stringify(view);
                const maxLen = normalized.maxLen ?? env.TRACE_MAX_JSON;
                const clipped = s.length > maxLen ? s.slice(0, maxLen) + ` ...(+${s.length - maxLen})` : s;
                console.debug(`[TRACE] exit  ${name}: +${Date.now() - t0}ms out=${clipped}`);
              }
              return out;
            })
            .catch((e: any) => {
              if (env.TRACE_LANGGRAPH) {
                console.debug(`[TRACE] error ${name}: +${Date.now() - t0}ms ${e?.message || e}`);
              }
              throw e;
            }) as ReturnType<T>;
        }

        if (env.TRACE_LANGGRAPH) {
          const view = pickResultView(result);
          const s = JSON.stringify(view);
          const maxLen = normalized.maxLen ?? env.TRACE_MAX_JSON;
          const clipped = s.length > maxLen ? s.slice(0, maxLen) + ` ...(+${s.length - maxLen})` : s;
          console.debug(`[TRACE] exit  ${name}: +${Date.now() - t0}ms out=${clipped}`);
        }
        return result;
      } catch (e: any) {
        if (env.TRACE_LANGGRAPH) {
          console.debug(`[TRACE] error ${name}: +${Date.now() - t0}ms ${e?.message || e}`);
        }
        throw e;
      }
    };
  };
}