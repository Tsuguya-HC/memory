import { Hono } from "hono";
import crypto from "node:crypto";
import { embed } from "./ollama.js";
import {
  upsertMemory,
  searchMemories,
  getMemory,
  deleteMemory,
  listMemories,
  healthCheck as qdrantHealth,
} from "./qdrant.js";
import { healthCheck as ollamaHealth } from "./ollama.js";

const app = new Hono();

app.post("/memories", async (c) => {
  const body = await c.req.json<{
    text: string;
    tags?: string[];
    type?: string;
    source?: string;
  }>();

  if (!body.text) {
    return c.json({ error: "text is required" }, 400);
  }

  const id = crypto.randomUUID();
  const vector = await embed(body.text);
  const payload = {
    text: body.text,
    tags: body.tags ?? [],
    type: body.type ?? "general",
    source: body.source ?? "unknown",
    created_at: new Date().toISOString(),
  };

  await upsertMemory(id, vector, payload);
  return c.json({ id, ...payload }, 201);
});

app.post("/memories/search", async (c) => {
  const body = await c.req.json<{
    query: string;
    tags?: string[];
    type?: string;
    limit?: number;
  }>();

  if (!body.query) {
    return c.json({ error: "query is required" }, 400);
  }

  const vector = await embed(body.query);
  const results = await searchMemories(vector, {
    tags: body.tags,
    type: body.type,
    limit: body.limit,
  });

  return c.json(results);
});

app.get("/memories", async (c) => {
  const tags = c.req.query("tags")?.split(",").filter(Boolean);
  const type = c.req.query("type");
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined;

  const results = await listMemories({ tags, type: type ?? undefined, limit });
  return c.json(results);
});

app.get("/memories/:id", async (c) => {
  const id = c.req.param("id");
  const result = await getMemory(id);
  if (!result) {
    return c.json({ error: "not found" }, 404);
  }
  return c.json(result);
});

app.delete("/memories/:id", async (c) => {
  const id = c.req.param("id");
  await deleteMemory(id);
  return c.json({ ok: true });
});

app.get("/health", async (c) => {
  const [qdrantOk, ollamaOk] = await Promise.all([qdrantHealth(), ollamaHealth()]);
  const ok = qdrantOk && ollamaOk;
  return c.json({ ok, qdrant: qdrantOk, ollama: ollamaOk }, ok ? 200 : 503);
});

export default app;
