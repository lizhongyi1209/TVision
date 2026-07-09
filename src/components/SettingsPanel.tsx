"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { diag } from "@/lib/logStore";
import { ROUTE_OPTIONS } from "@/lib/models";
import { useStudio } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Button, Field } from "./ui";

export function SettingsPanel() {
  const settings = useStudio((s) => s.settings);
  const setSettings = useStudio((s) => s.setSettings);
  const close = useStudio((s) => s.closeSettings);
  const showToast = useStudio((s) => s.showToast);

  const [apiKey, setApiKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setApiKey("");
    setTestMsg(null);
  }, [settings]);

  async function test() {
    setTesting(true);
    setTestMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((x) => x.json());
      setTestMsg({ ok: !!r.ok, message: r.message });
      if (r.ok) {
        diag("info", "连接测试", r.message || "连接测试成功");
      } else {
        diag("error", "连接测试", "连接测试失败", r.message);
      }
    } catch {
      setTestMsg({ ok: false, message: "请求失败" });
      diag("error", "连接测试", "连接测试请求失败");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((x) => x.json());
      setSettings(r);
      showToast("success", "设置已保存");
    } catch {
      showToast("error", "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={close}
      />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", stiffness: 320, damping: 34 }}
        className="glass fixed inset-y-0 right-0 z-[101] flex w-[min(440px,100vw)] flex-col rounded-l-panel"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Icon name="Gear" size={18} className="text-accent" />
            <span className="font-medium text-fg">设置</span>
          </div>
          <button onClick={close} className="text-fg-mute hover:text-fg" aria-label="关闭">
            <Icon name="X" size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* API */}
          <section className="space-y-3">
            <Field
              label="API 令牌 (Bearer)"
              hint={settings?.hasApiKey ? `已保存：${settings.apiKeyMasked}，留空则不改动` : "基于 new-api 的令牌，按 o1key 余额计费"}
            >
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={settings?.hasApiKey ? "•••••••• (已设置)" : "sk-..."}
                className="h-10 w-full rounded-control border border-line bg-panel-2 px-3 text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
              />
            </Field>
            <Field label="线路">
              <div className="flex h-10 w-full items-center rounded-control border border-line bg-panel-2 px-3 text-sm text-fg-dim">
                {ROUTE_OPTIONS[0].label}
              </div>
            </Field>

            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={test} disabled={testing}>
                {testing ? <Icon name="CircleNotch" size={15} className="animate-spin" /> : <Icon name="Lightning" size={15} />}
                测试连接
              </Button>
              {testMsg ? (
                <span className={cn("flex items-center gap-1 text-xs", testMsg.ok ? "text-accent" : "text-red-300")}>
                  <Icon name={testMsg.ok ? "Check" : "Warning"} size={13} weight="bold" />
                  <span className="max-w-[220px]">{testMsg.message}</span>
                </span>
              ) : null}
            </div>
          </section>

          <p className="text-xs leading-relaxed text-fg-mute">
            令牌与图片仅保存在本机（<span className="font-mono">data/settings.json</span> 与{" "}
            <span className="font-mono">output/</span>），不会上传到除 o1key 之外的任何服务器。
          </p>
        </div>

        <div className="border-t border-line px-5 py-4">
          <Button variant="primary" onClick={save} disabled={saving} className="w-full">
            {saving ? <Icon name="CircleNotch" size={16} className="animate-spin" /> : <Icon name="Check" size={16} weight="bold" />}
            保存设置
          </Button>
        </div>
      </motion.aside>
    </>
  );
}
