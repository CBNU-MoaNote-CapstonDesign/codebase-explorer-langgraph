// index.ts (또는 서버 시작 직전 위치)
import { ensureFilteredAst } from './src/ast/gen_filtered.js';
import { env } from './src/config/env.js';
import { startServer } from './src/server/http.js';

async function main() {
  await ensureFilteredAst();               // ← 없으면 생성 / REGENERATE_FILTERED=1 이면 재생성
  await startServer();                     // 기존 서버 부트 로직
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
