// コンテナでは node が PID 1 で動く（Dockerfile の CMD）。PID 1 にはカーネルの
// 既定のシグナル処理が効かないので、SIGTERM のハンドラが無いと kubelet の
// SIGTERM は無視され、terminationGracePeriodSeconds の後に SIGKILL されるまで
// 止まらない。ここではハンドラの有無を「SIGTERM で正常終了（終了コード 0）
// するか」で確かめる。ハンドラが無ければ（PID 1 でない限り）シグナルで死ぬ。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { once } from "node:events";

// ensureCollection が起動時に叩く Qdrant の代わり。どの要求にも
// 「memories コレクションはある」と答える。
async function fakeQdrant(): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          status: "ok",
          time: 0,
          result: { collections: [{ name: "memories" }], status: "completed" },
        }),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

test("SIGTERM を受けたら終了コード 0 で終わる", async () => {
  const qdrant = await fakeQdrant();
  const { port } = qdrant.address() as { port: number };
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    env: { ...process.env, PORT: "0", QDRANT_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "inherit"],
  });
  try {
    let out = "";
    child.stdout.setEncoding("utf8");
    await new Promise<void>((resolve, reject) => {
      child.stdout.on("data", (chunk: string) => {
        out += chunk;
        if (out.includes("listening")) resolve();
      });
      child.once("exit", (code, signal) =>
        reject(new Error(`exited before listening: code=${code} signal=${signal}`)),
      );
    });

    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
    const [code, signal] = (await once(child, "exit")) as [number | null, string | null];
    clearTimeout(timer);
    assert.deepEqual({ code, signal }, { code: 0, signal: null });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    qdrant.close();
  }
});
