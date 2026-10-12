import { Hono, type Context } from "hono";
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

// 入力の検査。型が合わない値をそのまま Qdrant に渡すと、保存されてしまうか
// （text が数値・tags が文字列）、Qdrant に弾かれて 500 になる（limit が小数）。

async function readObject(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isOptionalString = (v: unknown): v is string | undefined =>
  v === undefined || typeof v === "string";

const isOptionalStringArray = (v: unknown): v is string[] | undefined =>
  v === undefined || (Array.isArray(v) && v.every((t) => typeof t === "string"));

const isOptionalLimit = (v: unknown): v is number | undefined =>
  v === undefined || (Number.isInteger(v) && (v as number) > 0);

app.post("/memories", async (c) => {
  const body = await readObject(c);
  if (!body) {
    return c.json({ error: "body must be a JSON object" }, 400);
  }

  if (!body.text) {
    return c.json({ error: "text is required" }, 400);
  }
  if (typeof body.text !== "string") {
    return c.json({ error: "text must be a string" }, 400);
  }
  if (!isOptionalStringArray(body.tags)) {
    return c.json({ error: "tags must be an array of strings" }, 400);
  }
  if (!isOptionalString(body.type) || !isOptionalString(body.source)) {
    return c.json({ error: "type and source must be strings" }, 400);
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
  const body = await readObject(c);
  if (!body) {
    return c.json({ error: "body must be a JSON object" }, 400);
  }

  if (!body.query) {
    return c.json({ error: "query is required" }, 400);
  }
  if (typeof body.query !== "string") {
    return c.json({ error: "query must be a string" }, 400);
  }
  if (!isOptionalStringArray(body.tags)) {
    return c.json({ error: "tags must be an array of strings" }, 400);
  }
  if (!isOptionalString(body.type)) {
    return c.json({ error: "type must be a string" }, 400);
  }
  if (!isOptionalLimit(body.limit)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
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
  if (!isOptionalLimit(limit)) {
    return c.json({ error: "limit must be a positive integer" }, 400);
  }

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
