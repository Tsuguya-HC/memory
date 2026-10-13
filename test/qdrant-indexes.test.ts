// ensureCollection が listMemories の order_by に要る created_at の範囲インデックスを
// 作ることを確かめる。Qdrant は order_by のキーに範囲インデックスが無いと
// "No range index for `order_by` key" で 400 を返し、GET /memories が 500 になる。
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { ensureCollection } from "../src/qdrant.js";
import { stubQdrant } from "./helpers.js";

let restore = () => {};
afterEach(() => restore());

function indexCalls(calls: ReturnType<typeof stubQdrant>["calls"]) {
  return calls
    .filter((c) => c.method === "createPayloadIndex")
    .map((c) => c.args[1] as { field_name: string; field_schema: string });
}

const methods = (existing: string[]) => ({
  getCollections: () => ({ collections: existing.map((name) => ({ name })) }),
  createCollection: () => true,
  createPayloadIndex: () => ({ status: "completed" }),
});

test("新しいコレクションには created_at の datetime インデックスを作る", async () => {
  const q = stubQdrant(methods([]));
  restore = q.restore;
  await ensureCollection();
  assert.ok(q.calls.some((c) => c.method === "createCollection"));
  assert.deepEqual(
    indexCalls(q.calls).find((i) => i.field_name === "created_at")?.field_schema,
    "datetime",
  );
});

test("既存のコレクションにもインデックスを作る（作成済みでも Qdrant 側は冪等）", async () => {
  const q = stubQdrant(methods(["memories"]));
  restore = q.restore;
  await ensureCollection();
  assert.ok(!q.calls.some((c) => c.method === "createCollection"));
  assert.deepEqual(
    indexCalls(q.calls).map((i) => [i.field_name, i.field_schema]).sort(),
    [
      ["created_at", "datetime"],
      ["source", "keyword"],
      ["tags", "keyword"],
      ["type", "keyword"],
    ],
  );
});
