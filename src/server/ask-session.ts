import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

import { buildFilteredAst, writeFilteredAst } from '../ast/gen_filtered.js';

/**
 * ask API 실행 중 생성되는 임시 filtered_ast 세션 정보입니다.
 */
export interface AskSession {
  /** 세션 디렉토리 이름(UUID) */
  id: string;
  /** 생성된 세션 디렉토리 절대 경로 */
  dir: string;
  /** 세션 디렉토리 내 filtered_ast.json 절대 경로 */
  filteredAstPath: string;
  /** 세션 디렉토리 정리 함수 (idempotent) */
  cleanup: () => Promise<void>;
}

/**
 * ask API용 임시 filtered_ast 세션을 생성합니다.
 *
 * - `./<uuid>` 형식의 디렉토리를 생성합니다.
 * - 주어진 프로젝트 루트를 파싱해 filtered_ast.json을 생성합니다.
 * - 세션 종료 시 `cleanup()`으로 디렉토리를 삭제할 수 있습니다.
 *
 * @param {string} projectRoot filtered_ast를 생성할 프로젝트 루트 절대 경로
 * @param {{baseDir?:string}} [options] 세션 디렉토리를 생성할 기준 디렉토리 (기본: process.cwd())
 * @returns {Promise<AskSession>} 생성된 세션 정보
 */
export async function createAskSession(
  projectRoot: string,
  options: { baseDir?: string } = {}
): Promise<AskSession> {
  const baseDir = path.resolve(options.baseDir ?? process.cwd());
  const sessionId = randomUUID();
  const sessionDir = path.resolve(baseDir, sessionId);

  await fs.mkdir(sessionDir, { recursive: false });

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    cleaned = true;
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch {
      // swallow cleanup errors — nothing else to do
    }
  };

  try {
    const filteredAst = await buildFilteredAst(projectRoot);
    const filteredAstPath = path.join(sessionDir, 'filtered_ast.json');
    await writeFilteredAst(filteredAst, filteredAstPath);
    return { id: sessionId, dir: sessionDir, filteredAstPath, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}