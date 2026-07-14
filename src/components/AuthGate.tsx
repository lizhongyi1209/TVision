"use client";

// Top-level auth switch: loading -> anon -> authed. Also re-checks the
// session on tab refocus (silent — a lapsed upstream session just drops the
// user back to LoginScreen, no toast/alert needed).

import { useEffect } from "react";
import { useAuth } from "@/lib/authStore";
import { Grain } from "./Grain";
import { LoginScreen } from "./LoginScreen";
import Studio from "./Studio";

export function AuthGate() {
  const status = useAuth((s) => s.status);
  const check = useAuth((s) => s.check);

  useEffect(() => {
    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [check]);

  if (status === "loading") {
    return (
      <div className="relative h-[100dvh] bg-ink">
        <Grain />
      </div>
    );
  }
  if (status === "anon") return <LoginScreen />;
  return <Studio />;
}
