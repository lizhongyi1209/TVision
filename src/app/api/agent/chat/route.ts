import { NextResponse } from "next/server";
import { getAuth, NEWAPI_BASE_URL, zhMessage } from "@/lib/auth";
import { buildReasoningParams, isValidAgentModel, isValidReasoningLevel, type ReasoningLevel } from "@/lib/agentModels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAT_ENDPOINT = "/pg/chat/completions";
const MAX_TOKENS = 8192;

// Proxies one Agent chat turn to the upstream new-api "pg" gateway and
// streams its SSE response back to the client. First-phase Agent feature:
// plain multimodal chat only, no tool calls / agent loop / skills (later
// phases).
//
// The stream is no longer forwarded byte-for-byte: we re-frame it as
// text/event-stream ourselves so a mid-stream upstream failure (non-standard
// data line, or the connection just dying) can be surfaced to the client as
// one last `data: {"tv_error":"..."}` line instead of silently truncating.
export async function POST(req: Request) {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

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

  const { body: reasoningBody, maxTokens } = buildReasoningParams(model, effort);

  const upstreamBody = {
    model,
    messages,
    group: "auto",
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
        Cookie: auth.session,
        "New-Api-User": auth.uid,
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

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
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
