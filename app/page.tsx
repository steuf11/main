"use client";

import { useEffect, useState, useCallback } from "react";
import EVDetectorPanel from "@/components/EVDetectorPanel";
import IntelPanel from "@/components/IntelPanel";
import type { Signal } from "@/lib/types";

const POLL_INTERVAL = 60_000; // 60s

export default function DashboardPage() {
  const [evSignals, setEvSignals] = useState<Signal[]>([]);
  const [intelSignal, setIntelSignal] = useState<Signal | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSignals = useCallback(async () => {
    try {
      const [evRes, intelRes] = await Promise.all([
        fetch("/api/signals?workflow=ev_detector&limit=20"),
        fetch("/api/signals?workflow=steufy_intel&limit=1"),
      ]);

      if (evRes.ok) {
        const { signals } = await evRes.json();
        setEvSignals(signals);
      }
      if (intelRes.ok) {
        const { signals } = await intelRes.json();
        setIntelSignal(signals[0] ?? null);
      }
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to fetch signals:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  return (
    <div className="min-h-screen bg-claw-bg">
      {/* Header */}
      <header className="border-b border-claw-border bg-claw-surface/80 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-lg font-bold tracking-tight text-white">
              Open<span className="text-violet-400">Claw</span>
            </span>
            <span className="hidden sm:inline-block rounded-full border border-claw-border px-2 py-0.5 text-xs text-claw-muted">
              Signal Dashboard
            </span>
          </div>
          <div className="flex items-center gap-3">
            {loading && (
              <span className="text-xs text-claw-muted animate-pulse">Loading…</span>
            )}
            {lastRefresh && !loading && (
              <span className="text-xs text-claw-muted hidden sm:block">
                Refreshed {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={fetchSignals}
              className="rounded-lg border border-claw-border bg-claw-bg px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-violet-500/50 hover:text-white"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: EV+ Detector */}
          <section>
            <EVDetectorPanel signals={evSignals} />
          </section>

          {/* Right: Steufy Intel */}
          <section>
            <IntelPanel signal={intelSignal} />
          </section>
        </div>

        {/* Footer note */}
        <p className="mt-6 text-center text-xs text-claw-muted">
          Auto-refresh every 60s &nbsp;·&nbsp; POST to{" "}
          <code className="text-violet-400">/api/signals</code> with{" "}
          <code className="text-violet-400">Authorization: Bearer &lt;OPENCLAW_API_KEY&gt;</code>
        </p>
      </main>
    </div>
  );
}
