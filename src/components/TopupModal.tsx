"use client";

// Centered glass modal for online top-up + redemption codes, opened from
// UserChip's dropdown. Two independent flows share one card via
// AnimatePresence: "select" (pick/type an amount, debounce-priced, then hand
// off to the upstream 易支付 gateway via a hidden form POST) and "waiting"
// (silent authStore.check() polling until quota actually rises, then a brief
// success beat before auto-closing).

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/authStore";
import { QUOTA_PER_UNIT } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";
import { Button } from "./ui";

interface TopupInfo {
  amount_options: number[];
  min_topup: number;
  enable_online_topup: boolean;
  enable_redemption: boolean;
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({}));
}

/** Builds a hidden form and submits it to the given URL in a new tab — the
 *  classic 易支付 handoff, since the gateway only accepts POSTed form fields. */
function submitPayForm(url: string, params: Record<string, unknown>) {
  const form = document.createElement("form");
  form.action = url;
  form.method = "POST";
  form.target = "_blank";
  for (const [k, v] of Object.entries(params)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = k;
    input.value = String(v);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  document.body.removeChild(form);
}

export function TopupModal({ onClose }: { onClose: () => void }) {
  const user = useAuth((s) => s.user);
  const check = useAuth((s) => s.check);

  const [info, setInfo] = useState<TopupInfo | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [custom, setCustom] = useState("");
  const [pricing, setPricing] = useState(false);
  const [pay, setPay] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [phase, setPhase] = useState<"select" | "waiting" | "done">("select");

  const [redeemKey, setRedeemKey] = useState("");
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeemOk, setRedeemOk] = useState(false);

  const quotaAtOpen = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    fetch("/api/topup/info", { cache: "no-store" })
      .then(parseJson)
      .then((j) => {
        if (j.error) return;
        setInfo(j as unknown as TopupInfo);
      })
      .catch(() => {});
  }, []);

  const minTopup = info?.min_topup ?? 50;
  const touched = selected !== null || custom.trim() !== "";
  const amount = selected ?? (custom.trim() ? Number(custom.trim()) : NaN);
  const amountValid = Number.isFinite(amount) && amount >= minTopup;

  // 金额变化 400ms 后问价；换金额立刻清掉上一次的报价，避免"应付"停留在旧值上。
  useEffect(() => {
    setPay(null);
    setPriceError(null);
    if (!amountValid) {
      setPricing(false);
      return;
    }
    setPricing(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/topup/amount", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount }),
        });
        const j = await parseJson(res);
        if (!res.ok) {
          setPriceError((j.error as string) || "问价失败");
        } else {
          setPay((j.pay as string) ?? null);
        }
      } catch {
        setPriceError("网络请求失败");
      } finally {
        setPricing(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [amount, amountValid]);

  // 等待支付态：每 4 秒静默刷新一次额度，涨了就算支付到账。
  useEffect(() => {
    if (phase !== "waiting") return;
    const id = setInterval(() => {
      check();
    }, 4000);
    return () => clearInterval(id);
  }, [phase, check]);

  useEffect(() => {
    if (phase !== "waiting" || quotaAtOpen.current === null) return;
    if (typeof user?.quota === "number" && user.quota > quotaAtOpen.current) {
      setPhase("done");
    }
  }, [user?.quota, phase]);

  useEffect(() => {
    if (phase !== "done") return;
    const t = setTimeout(onClose, 2000);
    return () => clearTimeout(t);
  }, [phase, onClose]);

  async function startPay() {
    if (!amountValid || !pay || payBusy) return;
    setPayBusy(true);
    try {
      const res = await fetch("/api/topup/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const j = await parseJson(res);
      if (!res.ok || !j.url || !j.params) {
        setPriceError((j.error as string) || "发起支付失败");
        return;
      }
      submitPayForm(j.url as string, j.params as Record<string, unknown>);
      quotaAtOpen.current = typeof user?.quota === "number" ? user.quota : 0;
      setPhase("waiting");
    } catch {
      setPriceError("网络请求失败");
    } finally {
      setPayBusy(false);
    }
  }

  async function redeem() {
    if (!redeemKey.trim() || redeemBusy) return;
    setRedeemBusy(true);
    setRedeemError(null);
    setRedeemOk(false);
    try {
      const res = await fetch("/api/topup/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: redeemKey.trim() }),
      });
      const j = await parseJson(res);
      if (!res.ok || !j.ok) {
        setRedeemError((j.error as string) || "兑换失败");
        return;
      }
      setRedeemOk(true);
      setRedeemKey("");
      await check();
    } catch {
      setRedeemError("网络请求失败");
    } finally {
      setRedeemBusy(false);
    }
  }

  const quotaDisplay = typeof user?.quota === "number" ? (user.quota / QUOTA_PER_UNIT).toFixed(2) : "0.00";

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[201] flex items-center justify-center p-4" onClick={onClose}>
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="glass w-[400px] max-w-full rounded-panel p-6"
        >
          <div className="mb-1 flex items-center justify-between">
            <h2 className="text-base font-medium text-fg">充值</h2>
            <button type="button" onClick={onClose} aria-label="关闭" className="text-fg-mute hover:text-fg">
              <Icon name="X" size={18} />
            </button>
          </div>
          <p className="mb-5 text-xs text-fg-mute">当前额度 ¥{quotaDisplay}</p>

          {!info ? (
            <div className="flex h-32 items-center justify-center">
              <Icon name="CircleNotch" size={20} className="animate-spin text-fg-mute" />
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false}>
              {phase === "select" ? (
                <motion.div
                  key="select"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
                >
                  {info.enable_online_topup ? (
                    <section>
                      <div className="grid grid-cols-2 gap-2.5">
                        {info.amount_options.map((v) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => {
                              setSelected(v);
                              setCustom("");
                            }}
                            className={cn(
                              "flex h-16 items-center justify-center rounded-control border text-lg font-medium transition-colors",
                              selected === v
                                ? "border-accent bg-accent/10 text-accent"
                                : "border-line bg-panel-2 text-fg-dim hover:border-line-2",
                            )}
                          >
                            ¥{v}
                          </button>
                        ))}
                      </div>

                      <input
                        type="number"
                        inputMode="decimal"
                        value={custom}
                        onChange={(e) => {
                          setCustom(e.target.value);
                          setSelected(null);
                        }}
                        placeholder={`自定义金额（最低 ${minTopup}）`}
                        className="mt-2.5 h-11 w-full rounded-control border border-line bg-panel-2 px-3.5 text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
                      />

                      <div className="mt-3 flex min-h-[16px] items-center gap-1.5 text-xs">
                        {pricing ? (
                          <>
                            <Icon name="CircleNotch" size={12} className="animate-spin text-fg-mute" />
                            <span className="text-fg-mute">正在计算金额…</span>
                          </>
                        ) : priceError ? (
                          <span className="text-red-400/80">{priceError}</span>
                        ) : pay ? (
                          <span className="text-fg-dim">
                            应付 <span className="text-accent">¥{pay}</span>
                            {/* 手续费不写死费率，用实付减面额动态算，后台调费率也不会显示错。 */}
                            {Number(pay) > amount ? (
                              <span className="text-fg-mute">（含手续费 ¥{(Number(pay) - amount).toFixed(2)}）</span>
                            ) : null}
                          </span>
                        ) : touched && !amountValid ? (
                          <span className="text-red-400/80">充值金额不能低于 ¥{minTopup}</span>
                        ) : null}
                      </div>

                      <Button
                        type="button"
                        variant="primary"
                        disabled={!amountValid || !pay || pricing || payBusy}
                        onClick={startPay}
                        className="mt-4 w-full"
                      >
                        {payBusy ? <Icon name="CircleNotch" size={16} className="animate-spin" /> : null}
                        微信支付
                      </Button>
                    </section>
                  ) : null}

                  {info.enable_online_topup && info.enable_redemption ? (
                    <div className="my-5 flex items-center gap-3 text-[11px] text-fg-mute">
                      <div className="h-px flex-1 bg-line" />
                      <span>或</span>
                      <div className="h-px flex-1 bg-line" />
                    </div>
                  ) : null}

                  {info.enable_redemption ? (
                    <section>
                      <div className="flex gap-2">
                        <input
                          value={redeemKey}
                          onChange={(e) => {
                            setRedeemKey(e.target.value);
                            setRedeemError(null);
                            setRedeemOk(false);
                          }}
                          placeholder="兑换码"
                          className="h-10 flex-1 rounded-control border border-line bg-panel-2 px-3 text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={!redeemKey.trim() || redeemBusy}
                          onClick={redeem}
                        >
                          {redeemBusy ? <Icon name="CircleNotch" size={14} className="animate-spin" /> : null}
                          兑换
                        </Button>
                      </div>
                      {redeemError ? <p className="mt-2 text-xs text-red-400/80">{redeemError}</p> : null}
                      {redeemOk ? <p className="mt-2 text-xs text-emerald-400/80">兑换成功</p> : null}
                    </section>
                  ) : null}
                </motion.div>
              ) : (
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
                  className="flex flex-col items-center py-6 text-center"
                >
                  {phase === "done" ? (
                    <>
                      <Icon name="Check" size={32} weight="bold" className="text-accent" />
                      <p className="mt-3 text-sm text-fg">充值成功</p>
                    </>
                  ) : (
                    <>
                      <Icon name="CircleNotch" size={28} className="animate-spin text-accent" />
                      <p className="mt-3 text-sm leading-relaxed text-fg-dim">
                        已在新标签打开支付页，完成支付后额度将自动更新
                      </p>
                      <button
                        type="button"
                        onClick={() => setPhase("select")}
                        className="mt-5 text-xs text-fg-mute hover:text-fg"
                      >
                        返回
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </motion.div>
      </div>
    </>
  );
}
