"use client";

import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { useBatchStore } from "@/lib/batchStore";
import { useBoardStore } from "@/lib/boardStore";
import { diag, useLogStore } from "@/lib/logStore";
import { useStudio } from "@/lib/store";
import { compositeInpaintResult, downscaleImageSrc, fakeProgressCurve } from "@/lib/utils";
import { AgentPanel } from "./AgentPanel";
import { BatchLightbox } from "./BatchLightbox";
import { BatchWorkshop } from "./BatchWorkshop";
import { BoardWorkshop } from "./BoardWorkshop";
import { BrushPanel } from "./BrushPanel";
import { CropPanel } from "./CropPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { GenerateBar } from "./GenerateBar";
import { Grain } from "./Grain";
import { HistoryPage } from "./HistoryPage";
import { Logo } from "./Logo";
import { ResultView } from "./ResultView";
import { SettingsPanel } from "./SettingsPanel";
import { SideNav } from "./SideNav";
import { Stage } from "./Stage";
import { StickerPanel } from "./StickerPanel";
import { TaskWorkshop } from "./TaskWorkshop";
import { TemplateWorkshop } from "./TemplateWorkshop";
import { VideoTaskPoller, VideoWorkshop } from "./VideoWorkshop";
import { Toaster } from "./Toaster";
import { UserChip } from "./UserChip";
import { IconButton } from "./ui";

