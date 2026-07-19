// Per-tenant settings. The API token lives in the tenants table (encrypted,
// see tenant.server.ts) — one per user, keyed by uid — instead of the old
// single data/settings.json shared by the whole deployment. Function names
// kept, a `uid` first param threaded through every call site.

import type { PublicSettings, Settings, SettingsDefaults } from "./types";
import { DEFAULT_ROUTE } from "./o1key.ts";
import { getTenantApiKey, readTenantDefaults, writeTenantDefaults } from "./tenant.server.ts";

const DEFAULTS: Settings = {
  apiKey: "",
  route: DEFAULT_ROUTE,
  defaults: { model: "Nano Banana 2", resolution: "2K", billing: "特价", aspectRatio: "auto" },
};

export async function readSettings(uid: string): Promise<Settings> {
  const stored = readTenantDefaults(uid) as Partial<SettingsDefaults>;
  return {
    apiKey: getTenantApiKey(uid),
    route: DEFAULT_ROUTE,
    defaults: { ...DEFAULTS.defaults, ...stored },
  };
}

export async function writeSettings(
  uid: string,
  patch: { defaults?: Partial<SettingsDefaults> },
): Promise<Settings> {
  if (patch.defaults) {
    const cur = readTenantDefaults(uid) as Partial<SettingsDefaults>;
    writeTenantDefaults(uid, { ...cur, ...patch.defaults });
  }
  return readSettings(uid);
}

export function toPublic(s: Settings): PublicSettings {
  const { apiKey, ...rest } = s;
  const masked = apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}` : "";
  return { ...rest, hasApiKey: !!apiKey, apiKeyMasked: masked };
}
