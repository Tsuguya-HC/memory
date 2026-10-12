// src/ollama.ts の失敗の伝え方を固定するテスト。
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { embed, healthCheck } from "../src/ollama.js";
import { stubOllama, VECTOR } from "./helpers.js";

let restore = () => {};
afterEach(() => restore());

test("embed は最初の埋め込みベクトルを返す", async () => {
  restore = stubOllama().restore;
  assert.deepEqual(await embed("x"), VECTOR);
});

test("embed は Ollama の HTTP エラーを状態コードと本文付きで投げる", async () => {
  restore = stubOllama({ ok: false }).restore;
  await assert.rejects(embed("x"), /^Error: Ollama embed failed: 500 ollama down$/);
});

test("healthCheck は Ollama が落ちていれば false", async () => {
  restore = stubOllama({ ok: false }).restore;
  assert.equal(await healthCheck(), false);
});
