// 不正な入力は 400 で弾き、Qdrant にも Ollama にも渡さない。
// これまでは JSON が壊れていると 500、型が違うと（text が数値・tags が文字列）
// そのまま保存され、limit が整数でないと Qdrant に 400 を返されて 500 になっていた。
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/routes.js";
import { stubOllama, stubQdrant } from "./helpers.js";

const restores: Array<() => void> = [];
afterEach(() => {
  while (restores.length) restores.pop()!();
});

function setup() {
  const q = stubQdrant({
    upsert: () => ({}),
    query: () => ({ points: [] }),
    scroll: () => ({ points: [] }),
  });
  const o = stubOllama();
  restores.push(q.restore, o.restore);
  return q;
}

function post(path: string, raw: string) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw,
  });
}

const badSaveBodies: Array<[string, string]> = [
  ["壊れた JSON", "{bad"],
  ["null", "null"],
  ["配列", "[]"],
  ["text が数値", JSON.stringify({ text: 123 })],
  ["tags が文字列", JSON.stringify({ text: "x", tags: "a" })],
  ["tags に数値", JSON.stringify({ text: "x", tags: ["a", 1] })],
  ["type が数値", JSON.stringify({ text: "x", type: 1 })],
  ["source がオブジェクト", JSON.stringify({ text: "x", source: {} })],
];

describe("POST /memories", () => {
  for (const [name, raw] of badSaveBodies) {
    test(`${name} は 400 で、保存しない`, async () => {
      const q = setup();
      const res = await post("/memories", raw);
      assert.equal(res.status, 400);
      assert.equal(typeof ((await res.json()) as { error?: unknown }).error, "string");
      assert.equal(q.calls.length, 0);
    });
  }

  test("正しい入力は従来どおり 201", async () => {
    setup();
    const res = await post(
      "/memories",
      JSON.stringify({ text: "x", tags: ["a"], type: "project", source: "s" }),
    );
    assert.equal(res.status, 201);
  });
});

const badSearchBodies: Array<[string, string]> = [
  ["壊れた JSON", "{bad"],
  ["null", "null"],
  ["query が数値", JSON.stringify({ query: 1 })],
  ["tags が文字列", JSON.stringify({ query: "q", tags: "a" })],
  ["type が数値", JSON.stringify({ query: "q", type: 1 })],
  ["limit が小数", JSON.stringify({ query: "q", limit: 2.5 })],
  ["limit が 0", JSON.stringify({ query: "q", limit: 0 })],
  ["limit が負", JSON.stringify({ query: "q", limit: -1 })],
  ["limit が文字列", JSON.stringify({ query: "q", limit: "5" })],
];

describe("POST /memories/search", () => {
  for (const [name, raw] of badSearchBodies) {
    test(`${name} は 400 で、検索しない`, async () => {
      const q = setup();
      const res = await post("/memories/search", raw);
      assert.equal(res.status, 400);
      assert.equal(q.calls.length, 0);
    });
  }

  test("正しい入力は従来どおり 200", async () => {
    const q = setup();
    const res = await post("/memories/search", JSON.stringify({ query: "q", limit: 5 }));
    assert.equal(res.status, 200);
    assert.equal((q.calls[0].args[1] as { limit: number }).limit, 5);
  });
});

describe("GET /memories", () => {
  for (const limit of ["abc", "2.5", "0", "-3"]) {
    test(`limit=${JSON.stringify(limit)} は 400 で、Qdrant に問い合わせない`, async () => {
      const q = setup();
      const res = await app.request(`/memories?limit=${limit}`);
      assert.equal(res.status, 400);
      assert.equal(q.calls.length, 0);
    });
  }

  test("limit=5 は従来どおり渡る", async () => {
    const q = setup();
    const res = await app.request("/memories?limit=5");
    assert.equal(res.status, 200);
    assert.equal((q.calls[0].args[1] as { limit: number }).limit, 5);
  });
});
