import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import HTML from 'tree-sitter-html';
import CSS from 'tree-sitter-css';

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
    default:
      return null;
  }
}
