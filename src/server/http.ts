import express, { type Request, type Response } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs/promises';
import path from 'path';

import { env } from '../config/env.js';
import { runGraph } from '../graph/run.js';
import { parseFileToAST } from '../ast/parse.js';
import { loadFilteredAst } from '../ast/parse.js';

/**
 * Express 앱을 생성하고 라우팅을 설정한 뒤 서버를 기동합니다.
 */
export function startServer() {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json({ limit: '25mb' }));

  const staticRoot = path.resolve(process.cwd());
  app.use(express.static(staticRoot));

  app.get('/', (_req: Request, res: Response) => {
    res.sendFile(path.join(staticRoot, 'index.html'));
  });

  /** 헬스체크 */
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, mode: env.PROMPT_MODE, llm: !!env.OPENAI_API_KEY });
  });

  /** 간략 AST 제공 — 파일에서 read */
  app.get('/ast/filtered', async (_req: Request, res: Response) => {
    try {
      const json = await loadFilteredAst(env.FILTERED_AST_PATH);
      res.json({ ok: true, filteredAst: json });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  /** 상세 AST 생성 — tree-sitter 실행 */
  app.post('/ast/detailed', async (req: Request, res: Response) => {
    try {
      const { files } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ ok: false, error: 'files must be a non-empty array' });
      }
      const results = [];
      for (const rel of files) {
        const abs = path.resolve(env.PROJECT_ROOT, rel);
        const stat = await fs.stat(abs);
        if (!stat.isFile()) continue;
        results.push(await parseFileToAST(abs));
      }
      res.json({ ok: true, detailedAsts: results });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  /** (LangGraph) 전체 흐름 — 질문 → (간략 AST) → 파일결정 → 상세 AST → PRUNE → 코드 범위 → 코드 → 답변 */
  app.post('/graph/ask', async (req: Request, res: Response) => {
    const { question } = req.body || {};
    if (!question || typeof question !== 'string') {
      return res.status(400).json({ ok: false, error: 'question (string) is required' });
    }
    try {
      const result = await runGraph(question);
      res.json({ ok: true, ...result });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok: false, error: String(e) });
    }
  });

  app.listen(env.PORT, () => {
    console.log(`AST path ${env.FILTERED_AST_PATH}`);
    console.log(`LangGraph AST server listening on http://localhost:${env.PORT}`);
  });
}
