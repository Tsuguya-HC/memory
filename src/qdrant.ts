import { QdrantClient } from "@qdrant/js-client-rest";

const QDRANT_URL = process.env.QDRANT_URL ?? "http://localhost:6333";
const COLLECTION = "memories";
const VECTOR_SIZE = 768;

export const qdrant = new QdrantClient({ url: QDRANT_URL });

export async function ensureCollection(): Promise<void> {
  const collections = await qdrant.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);
  if (!exists) {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "tags",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "type",
      field_schema: "keyword",
    });
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: "source",
      field_schema: "keyword",
    });
  }
}

export interface Memory {
  text: string;
  tags: string[];
  type: string;
  source: string;
  created_at: string;
}

export async function upsertMemory(
  id: string,
  vector: number[],
  payload: Memory
): Promise<void> {
  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: [{ id, vector, payload: payload as unknown as Record<string, unknown> }],
  });
}

export interface SearchOptions {
  tags?: string[];
  type?: string;
  limit?: number;
}

export async function searchMemories(
  vector: number[],
  options: SearchOptions = {}
): Promise<Array<{ id: string; score: number; payload: Memory }>> {
  const filter: Record<string, unknown>[] = [];
  if (options.tags?.length) {
    filter.push({ key: "tags", match: { any: options.tags } });
  }
  if (options.type) {
    filter.push({ key: "type", match: { value: options.type } });
  }

  const { points } = await qdrant.query(COLLECTION, {
    query: vector,
    limit: options.limit ?? 10,
    with_payload: true,
    filter: filter.length ? { must: filter } : undefined,
  });

  return points.map((r) => ({
    id: String(r.id),
    score: r.score,
    payload: r.payload as unknown as Memory,
  }));
}

export async function getMemory(
  id: string
): Promise<{ id: string; payload: Memory } | null> {
  let points;
  try {
    points = await qdrant.retrieve(COLLECTION, { ids: [id], with_payload: true });
  } catch (err) {
    // UUID でも整数でもない id は Qdrant が 400 で弾く。そういう id の記憶は
    // 存在しないので null にする。接続できない・5xx などの障害は 404 に
    // 化けさせず、呼び出し元へそのまま投げる。
    if ((err as { status?: unknown }).status === 400) return null;
    throw err;
  }
  if (!points.length) return null;
  return { id: String(points[0].id), payload: points[0].payload as unknown as Memory };
}

export async function deleteMemory(id: string): Promise<void> {
  await qdrant.delete(COLLECTION, { wait: true, points: [id] });
}

export async function listMemories(
  options: SearchOptions = {}
): Promise<Array<{ id: string; payload: Memory }>> {
  const filter: Record<string, unknown>[] = [];
  if (options.tags?.length) {
    filter.push({ key: "tags", match: { any: options.tags } });
  }
  if (options.type) {
    filter.push({ key: "type", match: { value: options.type } });
  }

  const results = await qdrant.scroll(COLLECTION, {
    limit: options.limit ?? 20,
    with_payload: true,
    filter: filter.length ? { must: filter } : undefined,
    order_by: { key: "created_at", direction: "desc" },
  });

  return results.points.map((r) => ({
    id: String(r.id),
    payload: r.payload as unknown as Memory,
  }));
}

export async function healthCheck(): Promise<boolean> {
  try {
    const res = await qdrant.getCollections();
    return Array.isArray(res.collections);
  } catch {
    return false;
  }
}