export default function Studio() {
  const workMode = useStudio((s) => s.workMode);
  const image = useStudio((s) => s.image);
  const setImage = useStudio((s) => s.setImage);
  const updateParams = useStudio((s) => s.updateParams);
  const setSettings = useStudio((s) => s.setSettings);
  const cropOpen = useStudio((s) => s.cropOpen);
  const brushPanelOpen = useStudio((s) => s.brushPanelOpen);
  const stickerOpen = useStudio((s) => s.stickerOpen);
  const closeSettings = useStudio((s) => s.closeSettings);
  const settingsOpen = useStudio((s) => s.settingsOpen);
  const showToast = useStudio((s) => s.showToast);
  const setHistory = useStudio((s) => s.setHistory);

  const panelOpen = useLogStore((s) => s.panelOpen);
  const togglePanel = useLogStore((s) => s.togglePanel);
  const unreadErrors = useLogStore((s) => s.unreadErrors);

  const batchModels = useBatchStore((s) => s.models);
  const batchRunState = useBatchStore((s) => s.runState);
  const boardDirtyCount = useBoardStore((s) => s.dirtyIds.length);
  const boardGenCount = useBoardStore((s) => s.gens.filter((g) => g.status !== "failed").length);

  const phase = useStudio((s) => s.phase);
  const jobIds = useStudio((s) => s.jobIds);
  const startedAt = useStudio((s) => s.startedAt);
  const setRealProgress = useStudio((s) => s.setRealProgress);
  const setProgress = useStudio((s) => s.setProgress);
  const setResults = useStudio((s) => s.setResults);
  const setPhase = useStudio((s) => s.setPhase);
  const setError = useStudio((s) => s.setError);

  // Diagnostics / settings are a mutually-exclusive overlay group (both can
  // appear over any workMode tab, "资产" included — it's a regular nav
  // tab now, not an overlay, so it no longer needs a wrapper here).
  // (The settings entry moved into UserChip's dropdown — see openTokenSettings
  // there — so there is no header wrapper for it anymore.)
  function onToggleDiagnostics() {
    closeSettings();
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

  // First load: pull settings + history.
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
      // Preserve the job -> file mapping (flatMap alone loses it): entry.base
      // must match the server's naming in api/jobs/[id]/route.ts (jobId, or
      // jobId_<index> when that job produced more than one image).
      const entries: { src: string; base: string }[] = [];
      imgs.forEach((arr, i) => {
        const list: string[] = arr || [];
        list.forEach((src, j) => {
          entries.push({ src, base: `${jobIds[i]}${list.length > 1 ? `_${j}` : ""}` });
        });
      });

      if (entries.length) {
        const job = useStudio.getState().inpaintJob;
        let finalImages = entries.map((e) => e.src);

        if (!job) {
          setResults(finalImages);
          setPhase("success");
          showToast("success", "生成完成");
          refreshHistory();
        } else {
          // Local-repaint jobs: composite each returned block back onto the
          // original image (feathered blend through inpaintJob's mask), then
          // push the full-resolution PNG composite back to the server so
          // history shows it instead of the small cropped block.
          const uploads: { base: string; blob: Blob }[] = [];
          finalImages = await Promise.all(
            entries.map(async (e) => {
              try {
                const { url, blob } = await compositeInpaintResult(job, e.src);
                uploads.push({ base: e.base, blob });
                return url;
              } catch (err) {
                diag("warn", "局部重绘", "单张合成失败，已回退原始生成结果", (err as Error)?.message || String(err));
                return e.src;
              }
            }),
          );
          diag("info", "局部重绘", `合成完成 ${finalImages.length} 张`);

          // Compositing is async — re-check in case this run got cancelled
          // (new job started / component unmounted) while it was in flight.
          if (cancelled) return;
          setResults(finalImages);
          setPhase("success");
          showToast("success", "生成完成");

          // Upload happens after results are already shown (display doesn't
          // wait on the network round-trip), and deliberately ignores
          // `cancelled` — the images already exist server-side, so persisting
          // the full composite to history is still worthwhile even if this
          // run was superseded by a newer one.
          if (uploads.length) {
            void Promise.all(
              uploads.map(({ base, blob }) =>
                fetch(`/api/media/${encodeURIComponent(base)}.png`, {
                  method: "PUT",
                  headers: { "Content-Type": "image/png" },
                  body: blob,
                })
                  .then((r) => {
                    if (!r.ok) throw new Error(`HTTP ${r.status}`);
                  })
                  .catch((err) => {
                    diag("warn", "局部重绘", "完整图保存到历史失败", `${base}: ${(err as Error)?.message || String(err)}`);
                  }),
              ),
            ).then(() => refreshHistory());
          } else {
            refreshHistory();
          }
        }

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

  // D9 (PLAN-BATCH): landing on the workshop with an empty model rail hands
  // the single-studio canvas image across as model 1 — a convenience
  // carry-over (still freely removable/replaceable once there), not a hard
  // link between the two workspaces. Keyed only on workMode (not `image`)
  // so it fires once per switch-into-batch, not on every unrelated canvas
  // image change while already in the workshop.
  useEffect(() => {
    if (workMode !== "batch" || batchModels.length > 0 || !image) return;
    let cancelled = false;
    (async () => {
      try {
        const { dataUrl } = await downscaleImageSrc(image.src, 1800, 0.94);
        if (!cancelled) useBatchStore.getState().addModels([dataUrl]);
      } catch {
        // Best-effort convenience only — silently skip; the workshop's own
        // empty-state upload entry still works.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workMode]);

  // Leave-page guard while a batch run is live: the engine itself survives a
  // component unmount (it's driven from batchStore, not an effect — see
  // batchStore.ts's file header), but a full page reload/close would still
  // lose the in-memory cell grid (PLAN-BATCH D12, no session persistence in
  // v1), so warn before that happens. Effect lives here (not
  // BatchWorkshop.tsx) because it must keep listening even if the user
  // switches back to 单图创作 mid-run.
  useEffect(() => {
    if (batchRunState !== "running") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [batchRunState]);

  // 画布的同款守卫：有未保存改动（防抖窗口内）或生成还在跑时提醒再离开。
  // 放这里（而非 BoardWorkshop）同批量的理由：引擎在 store 层，切走工作区
  // 也要继续守。
  useEffect(() => {
    if (boardDirtyCount === 0 && boardGenCount === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [boardDirtyCount, boardGenCount]);

  return (
    <div className="relative flex h-[100dvh] flex-col overflow-hidden bg-ink">
      <Grain />

      <header className="relative z-30 flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <Logo />
        <div className="flex items-center gap-1.5">
          {workMode === "single" && image ? (
            <IconButton name="Plus" label="重新添加图片" onClick={() => setImage(null)} />
          ) : null}
          <div className="relative">
            <IconButton name="Pulse" label="诊断台" active={panelOpen} onClick={onToggleDiagnostics} />
            {unreadErrors > 0 ? (
              <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-red-400 ring-2 ring-ink" />
            ) : null}
          </div>
          <UserChip />
        </div>
      </header>

      <main className="relative flex flex-1 overflow-hidden">
        {/* 全局左侧导航（原顶栏 Segmented 搬家，见 SideNav.tsx） */}
        <SideNav />
        {workMode === "single" ? (
          <div className="relative flex flex-1 overflow-hidden">
            <Stage />
            <GenerateBar />
            <ResultView />
          </div>
        ) : workMode === "board" ? (
          <BoardWorkshop />
        ) : workMode === "task" ? (
          <TaskWorkshop />
        ) : workMode === "batch" ? (
          <>
            <BatchWorkshop />
            <BatchLightbox />
          </>
        ) : workMode === "agent" ? (
          <AgentPanel />
        ) : workMode === "video" ? (
          <VideoWorkshop />
        ) : workMode === "history" ? (
          <HistoryPage />
        ) : (
          <TemplateWorkshop />
        )}
      </main>

      <AnimatePresence>{cropOpen ? <CropPanel /> : null}</AnimatePresence>
      <AnimatePresence>{brushPanelOpen ? <BrushPanel /> : null}</AnimatePresence>
      <AnimatePresence>{stickerOpen ? <StickerPanel /> : null}</AnimatePresence>
      <AnimatePresence>{settingsOpen ? <SettingsPanel /> : null}</AnimatePresence>
      <AnimatePresence>{panelOpen ? <DiagnosticsPanel /> : null}</AnimatePresence>
      <VideoTaskPoller />
      <Toaster />
    </div>
  );
}
