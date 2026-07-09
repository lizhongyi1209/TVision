"use client";

import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { diag, useLogStore } from "@/lib/logStore";
import { useStudio } from "@/lib/store";
import { compositeInpaintResult, fakeProgressCurve } from "@/lib/utils";
import { BrushPanel } from "./BrushPanel";
import { CropPanel } from "./CropPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { GenerateBar } from "./GenerateBar";
import { Grain } from "./Grain";
import { HistoryRail } from "./HistoryRail";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { ResultView } from "./ResultView";
import { SettingsPanel } from "./SettingsPanel";
import { Stage } from "./Stage";
import { Toaster } from "./Toaster";
import { IconButton } from "./ui";

export default function Studio() {
  const image = useStudio((s) => s.image);
  const setImage = useStudio((s) => s.setImage);
  const updateParams = useStudio((s) => s.updateParams);
  const setSettings = useStudio((s) => s.setSettings);
  const openSettings = useStudio((s) => s.openSettings);
  const cropOpen = useStudio((s) => s.cropOpen);
  const brushPanelOpen = useStudio((s) => s.brushPanelOpen);
  const toggleHistory = useStudio((s) => s.toggleHistory);
  const closeSettings = useStudio((s) => s.closeSettings);
  const closeHistory = useStudio((s) => s.closeHistory);
  const settingsOpen = useStudio((s) => s.settingsOpen);
  const historyOpen = useStudio((s) => s.historyOpen);
  const showToast = useStudio((s) => s.showToast);
  const setHistory = useStudio((s) => s.setHistory);

  const panelOpen = useLogStore((s) => s.panelOpen);
  const togglePanel = useLogStore((s) => s.togglePanel);
  const closePanel = useLogStore((s) => s.closePanel);
  const unreadErrors = useLogStore((s) => s.unreadErrors);

  const phase = useStudio((s) => s.phase);
  const jobIds = useStudio((s) => s.jobIds);
  const startedAt = useStudio((s) => s.startedAt);
  const setRealProgress = useStudio((s) => s.setRealProgress);
  const setProgress = useStudio((s) => s.setProgress);
  const setResults = useStudio((s) => s.setResults);
  const setPhase = useStudio((s) => s.setPhase);
  const setError = useStudio((s) => s.setError);

  // Diagnostics / settings / history are a mutually-exclusive panel group.
  // panelOpen lives in its own store (useLogStore) so high-frequency log
  // writes don't ripple into useStudio subscribers; these wrappers keep the
  // "only one panel open at a time" behavior in sync across both stores.
  function onOpenSettings() {
    closePanel();
    openSettings();
  }
  function onToggleHistory() {
    closePanel();
    toggleHistory();
  }
  function onToggleDiagnostics() {
    closeSettings();
    closeHistory();
    togglePanel();
  }

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
    // Consecutive network-failure counter per job (reset to 0 on any successful
    // round-trip, regardless of the job's own status). Only used to throttle
    // the "can't reach the server" diagnostics so it doesn't spam on every retry.
    const failCounts: number[] = jobIds.map(() => 0);
    let done = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const finish = async () => {
      if (cancelled) return;
      const all = imgs.flatMap((x) => x || []);
      if (all.length) {
        // Local-repaint jobs: composite each returned block back onto the
        // original image (feathered blend through inpaintJob's mask) before
        // ever showing results — each image composited independently.
        const job = useStudio.getState().inpaintJob;
        let finalImages = all;
        if (job) {
          finalImages = await Promise.all(
            all.map(async (src) => {
              try {
                return await compositeInpaintResult(job, src);
              } catch (e) {
                diag("warn", "局部重绘", "单张合成失败，已回退原始生成结果", (e as Error)?.message || String(e));
                return src;
              }
            }),
          );
          // Compositing is async — re-check in case this run got cancelled
          // (new job started / component unmounted) while it was in flight.
          if (cancelled) return;
          diag("info", "局部重绘", `合成完成 ${finalImages.length} 张`);
        }
        setResults(finalImages);
        setPhase("success");
        showToast("success", "生成完成");
        refreshHistory();
        const secs = startedAt ? (Date.now() - startedAt) / 1000 : null;
        diag("info", "轮询", `生成完成，耗时 ${secs !== null ? secs.toFixed(1) : "?"}s`);
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
        failCounts[i] = 0;
        if (r.status === "success") {
          imgs[i] = r.images || [];
          prog[i] = 1;
          done++;
        } else if (r.status === "failed") {
          errs[i] = r.error || "生成失败";
          prog[i] = 1;
          done++;
          diag("error", "轮询", "任务生成失败", `任务 ID: ${jobIds[i]}\n${r.error || "生成失败"}`);
        } else {
          prog[i] = typeof r.progress === "number" ? r.progress : prog[i];
          timers.push(setTimeout(() => tick(i), 1800));
        }
        setRealProgress(prog.reduce((a, b) => a + b, 0) / jobIds.length);
        if (done === jobIds.length) void finish();
      } catch (err) {
        if (cancelled) return;
        failCounts[i] += 1;
        const detail = `任务 ID: ${jobIds[i]}\n${(err as Error)?.message || String(err)}`;
        if (failCounts[i] === 1) {
          diag("warn", "轮询", "轮询请求失败，自动重试中", detail);
        } else if (failCounts[i] === 5) {
          diag("error", "轮询", "多次无法连接本地服务，请检查服务是否还在运行", detail);
        }
        timers.push(setTimeout(() => tick(i), 2600));
      }
    };

    jobIds.forEach((_, i) => tick(i));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, jobIds]);

  // Fake-progress engine: gives a smooth, ever-forward sense of progress while
  // real completion is coarse/bursty. Real completion only ever raises the
  // floor, never overtakes the eased curve until the job actually finishes.
  const startedAtRef = useRef(startedAt);
  startedAtRef.current = startedAt;
  useEffect(() => {
    if (phase !== "submitting" && phase !== "running") return;
    const count = Math.max(1, useStudio.getState().params.count, jobIds.length);
    const speedup = count > 1 ? 1.2 : 1;

    const tick = () => {
      const started = startedAtRef.current;
      if (!started) return;
      const seconds = (Date.now() - started) / 1000 / speedup;
      const fake = fakeProgressCurve(seconds);
      const real = useStudio.getState().realProgress * 100;
      const next = Math.min(96, Math.max(fake, real * 0.9));
      setProgress(next / 100);
    };

    tick();
    const id = setInterval(tick, 300);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, jobIds.length]);

  // Snap progress to 100% once success/idle/error land; keep the transition CSS-driven.
  useEffect(() => {
    if (phase === "success") setProgress(1);
    else if (phase === "idle" || phase === "error") setProgress(0);
  }, [phase, setProgress]);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-ink">
      <Grain />

      <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <Logo />
        <div className="flex items-center gap-1.5">
          {image ? <IconButton name="Plus" label="重新添加图片" onClick={() => setImage(null)} /> : null}
          <IconButton name="Stack" label="历史生成" active={historyOpen} onClick={onToggleHistory} />
          <div className="relative">
            <IconButton name="Pulse" label="诊断台" active={panelOpen} onClick={onToggleDiagnostics} />
            {unreadErrors > 0 ? (
              <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-400 ring-2 ring-ink" />
            ) : null}
          </div>
          <IconButton name="Gear" label="设置" active={settingsOpen} onClick={onOpenSettings} />
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden">
        <Stage />
        <GenerateBar />
        <ResultView />
      </main>

      <AnimatePresence>{cropOpen ? <CropPanel /> : null}</AnimatePresence>
      <AnimatePresence>{brushPanelOpen ? <BrushPanel /> : null}</AnimatePresence>
      <AnimatePresence>{settingsOpen ? <SettingsPanel /> : null}</AnimatePresence>
      <AnimatePresence>{historyOpen ? <HistoryRail /> : null}</AnimatePresence>
      <AnimatePresence>{panelOpen ? <DiagnosticsPanel /> : null}</AnimatePresence>
      <Toaster />
    </div>
  );
}
