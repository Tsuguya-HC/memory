// GET /memories/:id は「その記憶が無い」ときだけ 404 にし、Qdrant に届かない・
// Qdrant が壊れているといった障害は 404 に化けさせない。
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/routes.js";
import { stubQdrant } from "./helpers.js";

let restore = () => {};
afterEach(() => restore());

const ID = "00000000-0000-0000-0000-000000000000";

function failWith(error: Error & { status?: number }) {
  restore = stubQdrant({
    retrieve: () => {
      throw error;
    },
  }).restore;
}

test("Qdrant に接続できなければ 404 ではなく 500", async () => {
  failWith(new TypeError("fetch failed"));
  const res = await app.request(`/memories/${ID}`);
  assert.equal(res.status, 500);
});

test("Qdrant が 5xx を返したら 404 ではなく 500", async () => {
  failWith(Object.assign(new Error("Internal Server Error"), { status: 500 }));
  const res = await app.request(`/memories/${ID}`);
  assert.equal(res.status, 500);
});

test("id の形式が不正で Qdrant が 400 を返したら、これまでどおり 404", async () => {
  failWith(Object.assign(new Error("Bad Request"), { status: 400 }));
  const res = await app.request("/memories/not-a-uuid");
  assert.equal(res.status, 404);
});

test("該当する点が無ければ 404", async () => {
  restore = stubQdrant({ retrieve: () => [] }).restore;
  const res = await app.request(`/memories/${ID}`);
  assert.equal(res.status, 404);
});
