import { NextResponse } from "next/server";
import { getAuth, NEWAPI_BASE_URL, zhMessage } from "@/lib/auth";
import { readSettings } from "@/lib/settings";
import { LIMITS, rateLimit } from "@/lib/rateLimit.server";
import {
  agentProvider,
  buildReasoningParams,
  isValidAgentModel,
  isValidReasoningLevel,
  type ReasoningLevel,
} from "@/lib/agentModels";
import { adaptNativeStream, buildNativeSearchRequest } from "@/lib/agentNativeSearch.server";
import { buildSearchContext, rewriteSearchQuery, webSearch } from "@/lib/webSearch.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_ENDPOINT = "/v1/chat/completions";
const MAX_TOKENS = 8192;

// Proxies one Agent chat turn to the upstream OpenAI-compatible
// /v1/chat/completions endpoint (Bearer token from data/settings.json — the
// same token the image-generation and vision features use) and streams its
// SSE response back to the client. First-phase Agent feature: plain
// multimodal chat only, no tool calls / agent loop / skills (later phases).
//
// The stream is no longer forwarded byte-for-byte: we re-frame it as
// text/event-stream ourselves so a mid-stream upstream failure (non-standard
// data line, or the connection just dying) can be surfaced to the client as
// one last `data: {"tv_error":"..."}` line instead of silently truncating.
export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!rateLimit("generate", auth.uid, LIMITS.GENERATE_PER_UID)) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
  }

  const { apiKey } = await readSettings(auth.uid);
  if (!apiKey) {
    return NextResponse.json({ error: "请先在用户菜单的「令牌设置」中填入 API 令牌" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const model = typeof body.model === "string" ? body.model : "";
  const messages = Array.isArray(body.messages) ? body.messages : null;
  const effortRaw = typeof body.effort === "string" ? body.effort : "high";
  const effort: ReasoningLevel = isValidReasoningLevel(effortRaw) ? effortRaw : "high";

  if (!model || !isValidAgentModel(model)) {
    return NextResponse.json({ error: "不支持的模型" }, { status: 400 });
  }
  if (!messages || !messages.length) {
    return NextResponse.json({ error: "缺少对话内容" }, { status: 400 });
  }

  // "联网搜索" toggle — preferred path: each vendor's NATIVE endpoint with its
  // official search tool (model decides what/when/how often to search; see
  // agentNativeSearch.server.ts). If the native stream fails to start, fall
  // back to the self-hosted search-then-answer flow below (Bing scrape +
  // context injection), which works on the plain chat-completions endpoint.
  if (body.webSearch === true) {
    const provider = agentProvider(model);
    if (provider) {
      const nativeReq = buildNativeSearchRequest(provider, NEWAPI_BASE_URL, apiKey, model, messages, effort);
      let native: Response | null = null;
      try {
        native = await fetch(nativeReq.url, {
          method: "POST",
          headers: nativeReq.headers,
          body: JSON.stringify(nativeReq.body),
          signal: req.signal,
        });
      } catch {
        native = null; // network failure → Bing fallback
      }
      if (native?.ok && native.body) {
        const nativeBody = native.body;
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const enqueue = (frame: Record<string, unknown>) =>
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
            try {
              await adaptNativeStream(provider, nativeBody, enqueue);
            } catch (e) {
              enqueue({ tv_error: zhMessage((e as Error)?.message, "对话流中断，请重试") });
            }
            controller.close();
          },
          cancel() {
            nativeBody.cancel().catch(() => {});
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      }
      // fall through to the Bing fallback with the compat endpoint
    }
  }

  // Self-hosted search fallback: search on this side and inject the results
  // as a system message ahead of the user's latest question. The trace is
  // emitted as a `tv_search` SSE frame; a failed search degrades to a plain
  // un-searched turn instead of failing the whole request.
  let searchTrace: { query: string; results: { title: string; url: string }[]; error?: string } | null = null;
  let finalMessages = messages;
  if (body.webSearch === true) {
    const rawQuery = extractQuery(messages);
    if (rawQuery) {
      // Keyword rewrite first — a raw question keyword-matches badly. Any
      // rewrite failure just falls back to the raw question.
      const query = (await rewriteSearchQuery(NEWAPI_BASE_URL, apiKey, rawQuery).catch(() => "")) || rawQuery;
      try {
        const results = await webSearch(query);
        searchTrace = { query, results: results.map((r) => ({ title: r.title, url: r.url })) };
        finalMessages = [...messages];
        finalMessages.splice(finalMessages.length - 1, 0, {
          role: "system",
          content: buildSearchContext(query, results),
        });
      } catch (e) {
        searchTrace = { query, results: [], error: zhMessage((e as Error)?.message, "联网搜索失败") };
      }
    }
  }

  const { body: reasoningBody, maxTokens } = buildReasoningParams(model, effort);

  const upstreamBody = {
    model,
    messages: finalMessages,
    stream: true,
    max_tokens: maxTokens ?? MAX_TOKENS,
    ...reasoningBody,
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${NEWAPI_BASE_URL}${CHAT_ENDPOINT}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(upstreamBody),
      signal: req.signal,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `网络连接失败，无法连接对话服务：${(e as Error)?.message || e}` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    let message: unknown;
    try {
      message = JSON.parse(text)?.error?.message ?? JSON.parse(text)?.message;
    } catch {
      message = text;
    }
    return NextResponse.json(
      { error: zhMessage(message, `对话请求失败 (HTTP ${upstream.status})`) },
      { status: upstream.status >= 400 ? upstream.status : 502 },
    );
  }

  const encoder = new TextEncoder();
  const upstreamReader = upstream.body.getReader();

  let searchFrameSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      // The search trace goes out as the very first frame so the client can
      // render the source list before (long) reasoning/content arrives.
      if (searchTrace && !searchFrameSent) {
        searchFrameSent = true;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tv_search: searchTrace })}\n\n`));
        return;
      }
      try {
        const { done, value } = await upstreamReader.read();
        if (done) {
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (e) {
        const msg = zhMessage((e as Error)?.message, "对话流中断，请重试");
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tv_error: msg })}\n\n`));
        controller.close();
      }
    },
    cancel() {
      upstreamReader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/** Search query = the latest user message's plain text (multimodal content
 *  arrays contribute their text parts), trimmed and capped for the engine. */
function extractQuery(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: unknown; content?: unknown };
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content.trim().slice(0, 100);
    if (Array.isArray(m.content)) {
      const text = (m.content as { type?: unknown; text?: unknown }[])
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text as string)
        .join(" ");
      return text.trim().slice(0, 100);
    }
    return "";
  }
  return "";
}
