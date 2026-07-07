import { NextResponse } from "next/server";
import { readSettings, toPublic, writeSettings } from "@/lib/settings";
import type { Billing, ModelName, Resolution, RouteName, SettingsDefaults } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ROUTES: RouteName[] = ["全球加速", "CF加速", "美国直连"];

export async function GET() {
  const s = await readSettings();
  return NextResponse.json(toPublic(s));
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Partial<{
    apiKey: string;
    route: RouteName;
    baseUrlOverride: string;
    defaults: SettingsDefaults;
  }> & { clearApiKey?: boolean } = {};

  if (typeof body.apiKey === "string" && body.apiKey.trim()) patch.apiKey = body.apiKey.trim();
  if (body.clearApiKey === true) patch.clearApiKey = true;
  if (typeof body.route === "string" && VALID_ROUTES.includes(body.route as RouteName)) {
    patch.route = body.route as RouteName;
  }
  if (typeof body.baseUrlOverride === "string") patch.baseUrlOverride = body.baseUrlOverride.trim();
  if (body.defaults && typeof body.defaults === "object") {
    const d = body.defaults as Record<string, unknown>;
    patch.defaults = {
      model: d.model as ModelName,
      resolution: d.resolution as Resolution,
      billing: d.billing as Billing,
      aspectRatio: String(d.aspectRatio ?? "auto"),
    };
  }

  const next = await writeSettings(patch);
  return NextResponse.json(toPublic(next));
}
