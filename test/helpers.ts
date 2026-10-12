// テスト用のスタブ。Qdrant と Ollama を立てずに routes / qdrant を動かす。
//
// - Qdrant: src/qdrant.ts が export しているクライアントのインスタンスの
//   メソッドを差し替える。呼び出しは `calls` に記録する。
// - Ollama: src/ollama.ts はグローバルの fetch を使うので、それを差し替える。
//
// どちらも `restore()` で元に戻す。各テストの afterEach で呼ぶこと。
import { qdrant } from "../src/qdrant.js";

type AnyFn = (...args: any[]) => any;

export interface QdrantStub {
  calls: Array<{ method: string; args: unknown[] }>;
  restore: () => void;
}

export function stubQdrant(methods: Record<string, AnyFn>): QdrantStub {
  const client = qdrant as unknown as Record<string, AnyFn>;
  const saved: Record<string, AnyFn> = {};
  const calls: QdrantStub["calls"] = [];
  for (const [name, impl] of Object.entries(methods)) {
    saved[name] = client[name];
    client[name] = async (...args: unknown[]) => {
      calls.push({ method: name, args });
      return impl(...args);
    };
  }
  return {
    calls,
    restore: () => {
      for (const [name, fn] of Object.entries(saved)) client[name] = fn;
    },
  };
}

export const VECTOR = Array.from({ length: 768 }, (_, i) => i / 768);

// Ollama の /api/embed と /api/tags に答える fetch。`ok: false` で落ちた Ollama を真似る。
export function stubOllama(opts: { ok?: boolean } = {}): { restore: () => void } {
  const ok = opts.ok ?? true;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (!ok) return new Response("ollama down", { status: 500 });
    if (url.endsWith("/api/embed")) {
      return Response.json({ embeddings: [VECTOR] });
    }
    if (url.endsWith("/api/tags")) {
      return Response.json({ models: [] });
    }
    return new Response("unexpected url", { status: 404 });
  }) as typeof fetch;
  return { restore: () => (globalThis.fetch = original) };
}

export function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
