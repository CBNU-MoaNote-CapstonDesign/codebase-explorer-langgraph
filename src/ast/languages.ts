import { env } from '../config/env.js';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import HTML from 'tree-sitter-html';
import CSS from 'tree-sitter-css';
import C from 'tree-sitter-c';
import CPP from 'tree-sitter-cpp';
import JAVA from 'tree-sitter-java';
import Kotlin from 'tree-sitter-kotlin';
import Python from 'tree-sitter-python';

/**
 * 파일 확장자를 tree-sitter 언어로 매핑합니다.
 * 지원: .js/.jsx/.ts/.tsx/.html/.css
 * @param {string} ext 파일 확장자 (예: ".ts")
 * @returns {any|null} tree-sitter 언어 또는 null
 */
export function getLanguageByExt(ext: string): any | null {
  switch (ext) {
    case '.js':
    case '.jsx':
      return JavaScript;
    case '.ts':
      return TypeScript.typescript;
    case '.tsx':
      return TypeScript.tsx;
    case '.html':
      return HTML;
    case '.css':
      return CSS;
          // C (소스/헤더)
    case '.c':
      return C;
    case '.h':
      return env.C_HEADER_AS_CPP ? CPP : C; // 환경변수로 기본 해석 선택

    // C++ (소스/헤더)
    case '.cc':
    case '.cpp':
    case '.cxx':
      return CPP;
    case '.hh':
    case '.hpp':
    case '.hxx':
      return CPP;
    case '.java':
      return JAVA;
    case '.kt':
    case '.kts':
      return Kotlin;
    case '.py':
      return Python;
    default:
      return null;
  }
}
