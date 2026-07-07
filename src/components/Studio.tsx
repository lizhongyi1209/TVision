"use client";

import { AnimatePresence } from "motion/react";
import { useCallback, useEffect } from "react";
import { useStudio } from "@/lib/store";
import { GenerateBar } from "./GenerateBar";
import { Grain } from "./Grain";
import { HistoryRail } from "./HistoryRail";
import { Icon } from "./icons";
import { ResultView } from "./ResultView";
import { SettingsPanel } from "./SettingsPanel";
import { Stage } from "./Stage";
import { Toaster } from "./Toaster";
import { IconButton } from "./ui";

export default function Studio() {
  const image = useStudio((s) => s.image);
  const setImage = useStudio((s) => s.setImage);
  const params = useStudio((s) => s.params);
  const updateParams = useStudio((s) => s.updateParams);
  const setSettings = useStudio((s) => s.setSettings);
  const openSettings = useStudio((s) => s.openSettings);
  const toggleHistory = useStudio((s) => s.toggleHistory);
  const settingsOpen = useStudio((s) => s.settingsOpen);
  const historyOpen = useStudio((s) => s.historyOpen);
  const showToast = useStudio((s) => s.showToast);
  const setHistory = useStudio((s) => s.setHistory);

  const phase = useStudio((s) => s.phase);
  const jobIds = useStudio((s) => s.jobIds);
  const setProgress = useStudio((s) => s.setProgress);
  const setResults = useStudio((s) => s.setResults);
  const setPhase = useStudio((s) => s.setPhase);
  const setError = useStudio((s) => s.setError);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await fetch("/api/history").then((r) => r.json());
      setHistory(h.items || []);
    } catch {
      // ignore
    }
  }, [setHistory]);

  // First load: pull settings + history, nudge for a token if missing.
  useEffect(() => {
    (async () => {
      try {
        const s = await fetch("/api/settings").then((r) => r.json());
        setSettings(s);
        updateParams({
          model: s.defaults.model,
          resolution: s.defaults.resolution,
          billing: s.defaults.billing,
          aspectRatio: s.defaults.aspectRatio,
        });
        if (!s.hasApiKey) {
          openSettings();
          showToast("info", "请先填入 o1key 令牌");
        }
      } catch {
        // ignore
      }
    })();
    refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Polling engine: one loop per submitted task, aggregate progress, collect results.
  useEffect(() => {
    if (phase !== "running" || jobIds.length === 0) return;
    let cancelled = false;
    const imgs: (string[] | null)[] = jobIds.map(() => null);
    const errs: (string | null)[] = jobIds.map(() => null);
    const prog: number[] = jobIds.map(() => 0);
    let done = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = () => {
      if (cancelled) return;
      const all = imgs.flatMap((x) => x || []);
      if (all.length) {
        setResults(all);
        setPhase("success");
        showToast("success", `完成 ${all.length} 张`);
        refreshHistory();
      } else {
        const e = errs.find(Boolean) || "生成失败";
        setError(e);
        setPhase("error");
        showToast("error", e);
      }
    };

    const tick = async (i: number) => {
      if (cancelled) return;
      try {
        const r = await fetch(`/api/jobs/${encodeURIComponent(jobIds[i])}`).then((x) => x.json());
        if (cancelled) return;
        if (r.status === "success") {
          imgs[i] = r.images || [];
          prog[i] = 1;
          done++;
        } else if (r.status === "failed") {
          errs[i] = r.error || "生成失败";
          prog[i] = 1;
          done++;
        } else {
          prog[i] = typeof r.progress === "number" ? r.progress : prog[i];
          timers.push(setTimeout(() => tick(i), 1800));
        }
        setProgress(prog.reduce((a, b) => a + b, 0) / jobIds.length);
        if (done === jobIds.length) finish();
      } catch {
        if (!cancelled) timers.push(setTimeout(() => tick(i), 2600));
      }
    };

    jobIds.forEach((_, i) => tick(i));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, jobIds]);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-ink">
      <Grain />

      <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-accent shadow-[0_0_12px_var(--color-accent)]" />
          <span className="text-sm font-medium tracking-tight text-fg">
            taste <span className="text-fg-mute">· studio</span>
          </span>
          <span className="ml-1 hidden text-xs text-fg-mute md:block">本地电商 AI 生图</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 hidden rounded-full border border-line px-3 py-1 font-mono text-xs text-fg-dim sm:block">
            {params.model} · {params.resolution}
          </span>
          {image ? <IconButton name="Plus" label="重新添加图片" onClick={() => setImage(null)} /> : null}
          <IconButton name="Stack" label="历史生成" active={historyOpen} onClick={toggleHistory} />
          <IconButton name="Gear" label="设置" active={settingsOpen} onClick={openSettings} />
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden">
        <Stage />
        <GenerateBar />
        <ResultView />
      </main>

      <AnimatePresence>{settingsOpen ? <SettingsPanel /> : null}</AnimatePresence>
      <AnimatePresence>{historyOpen ? <HistoryRail /> : null}</AnimatePresence>
      <Toaster />
    </div>
  );
}
