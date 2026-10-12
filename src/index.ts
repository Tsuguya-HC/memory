import { serve } from "@hono/node-server";
import app from "./routes.js";
import { ensureCollection } from "./qdrant.js";

const port = Number(process.env.PORT ?? 3000);

await ensureCollection();

const server = serve({ fetch: app.fetch, port }, () => {
  console.log(`Memory API listening on port ${port}`);
});

// コンテナでは PID 1 で動くので、ハンドラが無いと SIGTERM は無視され、
// Pod の停止は terminationGracePeriodSeconds 後の SIGKILL 待ちになる。
// 新しい接続の受け付けを止め、処理中の要求を返し終えてから終了する。
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    console.log(`Received ${signal}, shutting down`);
    server.close(() => process.exit(0));
  });
}
