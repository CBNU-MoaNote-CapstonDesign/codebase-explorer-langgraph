/**
 * 실제 LLM 스모크 테스트 (OPENAI_API_KEY가 있을 때만 실행)
 * - 모델 응답 포맷은 공급자/버전에 따라 약간 다를 수 있으므로 "throw 없이 성공"과
 *   "최소한의 구조가 있는 응답"만 확인하는 가벼운 검증을 수행합니다.
 */

import {
  nodeDecideFiles,
  nodeAnswer
} from "../parser.js";

const hasKey = (process.env.OPENAI_API_KEY || "").trim().length > 0;

(hasKey ? describe : describe.skip)("LLM real path (requires OPENAI_API_KEY)", () => {
  test("nodeDecideFiles returns something sensible with real LLM", async () => {
    const filteredAst = { files: ["src/index.ts", "src/util.ts"] };
    const state = { question: "Find where API is called", filteredAst };
    const s = await nodeDecideFiles(state);

    // LLM이 JSON을 잘 주면 배열, 아니면 fallback 로직이 동작할 수 있음.
    // 여기선 '실패 없이' wantFiles가 배열인지, 길이가 0 이상인지 정도만 확인.
    expect(Array.isArray(s.wantFiles)).toBe(true);
  });

  test("nodeAnswer returns non-empty answer with real LLM", async () => {
    const detailedAsts = [{
      filePath: "src/index.ts",
      language: "typescript",
      root: { type: "program", children: [] }
    }];

    const state = {
      question: "Explain the entrypoint",
      filteredAst: { files: ["src/index.ts"] },
      detailedAsts,
      sliceHints: { symbols: ["entry"], hintTypes: ["function_declaration"] }
    };

    const s = await nodeAnswer(state);
    expect(typeof s.answer).toBe("string");
    expect(s.answer.length).toBeGreaterThan(0);
  });
});
