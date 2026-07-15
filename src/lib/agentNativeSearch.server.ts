// Native web-search streaming for the Agent chat. The OpenAI-compat
// /v1/chat/completions endpoint drops every search-tool shape (probed live:
// scripts/test-web-search.mjs), but new-api also proxies each vendor's NATIVE
// endpoint, where the official search tools pass through verbatim
// (scripts/test-native-search.mjs — all three confirmed working):
//
//   openai  → POST /v1/responses            tools:[{type:"web_search"}]
//   gemini  → POST /v1beta/models/{m}:streamGenerateContent?alt=sse
//                                           tools:[{google_search:{}}]
//   claude  → POST /v1/messages             tools:[{type:"web_search_20250305",...}]
//
// Each native SSE dialect is adapted here into the OpenAI-chat-chunk-shaped
// frames the client already parses (delta.content / delta.reasoning_content),
// plus cumulative `tv_search` frames carrying the model's own search queries
// and cited sources. Server-only; consumed by api/agent/chat/route.ts.

import { buildReasoningParams, type AgentProvider, type ReasoningLevel } from "./agentModels";

/** OpenAI-style message list as the client store builds it (see
 *  agentChatStore.ts) — plain string content or multimodal parts. */
type ClientMessage = { role: string; content: string | ClientPart[] };
type ClientPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } };

export interface SearchTrace {
  query: string;
  results: { title: string; url: string }[];
}

const MAX_TOKENS = 8192;
const MAX_SEARCHES = 5;

// ── request builders ─────────────────────────────────────────────────────────

