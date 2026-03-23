import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.MEMORY_API_URL ?? "http://localhost:3000";

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  return res.json();
}

const server = new McpServer({
  name: "memory",
  version: "0.1.0",
});

server.tool(
  "save_memory",
  "記憶を保存する（テキスト + タグ + タイプで分類）",
  {
    text: z.string().describe("記憶する内容"),
    tags: z.array(z.string()).optional().describe("タグ (例: ['home-rss', 'spin', 'cnp'])"),
    type: z
      .enum(["user", "feedback", "project", "reference"])
      .optional()
      .describe("user=ユーザー情報, feedback=作業指針, project=プロジェクト状況, reference=外部リソース参照"),
    source: z.string().optional().describe("保存元 (例: claude-code, cluster-agent)"),
  },
  async ({ text, tags, type, source }) => {
    const result = await api("/memories", {
      method: "POST",
      body: JSON.stringify({
        text,
        tags: tags ?? [],
        type: type ?? "general",
        source: source ?? "claude-code",
      }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "search_memory",
  "意味検索で関連する記憶を取得する",
  {
    query: z.string().describe("検索クエリ（自然言語）"),
    tags: z.array(z.string()).optional().describe("タグでフィルタ"),
    type: z
      .enum(["user", "feedback", "project", "reference"])
      .optional()
      .describe("タイプでフィルタ"),
    limit: z.number().optional().describe("取得件数 (デフォルト10)"),
  },
  async ({ query, tags, type, limit }) => {
    const result = await api("/memories/search", {
      method: "POST",
      body: JSON.stringify({ query, tags, type, limit }),
    });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "delete_memory",
  "記憶を削除する",
  {
    id: z.string().describe("メモリID (UUID)"),
  },
  async ({ id }) => {
    const result = await api(`/memories/${id}`, { method: "DELETE" });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool(
  "list_recent",
  "最近の記憶を一覧取得する（セマンティック検索なし）",
  {
    limit: z.number().optional().describe("取得件数 (デフォルト20)"),
    type: z
      .enum(["user", "feedback", "project", "reference"])
      .optional()
      .describe("タイプでフィルタ"),
    tags: z.array(z.string()).optional().describe("タグでフィルタ"),
  },
  async ({ limit, type, tags }) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (type) params.set("type", type);
    if (tags?.length) params.set("tags", tags.join(","));
    const query = params.toString();
    const result = await api(`/memories${query ? `?${query}` : ""}`);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
