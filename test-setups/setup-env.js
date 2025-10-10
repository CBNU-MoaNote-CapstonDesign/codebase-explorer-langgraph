import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "codedoc-manager"));
const projectRoot = path.join(tmp, "project");
const dataDir = path.join(tmp, "data");
fs.mkdirSync(projectRoot, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

// 기본 env
process.env.OPENAI_API_KEY = ""
process.env.PROJECT_ROOT = projectRoot;
process.env.FILTERED_AST_PATH = path.join(dataDir, "filtered_ast.json");
process.env.PROMPT_MODE = "slice"; // 기본 slice 모드
process.env.PORT = "0"; // 서버 실행 시 충돌 방지 (여기선 사용 안함)
process.env.MAX_LOOPS = "2"; // 테스트 시 루프 2회로 제한

// 테스트 픽스처: 간략 AST 파일 만들기 (files: 간단 목록)
const filteredAst = {
  files: [
    "src/index.ts",
    "src/util.ts",
    "src/view.jsx",
    "public/index.html",
    "styles/site.css"
  ]
};
fs.writeFileSync(process.env.FILTERED_AST_PATH, JSON.stringify(filteredAst, null, 2));
