"use client";

import { useState } from "react";
import type { Signal, EVDetectorPayload } from "@/lib/types";
import { timeAgo, scoreBadgeClass } from "@/lib/utils";

interface Props {
  signals: Signal[];
}

export default function EVDetectorPanel({ signals }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (signals.length === 0) {
    return (
      <div className="rounded-xl border border-claw-border bg-claw-surface p-6">
        <PanelHeader />
        <p className="mt-6 text-center text-sm text-claw-muted">
          No signals yet — waiting for EV+ Detector
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-claw-border bg-claw-surface">
      <div className="border-b border-claw-border px-5 py-4">
        <PanelHeader />
      </div>
      <ul className="divide-y divide-claw-border">
        {signals.map((signal) => {
          const p = signal.payload as EVDetectorPayload;
          const isOpen = expanded === signal.id;
          return (
            <li key={signal.id}>
              <button
                onClick={() => setExpanded(isOpen ? null : signal.id)}
                className="w-full px-5 py-3 text-left transition-colors hover:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3 flex-wrap">
                  {/* Score badge */}
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-mono font-semibold ${scoreBadgeClass(p.score)}`}
                  >
                    {p.score}/10
                  </span>

                  {/* Direction pill */}
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      p.direction === "YES"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400"
                    }`}
                  >
                    {p.direction}
                  </span>

                  {/* Event name */}
                  <span className="flex-1 truncate text-sm text-white/90 font-medium">
                    {p.event}
                  </span>

                  {/* Polymarket */}
                  <span className="text-xs text-claw-muted font-mono">
                    {(p.polymarket_prob * 100).toFixed(1)}%
                  </span>

                  {/* Timestamp */}
                  <span className="text-xs text-claw-muted">
                    {timeAgo(signal.timestamp)}
                  </span>

                  {/* Chevron */}
                  <svg
                    className={`h-4 w-4 text-claw-muted shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>

                {/* Expanded resume */}
                {isOpen && (
                  <div className="mt-3 rounded-lg bg-black/30 px-4 py-3 text-left">
                    <p className="text-sm leading-relaxed text-white/80">{p.resume}</p>
                    <p className="mt-2 text-xs text-claw-muted font-mono">
                      {new Date(signal.timestamp).toLocaleString()}
                    </p>
                  </div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-2 w-2 rounded-full bg-violet-400" />
      <h2 className="text-sm font-semibold text-white/90 tracking-wide uppercase">
        EV+ Detector
      </h2>
    </div>
  );
}
