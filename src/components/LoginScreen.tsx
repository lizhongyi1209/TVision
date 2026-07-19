"use client";

// Full-screen login gate: password step, then an optional 2FA step for
// accounts that have it turned on upstream. Both steps live in the same
// glass card (AnimatePresence swaps the form in place) so the card never
// jumps around on screen.
//
// token 模式（线上默认）：登录停用，改为贴 o1key API 令牌进门 —— 令牌即身份，
// 同一令牌在任何设备/浏览器贴入都会回到同一份历史与设置。原登录表单代码
// 完整保留，AUTH_MODE=login 时切回。

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/authStore";
import { Grain } from "./Grain";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { Button } from "./ui";

function TokenEntryForm() {
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const enterToken = useAuth((s) => s.enterToken);
  const clearError = useAuth((s) => s.clearError);

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const keyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    keyRef.current?.focus();
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !apiKey.trim()) return;
    enterToken(apiKey.trim());
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3.5">
      <p className="text-xs leading-relaxed text-fg-dim">
        填入你的 o1key API 令牌即可开始。令牌只保存在服务端加密存储，按 o1key 余额计费；
        同一令牌在任何设备填入都会回到同一份历史。
      </p>
      <div className="relative">
        <input
          ref={keyRef}
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            clearError();
          }}
          placeholder="sk-..."
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-control border border-line bg-panel-2 px-3.5 pr-10 font-mono text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          aria-label={showKey ? "隐藏令牌" : "显示令牌"}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-mute hover:text-fg"
        >
          <Icon name={showKey ? "EyeSlash" : "Eye"} size={17} />
        </button>
      </div>

      {error ? <p className="text-xs text-red-400/80">{error}</p> : null}

      <Button type="submit" variant="primary" disabled={busy} className="w-full">
        {busy ? <Icon name="CircleNotch" size={16} className="animate-spin" /> : null}
        开始使用
      </Button>
      <a
        href="https://api.o1key.cn/console/token"
        target="_blank"
        rel="noreferrer"
        className="block w-full text-center text-xs text-fg-mute hover:text-fg"
      >
        还没有令牌？去 o1key 控制台创建 ↗
      </a>
    </form>
  );
}

export function LoginScreen() {
  const mode = useAuth((s) => s.mode);
  const busy = useAuth((s) => s.busy);
  const error = useAuth((s) => s.error);
  const need2fa = useAuth((s) => s.need2fa);
  const login = useAuth((s) => s.login);
  const verify2fa = useAuth((s) => s.verify2fa);
  const cancel2fa = useAuth((s) => s.cancel2fa);
  const clearError = useAuth((s) => s.clearError);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const userRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    userRef.current?.focus();
  }, []);

  function onSubmitPassword(e: FormEvent) {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    login(username.trim(), password);
  }

  function onSubmitCode(e: FormEvent) {
    e.preventDefault();
    if (busy || code.trim().length !== 6) return;
    verify2fa(code.trim());
  }

  return (
    <div className="relative flex h-[100dvh] items-center justify-center overflow-hidden bg-ink">
      <Grain />
      {/* 顶部一抹极淡琥珀径向光晕，呼应品牌色但不抢主体 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] opacity-80"
        style={{ background: "radial-gradient(ellipse 55% 100% at 50% 0%, rgba(230,178,119,0.14), transparent 72%)" }}
      />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        className="glass relative z-10 w-[360px] rounded-panel px-7 py-8"
      >
        <div className="mb-7 flex flex-col items-center">
          <Logo />
        </div>

        {mode === "token" ? (
          <TokenEntryForm />
        ) : (
        <AnimatePresence mode="wait" initial={false}>
          {!need2fa ? (
            <motion.form
              key="password"
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              onSubmit={onSubmitPassword}
              className="space-y-3.5"
            >
              <input
                ref={userRef}
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  clearError();
                }}
                placeholder="账号"
                autoComplete="username"
                className="h-11 w-full rounded-control border border-line bg-panel-2 px-3.5 text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
              />
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearError();
                  }}
                  placeholder="密码"
                  autoComplete="current-password"
                  className="h-11 w-full rounded-control border border-line bg-panel-2 px-3.5 pr-10 text-sm text-fg placeholder:text-fg-mute focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "隐藏密码" : "显示密码"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-mute hover:text-fg"
                >
                  <Icon name={showPassword ? "EyeSlash" : "Eye"} size={17} />
                </button>
              </div>

              {error ? <p className="text-xs text-red-400/80">{error}</p> : null}

              <Button type="submit" variant="primary" disabled={busy} className="w-full">
                {busy ? <Icon name="CircleNotch" size={16} className="animate-spin" /> : null}
                登 录
              </Button>
            </motion.form>
          ) : (
            <motion.form
              key="2fa"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              onSubmit={onSubmitCode}
              className="space-y-3.5"
            >
              <p className="text-xs text-fg-dim">请输入两步验证的 6 位验证码</p>
              <input
                autoFocus
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  clearError();
                }}
                placeholder="······"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="h-11 w-full rounded-control border border-line bg-panel-2 px-3.5 text-center text-lg tracking-[0.4em] text-fg placeholder:tracking-normal placeholder:text-fg-mute focus:border-accent focus:outline-none"
              />

              {error ? <p className="text-xs text-red-400/80">{error}</p> : null}

              <Button type="submit" variant="primary" disabled={busy} className="w-full">
                {busy ? <Icon name="CircleNotch" size={16} className="animate-spin" /> : null}
                验 证
              </Button>
              <button
                type="button"
                onClick={cancel2fa}
                className="w-full text-center text-xs text-fg-mute hover:text-fg"
              >
                返回
              </button>
            </motion.form>
          )}
        </AnimatePresence>
        )}
      </motion.div>
    </div>
  );
}
