// HTTP API（src/routes.ts）の現在の振る舞いを固定するテスト。
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/routes.js";
import { json, stubOllama, stubQdrant, VECTOR } from "./helpers.js";

const restores: Array<() => void> = [];
afterEach(() => {
  while (restores.length) restores.pop()!();
});

function setup(qdrantMethods: Parameters<typeof stubQdrant>[0], ollama = {}) {
  const q = stubQdrant(qdrantMethods);
  const o = stubOllama(ollama);
  restores.push(q.restore, o.restore);
  return q;
}

describe("POST /memories", () => {
  test("text が無ければ 400 で、Qdrant に書かない", async () => {
    const q = setup({ upsert: () => ({}) });
    const res = await app.request("/memories", json({ tags: ["a"] }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "text is required" });
    assert.equal(q.calls.length, 0);
  });

  test("埋め込みベクトルと既定値付きの payload を upsert して 201 を返す", async () => {
    const q = setup({ upsert: () => ({}) });
    const res = await app.request("/memories", json({ text: "hello" }));
    assert.equal(res.status, 201);
    const body = (await res.json()) as Record<string, unknown>;
    assert.match(String(body.id), /^[0-9a-f-]{36}$/);
    assert.equal(body.text, "hello");
    assert.deepEqual(body.tags, []);
    assert.equal(body.type, "general");
    assert.equal(body.source, "unknown");
    assert.ok(!Number.isNaN(Date.parse(String(body.created_at))));

    assert.equal(q.calls.length, 1);
    const [collection, req] = q.calls[0].args as [string, any];
    assert.equal(collection, "memories");
    assert.equal(req.wait, true);
    assert.equal(req.points[0].id, body.id);
    assert.deepEqual(req.points[0].vector, VECTOR);
    assert.equal(req.points[0].payload.text, "hello");
  });

  test("Ollama が失敗したら 500 で、Qdrant に書かない", async () => {
    const q = setup({ upsert: () => ({}) }, { ok: false });
    const res = await app.request("/memories", json({ text: "hello" }));
    assert.equal(res.status, 500);
    assert.equal(q.calls.length, 0);
  });
});

describe("POST /memories/search", () => {
  test("query が無ければ 400", async () => {
    const q = setup({ query: () => ({ points: [] }) });
    const res = await app.request("/memories/search", json({}));
    assert.equal(res.status, 400);
    assert.equal(q.calls.length, 0);
  });

  test("tags は any、type は value の must フィルタになり、limit の既定は 10", async () => {
    const q = setup({
      query: () => ({
        points: [{ id: "abc", score: 0.5, payload: { text: "t" } }],
      }),
    });
    const res = await app.request(
      "/memories/search",
      json({ query: "q", tags: ["a", "b"], type: "project" }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: "abc", score: 0.5, payload: { text: "t" } }]);

    const [, req] = q.calls[0].args as [string, any];
    assert.deepEqual(req.query, VECTOR);
    assert.equal(req.limit, 10);
    assert.deepEqual(req.filter, {
      must: [
        { key: "tags", match: { any: ["a", "b"] } },
        { key: "type", match: { value: "project" } },
      ],
    });
  });

  test("フィルタ指定が無ければ filter を送らない", async () => {
    const q = setup({ query: () => ({ points: [] }) });
    await app.request("/memories/search", json({ query: "q", limit: 3 }));
    const [, req] = q.calls[0].args as [string, any];
    assert.equal(req.filter, undefined);
    assert.equal(req.limit, 3);
  });
});

describe("GET /memories", () => {
  test("クエリ文字列の tags はカンマ区切り、limit の既定は 20、created_at の降順", async () => {
    const q = setup({ scroll: () => ({ points: [{ id: 1, payload: { text: "t" } }] }) });
    const res = await app.request("/memories?tags=a,,b&type=user");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), [{ id: "1", payload: { text: "t" } }]);

    const [, req] = q.calls[0].args as [string, any];
    assert.equal(req.limit, 20);
    assert.deepEqual(req.order_by, { key: "created_at", direction: "desc" });
    assert.deepEqual(req.filter, {
      must: [
        { key: "tags", match: { any: ["a", "b"] } },
        { key: "type", match: { value: "user" } },
      ],
    });
  });
});

describe("GET /memories/:id", () => {
  test("見つからなければ 404", async () => {
    setup({ retrieve: () => [] });
    const res = await app.request("/memories/00000000-0000-0000-0000-000000000000");
    assert.equal(res.status, 404);
  });

  test("見つかればその点を返す", async () => {
    setup({ retrieve: () => [{ id: "x", payload: { text: "t" } }] });
    const res = await app.request("/memories/x");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: "x", payload: { text: "t" } });
  });
});

describe("DELETE /memories/:id", () => {
  test("指定した id を wait 付きで消す", async () => {
    const q = setup({ delete: () => ({}) });
    const res = await app.request("/memories/abc", { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.deepEqual(q.calls[0].args, ["memories", { wait: true, points: ["abc"] }]);
  });
});

describe("GET /health", () => {
  test("両方生きていれば 200", async () => {
    setup({ getCollections: () => ({ collections: [] }) });
    const res = await app.request("/health");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, qdrant: true, ollama: true });
  });

  test("Qdrant が落ちていれば 503", async () => {
    setup({
      getCollections: () => {
        throw new Error("connection refused");
      },
    });
    const res = await app.request("/health");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, qdrant: false, ollama: true });
  });

  test("Ollama が落ちていれば 503", async () => {
    setup({ getCollections: () => ({ collections: [] }) }, { ok: false });
    const res = await app.request("/health");
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, qdrant: true, ollama: false });
  });
});