export function buildNativeSearchRequest(
  provider: AgentProvider,
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: ClientMessage[],
  effort: ReasoningLevel,
): { url: string; headers: Record<string, string>; body: unknown } {
  if (provider === "gemini") {
    return {
      url: `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: {
        contents: toGeminiContents(messages),
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: MAX_TOKENS },
      },
    };
  }
  if (provider === "claude") {
    const { body: thinkingBody, maxTokens } = buildReasoningParams(model, effort);
    return {
      url: `${baseUrl}/v1/messages`,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model,
        stream: true,
        max_tokens: maxTokens ?? MAX_TOKENS,
        ...thinkingBody,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
        messages: toClaudeMessages(messages),
      },
    };
  }
  // openai → Responses API
  return {
    url: `${baseUrl}/v1/responses`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: {
      model,
      stream: true,
      max_output_tokens: MAX_TOKENS,
      reasoning: { effort },
      tools: [{ type: "web_search" }],
      input: toResponsesInput(messages),
    },
  };
}

function splitDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  return m ? { mime: m[1], data: m[2] } : null;
}

function toGeminiContents(messages: ClientMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const parts: unknown[] = [];
    if (typeof m.content === "string") {
      if (m.content) parts.push({ text: m.content });
    } else {
      for (const p of m.content) {
        if (p.type === "text" && p.text) parts.push({ text: p.text });
        else if (p.type === "image_url") {
          const d = splitDataUrl(p.image_url.url);
          if (d) parts.push({ inlineData: { mimeType: d.mime, data: d.data } });
        } else if (p.type === "file") {
          const d = splitDataUrl(p.file.file_data);
          if (d) parts.push({ inlineData: { mimeType: d.mime, data: d.data } });
        } else if (p.type === "input_audio") {
          parts.push({
            inlineData: {
              mimeType: p.input_audio.format === "mp3" ? "audio/mpeg" : "audio/wav",
              data: p.input_audio.data,
            },
          });
        }
      }
    }
    if (parts.length) out.push({ role: m.role === "assistant" ? "model" : "user", parts });
  }
  return out;
}

function toClaudeMessages(messages: ClientMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "assistant" : "user";
    if (typeof m.content === "string") {
      if (m.content) out.push({ role, content: m.content });
      continue;
    }
    const blocks: unknown[] = [];
    for (const p of m.content) {
      if (p.type === "text" && p.text) blocks.push({ type: "text", text: p.text });
      else if (p.type === "image_url") {
        const d = splitDataUrl(p.image_url.url);
        if (d) blocks.push({ type: "image", source: { type: "base64", media_type: d.mime, data: d.data } });
      } else if (p.type === "file") {
        const d = splitDataUrl(p.file.file_data);
        if (d) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: d.data } });
      }
      // input_audio: Claude has no audio input — the composer gates this off.
    }
    if (blocks.length) out.push({ role, content: blocks });
  }
  return out;
}

function toResponsesInput(messages: ClientMessage[]): unknown[] {
  const out: unknown[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      if (m.content) out.push({ role: m.role, content: m.content });
      continue;
    }
    const isUser = m.role !== "assistant";
    const parts: unknown[] = [];
    for (const p of m.content) {
      if (p.type === "text" && p.text) parts.push({ type: isUser ? "input_text" : "output_text", text: p.text });
      else if (p.type === "image_url" && isUser) parts.push({ type: "input_image", image_url: p.image_url.url });
      else if (p.type === "file" && isUser)
        parts.push({ type: "input_file", filename: p.file.filename, file_data: p.file.file_data });
      // input_audio unsupported here — gated off in the composer.
    }
    if (parts.length) out.push({ role: m.role, content: parts });
  }
  return out;
}

// ── stream adapters ──────────────────────────────────────────────────────────

/** Iterates the JSON payloads of an SSE body (`data:` lines only). */
async function* sseJson(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, any>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          yield JSON.parse(payload);
        } catch {
          // skip malformed frame
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

type Enqueue = (frame: Record<string, unknown>) => void;

const contentFrame = (text: string) => ({ choices: [{ delta: { content: text } }] });
const reasoningFrame = (text: string) => ({ choices: [{ delta: { reasoning_content: text } }] });

/** Adapts one native SSE stream into client-facing frames. Throws on an
 *  upstream-signalled error so the route can emit tv_error. */
export async function adaptNativeStream(
  provider: AgentProvider,
  body: ReadableStream<Uint8Array>,
  enqueue: Enqueue,
): Promise<void> {
  const queries: string[] = [];
  const sources: { title: string; url: string }[] = [];
  const addQuery = (q: unknown) => {
    if (typeof q === "string" && q && !queries.includes(q)) queries.push(q);
  };
  const addSource = (title: unknown, url: unknown) => {
    if (typeof url !== "string" || !url || sources.some((s) => s.url === url)) return;
    sources.push({ title: typeof title === "string" && title ? title : url, url });
  };
  // Cumulative — later frames overwrite the message's search trace client-side.
  const emitSearch = () => {
    if (!queries.length && !sources.length) return;
    enqueue({ tv_search: { query: queries.join("；") || "模型自主搜索", results: sources } satisfies SearchTrace });
  };

  if (provider === "gemini") {
    for await (const j of sseJson(body)) {
      if (j.error) throw new Error(j.error.message || "上游错误");
      const cand = j.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        if (typeof p.text === "string" && p.text) enqueue(p.thought === true ? reasoningFrame(p.text) : contentFrame(p.text));
      }
      const gm = cand?.groundingMetadata;
      if (gm) {
        for (const q of gm.webSearchQueries ?? []) addQuery(q);
        for (const c of gm.groundingChunks ?? []) addSource(c.web?.title, c.web?.uri);
      }
    }
    emitSearch(); // grounding metadata arrives in the trailing frames
    return;
  }

  if (provider === "claude") {
    // Blocks are addressed by index; type comes only with content_block_start.
    const blockTypes: Record<number, string> = {};
    const toolInputs: Record<number, string> = {};
    for await (const j of sseJson(body)) {
      switch (j.type) {
        case "content_block_start": {
          const idx = j.index as number;
          blockTypes[idx] = j.content_block?.type ?? "";
          toolInputs[idx] = "";
          if (blockTypes[idx] === "web_search_tool_result") {
            for (const r of j.content_block?.content ?? []) {
              if (r?.type === "web_search_result") addSource(r.title, r.url);
            }
            emitSearch();
          }
          break;
        }
        case "content_block_delta": {
          const d = j.delta;
          if (d?.type === "thinking_delta" && d.thinking) enqueue(reasoningFrame(d.thinking));
          else if (d?.type === "text_delta" && d.text) enqueue(contentFrame(d.text));
          else if (d?.type === "input_json_delta" && typeof d.partial_json === "string")
            toolInputs[j.index as number] = (toolInputs[j.index as number] ?? "") + d.partial_json;
          break;
        }
        case "content_block_stop": {
          const idx = j.index as number;
          if (blockTypes[idx] === "server_tool_use" && toolInputs[idx]) {
            try {
              addQuery(JSON.parse(toolInputs[idx])?.query);
              emitSearch();
            } catch {
              // partial/invalid tool input — ignore
            }
          }
          break;
        }
        case "error":
          throw new Error(j.error?.message || "上游错误");
      }
    }
    return;
  }

  // openai Responses API
  for await (const j of sseJson(body)) {
    switch (j.type) {
      case "response.output_text.delta":
        if (typeof j.delta === "string" && j.delta) enqueue(contentFrame(j.delta));
        break;
      case "response.reasoning_summary_text.delta":
      case "response.reasoning_text.delta":
        if (typeof j.delta === "string" && j.delta) enqueue(reasoningFrame(j.delta));
        break;
      case "response.output_item.added":
      case "response.output_item.done": {
        const item = j.item;
        if (item?.type === "web_search_call") {
          addQuery(item.action?.query);
          emitSearch();
        } else if (item?.type === "message" && j.type === "response.output_item.done") {
          for (const c of item.content ?? []) {
            for (const a of c.annotations ?? []) {
              if (a?.type === "url_citation") addSource(a.title, a.url);
            }
          }
          emitSearch();
        }
        break;
      }
      case "response.output_text.annotation.added": {
        const a = j.annotation;
        if (a?.type === "url_citation") {
          addSource(a.title, a.url);
          emitSearch();
        }
        break;
      }
      case "response.failed":
        throw new Error(j.response?.error?.message || "上游错误");
      case "error":
        throw new Error(j.message || j.error?.message || "上游错误");
    }
  }
}
