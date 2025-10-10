import fs from "fs/promises";
import fssync from "fs";
import path from "path";
import os from "os";

import {
  getLanguageByExt,
  parseFileToAST,
  sliceDetailedAST,
  loadFilteredAst,
  nodeLoadFilteredAst,
  nodeDecideFiles,
  nodeGetDetailedAsts,
  nodeAnswer,
  runGraph
} from "../parser.js";

const PROJECT_ROOT = process.env.PROJECT_ROOT;
const FILTERED_AST_PATH = process.env.FILTERED_AST_PATH;

describe("server core utilities", () => {
  test("getLanguageByExt - supports js/jsx/ts/tsx/html/css", () => {
    expect(getLanguageByExt(".js")).toBeTruthy();
    expect(getLanguageByExt(".jsx")).toBeTruthy();
    expect(getLanguageByExt(".ts")).toBeTruthy();
    expect(getLanguageByExt(".tsx")).toBeTruthy();
    expect(getLanguageByExt(".html")).toBeTruthy();
    expect(getLanguageByExt(".css")).toBeTruthy();
    expect(getLanguageByExt(".md")).toBeNull();
  });

  test("loadFilteredAst reads filtered AST JSON", async () => {
    const json = await loadFilteredAst();
    expect(Array.isArray(json.files)).toBe(true);
    expect(json.files.length).toBeGreaterThan(0);
  });


  test("sliceDetailedAST filters by symbols/hintTypes", () => {
    const fakeFullAst = {
      filePath: "src/x.ts",
      language: "typescript",
      root: {
        type: "program",
        children: [
          { type: "function_declaration", sample: "function foo() {}", children: [] },
          { type: "variable_declaration", sample: "const bar = 1", children: [] },
          { type: "method_definition", sample: "class A { m(){}}", children: [] },
        ]
      }
    };

    const sliced = sliceDetailedAST(fakeFullAst, {
      symbols: ["foo"],
      hintTypes: ["method_definition"],
      maxNodes: 10
    });

    // root.children 만 결과로 모으는 구조
    expect(sliced.root.type).toBe("root");
    const picked = sliced.root.children.map(n => n.type);
    expect(picked).toEqual(expect.arrayContaining(["function_declaration", "method_definition"]));
    expect(picked).not.toContain("variable_declaration");
  });
});

describe("tree-sitter parseFileToAST", () => {
  const mk = async (rel, content) => {
    const p = path.join(PROJECT_ROOT, rel);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, "utf8");
    return p;
  };

  test("parses simple TS file", async () => {
    const abs = await mk("src/index.ts", "export const x: number = 1;\nfunction foo() { return x; }");
    const ast = await parseFileToAST(abs);
    expect(ast.filePath).toBe("src/index.ts");
    expect(ast.language).toBeTruthy();
    expect(ast.root.type).toBe("program");
    // check sample presence
    const anyNodeHasFoo = JSON.stringify(ast).includes("foo");
    expect(anyNodeHasFoo).toBe(true);
  });

  test("parses JSX file", async () => {
    const abs = await mk("src/view.jsx", "export default function View(){ return <div>Hello</div>; }");
    const ast = await parseFileToAST(abs);
    expect(ast.filePath).toBe("src/view.jsx");
    expect(ast.root.type).toBe("program");
  });
});

describe("LangGraph node helpers (demo path without OpenAI key)", () => {
  test("nodeLoadFilteredAst -> sets filteredAst", async () => {
    const s0 = { question: "q" };
    const s1 = await nodeLoadFilteredAst(s0);
    expect(s1.filteredAst).toBeTruthy();
    expect(Array.isArray(s1.filteredAst.files)).toBe(true);
  });

  test("nodeDecideFiles -> chooses files with sliceHints", async () => {
    const base = { question: "API", filteredAst: JSON.parse(fssync.readFileSync(FILTERED_AST_PATH, "utf8")) };
    const s = await nodeDecideFiles(base);
    expect(s.wantFiles.length).toBeGreaterThan(0);
    expect(s.sliceHints).toBeTruthy();
  });

  test("nodeGetDetailedAsts -> parses chosen files", async () => {
    // 준비: 프로젝트에 간단 파일들 추가
    const mkFile = async (rel, content) => {
      const p = path.join(PROJECT_ROOT, rel);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, "utf8");
    };
    await mkFile("src/index.ts", "export const a = 1;");
    await mkFile("src/util.ts", "export function sum(x,y){ return x+y }");
    await mkFile("src/view.jsx", "export default () => <span>ok</span>");

    const st = {
      wantFiles: ["src/index.ts", "src/util.ts", "src/view.jsx"]
    };
    const s2 = await nodeGetDetailedAsts(st);
    expect(Array.isArray(s2.detailedAsts)).toBe(true);
    expect(s2.detailedAsts.length).toBe(3);
    expect(s2.detailedAsts[0].filePath).toBe("src/index.ts");
  });

  test("nodeAnswer -> returns demo answer string (no OPENAI key)", async () => {
    const state = {
      question: "상태 흐름 설명",
      filteredAst: { files: ["a.ts"] },
      detailedAsts: [{ filePath: "a.ts", language: "typescript", root: { type: "program", children: [] } }],
      sliceHints: { symbols: ["state"], hintTypes: ["function_declaration"] }
    };
    const s = await nodeAnswer(state);
    expect(typeof s.answer).toBe("string");
    expect(s.answer).toMatch(/데모 모드 결과/);
  });
});

describe("runGraph (light integration, demo path)", () => {
  test("returns final answer and chosen files", async () => {
    // 소스 추가 (그래프가 상세 AST에서 파싱 성공하도록)
    const mk = async (rel, content) => {
      const p = path.join(PROJECT_ROOT, rel);
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, "utf8");
    };
    await mk("src/index.ts", "export const x = 1; function foo(){ return x }");
    await mk("src/util.ts", "export const y = 2;");
    await mk("src/view.jsx", "export default function V(){ return <div/> }");

    const result = await runGraph("프로젝트의 주요 진입점을 알려줘");
    expect(result.answer).toBeTruthy();
    expect(Array.isArray(result.wantFiles)).toBe(true);
    expect(result.modeUsed).toBe("slice");
  });
});
