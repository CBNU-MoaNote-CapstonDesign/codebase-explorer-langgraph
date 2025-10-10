import fs from "fs";
import path from "path";
import Parser from "tree-sitter";
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import HTML from 'tree-sitter-html';
import CSS from 'tree-sitter-css';

// 확장자별 Tree-sitter 언어 매핑
const languageMap = {
  ".ts": TypeScript.typescript,
  ".tsx": TypeScript.tsx,
  ".js": JavaScript,
  ".jsx": JavaScript.jsx,
  ".html": HTML,
  ".css": CSS,
};

// 파라미터 추출
function getParams(paramsNode, code) {
  if (!paramsNode) return [];
  return paramsNode.namedChildren.map(param => {
    if (["required_parameter", "rest_parameter", "optional_parameter"].includes(param.type)) {
      const idNode = param.childForFieldName("name");
      if (idNode) return code.slice(idNode.startIndex, idNode.endIndex);
    }
    return code.slice(param.startIndex, param.endIndex);
  });
}

// AST 필터링
function extractNodeInfo(node, code) {
  let results = [];

  // 일반 함수
  if (node.type === "function_declaration") {
    const nameNode = node.childForFieldName("name");
    const paramsNode = node.childForFieldName("parameters");
    const params = getParams(paramsNode, code);
    results.push({
      type: "function",
      name: code.slice(nameNode.startIndex, nameNode.endIndex),
      params,
    });
  }

  // 클래스
  if (node.type === "class_declaration") {
    const nameNode = node.childForFieldName("name");
    const bodyNode = node.childForFieldName("body");
    let methods = [];

    if (bodyNode) {
      for (const child of bodyNode.namedChildren) {
        if (child.type === "method_definition") {
          const methodNameNode = child.childForFieldName("name");
          const methodParamsNode = child.childForFieldName("parameters");
          const methodParams = getParams(methodParamsNode, code);
          methods.push({
            name: code.slice(methodNameNode.startIndex, methodNameNode.endIndex),
            params: methodParams,
          });
        }
      }
    }

    results.push({
      type: "class",
      name: code.slice(nameNode.startIndex, nameNode.endIndex),
      methods,
    });
  }

  // 변수 선언 → 화살표 함수 / 함수 표현식
  if (node.type === "lexical_declaration") {
    for (const declarator of node.namedChildren) { // variable_declarator
      const idNode = declarator.childForFieldName("name");
      const initNode = declarator.childForFieldName("value"); // initializer
      if (!initNode) continue;

      if (["arrow_function", "function_expression", "function"].includes(initNode.type)) {
        const paramsNode = initNode.childForFieldName("parameters");
        const params = getParams(paramsNode, code);
        results.push({
          type: "function",
          name: code.slice(idNode.startIndex, idNode.endIndex),
          params,
        });
      }
    }
  }

  // 재귀 탐색
  for (const child of node.namedChildren) {
    results = results.concat(extractNodeInfo(child, code));
  }

  return results;
}

// 폴더 재귀 탐색 + AST 합치기
function parseFolder(folderPath) {
  const allFiles = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if ([".ts", ".tsx", ".js"].includes(path.extname(entry.name))) {
        allFiles.push(fullPath);
      }
    }
  }
  walk(folderPath);

  const parser = new Parser();
  const projectAST = [];

  for (const file of allFiles) {
    const ext = path.extname(file);
    parser.setLanguage(languageMap[ext]);
    const code = fs.readFileSync(file, "utf-8");
    const tree = parser.parse(code);
    const filtered = extractNodeInfo(tree.rootNode, code);
    projectAST.push({
      file,
      ast: filtered,
    });
  }

  return projectAST;
}

// 실행
const folderPath = "./actual_project"; // 분석할 폴더
const projectAST = parseFolder(folderPath);

// JSON 저장
fs.writeFileSync("project_ast.json", JSON.stringify(projectAST));
console.log("project_ast.json 생성 완료!");
