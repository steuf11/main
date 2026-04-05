"use client";

import type { Signal, IntelPayload } from "@/lib/types";
import { timeAgo, changeClass, formatChange, formatPrice } from "@/lib/utils";

interface Props {
  signal: Signal | null;
}

export default function IntelPanel({ signal }: Props) {
  if (!signal) {
    return (
      <div className="rounded-xl border border-claw-border bg-claw-surface p-6">
        <PanelHeader lastUpdate={null} />
        <p className="mt-6 text-center text-sm text-claw-muted">
          No intel yet — waiting for Steufy Intel
        </p>
      </div>
    );
  }

  const p = signal.payload as IntelPayload;
  const tokens = Object.entries(p.prices) as [
    string,
    { price: number; change_24h: number }
  ][];

  return (
    <div className="rounded-xl border border-claw-border bg-claw-surface">
      <div className="border-b border-claw-border px-5 py-4">
        <PanelHeader lastUpdate={signal.timestamp} />
      </div>

      {/* Price table */}
      <div className="px-5 pt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-claw-muted">
          Prices
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-claw-border">
              <th className="pb-2 text-left text-xs text-claw-muted font-normal">Token</th>
              <th className="pb-2 text-right text-xs text-claw-muted font-normal">Price</th>
              <th className="pb-2 text-right text-xs text-claw-muted font-normal">24h</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map(([token, data]) => (
              <tr key={token} className="border-b border-claw-border/50 last:border-0">
                <td className="py-2 font-mono font-semibold text-white/90">{token}</td>
                <td className="py-2 text-right font-mono text-white/80">
                  {formatPrice(data.price)}
                </td>
                <td className={`py-2 text-right font-mono font-medium ${changeClass(data.change_24h)}`}>
                  {formatChange(data.change_24h)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narratives */}
      {p.narratives.length > 0 && (
        <div className="px-5 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-claw-muted">
            Top Narratives
          </p>
          <ul className="space-y-1.5">
            {p.narratives.map((n, i) => (
              <li key={i} className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-sm font-semibold text-white/90">
                  {n.token}
                </span>
                <span
                  className={`text-xs font-mono font-medium ${changeClass(n.change_24h)}`}
                >
                  {formatChange(n.change_24h)}
                </span>
                <span className="rounded-full border border-claw-border bg-claw-bg px-2 py-0.5 text-xs text-claw-muted">
                  {n.category}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Digest */}
      <div className="px-5 pt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-claw-muted">
          Digest
        </p>
        <p className="text-sm leading-relaxed text-white/70">{p.digest}</p>
      </div>

      {/* Action */}
      <div className="mx-5 my-4 rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-violet-400">
          Action
        </p>
        <p className="text-sm font-medium text-white/90">{p.action}</p>
      </div>
    </div>
  );
}

function PanelHeader({ lastUpdate }: { lastUpdate: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="flex h-2 w-2 rounded-full bg-cyan-400" />
        <h2 className="text-sm font-semibold text-white/90 tracking-wide uppercase">
          Steufy Intel
        </h2>
      </div>
      {lastUpdate && (
        <span className="text-xs text-claw-muted">
          Updated {timeAgo(lastUpdate)}
        </span>
      )}
    </div>
  );
}
