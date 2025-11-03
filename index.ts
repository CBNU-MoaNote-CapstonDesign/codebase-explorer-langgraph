// index.ts (또는 서버 시작 직전 위치)
import { startServer } from './src/server/http.js';

async function main() {
  await startServer();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
