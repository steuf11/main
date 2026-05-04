import { Stats } from "../lib/api";

export default function StatsBar({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="stats-bar">Loading...</div>;

  const lastScanTime = stats.last_scan?.finished_at
    ? new Date(stats.last_scan.finished_at).toLocaleTimeString("fr-FR")
    : "—";

  return (
    <div className="stats-bar">
      <div className="stat">
        <span className="stat-value">{stats.today_scanned}</span>
        <span className="stat-label">Scanned today</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.today_opportunities}</span>
        <span className="stat-label">Opportunities</span>
      </div>
      <div className="stat">
        <span className="stat-value">{stats.best_discount_pct}%</span>
        <span className="stat-label">Best deal</span>
      </div>
      <div className="stat">
        <span className="stat-value">{lastScanTime}</span>
        <span className="stat-label">Last scan</span>
      </div>
      <div className="stat">
        <span className={`stat-value ${stats.scanner_running ? "running" : ""}`}>
          {stats.scanner_running ? "SCANNING" : "IDLE"}
        </span>
        <span className="stat-label">Status</span>
      </div>
    </div>
  );
}
