import { serve } from "@hono/node-server";
import app from "./routes.js";
import { ensureCollection } from "./qdrant.js";

const port = Number(process.env.PORT ?? 3000);

await ensureCollection();

serve({ fetch: app.fetch, port }, () => {
  console.log(`Memory API listening on port ${port}`);
});
