import { useState, useEffect, useCallback } from "react";
import Head from "next/head";
import {
  fetchOpportunities,
  fetchStats,
  fetchScanStatus,
  connectWebSocket,
  Opportunity,
  Stats,
  ScanStatus as ScanStatusType,
} from "../lib/api";
import StatsBar from "../components/StatsBar";
import FilterBar from "../components/FilterBar";
import OpportunityCard from "../components/OpportunityCard";
import ScanStatusComp from "../components/ScanStatus";

export default function Home() {
  const [opps, setOpps] = useState<Opportunity[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatusType | null>(null);
  const [minDiscount, setMinDiscount] = useState(20);
  const [platform, setPlatform] = useState("all");
  const [seenFilter, setSeenFilter] = useState("all");

  const loadData = useCallback(async () => {
    const [o, s, sc] = await Promise.all([
      fetchOpportunities({ min_discount: minDiscount, platform, seen: seenFilter }),
      fetchStats(),
      fetchScanStatus(),
    ]);
    setOpps(o);
    setStats(s);
    setScanStatus(sc);
  }, [minDiscount, platform, seenFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const iv = setInterval(loadData, 30_000);
    return () => clearInterval(iv);
  }, [loadData]);

  // WebSocket for live updates
  useEffect(() => {
    const ws = connectWebSocket((msg: unknown) => {
      const data = msg as { type?: string; data?: Opportunity };
      if (data.type === "new_opportunity" && data.data) {
        setOpps((prev) => [data.data!, ...prev]);
      }
    });
    return () => ws.close();
  }, []);

  const handleMarkSeen = (id: number) => {
    setOpps((prev) => prev.map((o) => (o.id === id ? { ...o, seen: 1 } : o)));
  };

  return (
    <>
      <Head>
        <title>Pokemon Arbitrage Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className="container">
        <h1>🃏 Pokemon Arbitrage</h1>
        <StatsBar stats={stats} />
        <ScanStatusComp status={scanStatus} onScanComplete={loadData} />
        <FilterBar
          minDiscount={minDiscount}
          platform={platform}
          seenFilter={seenFilter}
          onMinDiscountChange={setMinDiscount}
          onPlatformChange={setPlatform}
          onSeenFilterChange={setSeenFilter}
        />
        <div className="opp-grid">
          {opps.length === 0 ? (
            <p className="empty">Aucune opportunite trouvee avec ces filtres.</p>
          ) : (
            opps.map((opp) => (
              <OpportunityCard key={opp.id} opp={opp} onMarkSeen={handleMarkSeen} />
            ))
          )}
        </div>
      </div>

      <style jsx global>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Courier New', monospace; background: #0d1117; color: #c9d1d9; }
        .container { max-width: 900px; margin: 0 auto; padding: 12px; }
        h1 { color: #f0c040; text-align: center; padding: 12px 0; font-size: 1.4rem; }

        .stats-bar {
          display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between;
          background: #161b22; border: 1px solid #21262d; border-radius: 6px;
          padding: 10px; margin-bottom: 12px;
        }
        .stat { text-align: center; flex: 1; min-width: 80px; }
        .stat-value { display: block; font-weight: bold; color: #fff; font-size: 1.1rem; }
        .stat-value.running { color: #f0c040; }
        .stat-label { font-size: 0.7rem; color: #8b949e; }

        .scan-status {
          display: flex; justify-content: space-between; align-items: center;
          background: #161b22; border: 1px solid #21262d; border-radius: 6px;
          padding: 8px 12px; margin-bottom: 12px;
        }
        .scan-info { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
        .scan-dot { width: 10px; height: 10px; border-radius: 50%; background: #484f58; }
        .scan-dot.running { background: #f0c040; animation: pulse 1s infinite; }
        .scan-dot.idle { background: #3fb950; }
        .scan-last { color: #484f58; font-size: 0.75rem; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        .btn-scan {
          background: #f0c040; color: #0d1117; border: none; border-radius: 4px;
          padding: 6px 14px; font-weight: bold; cursor: pointer; font-size: 0.85rem;
        }
        .btn-scan:disabled { opacity: 0.5; cursor: not-allowed; }

        .filter-bar {
          display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; font-size: 0.85rem;
        }
        .filter-bar label { display: flex; align-items: center; gap: 4px; }
        .filter-bar input, .filter-bar select {
          background: #161b22; color: #c9d1d9; border: 1px solid #21262d;
          border-radius: 4px; padding: 4px 8px; width: 70px;
        }
        .filter-bar select { width: auto; }

        .opp-grid { display: flex; flex-direction: column; gap: 10px; }
        .opp-card {
          background: #161b22; border: 1px solid #21262d; border-radius: 6px;
          padding: 12px; transition: border-color 0.2s;
        }
        .opp-card:hover { border-color: #f0c040; }
        .opp-card.seen { opacity: 0.5; }
        .opp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .opp-name { font-weight: bold; color: #fff; font-size: 1rem; }
        .badge {
          display: inline-block; padding: 2px 8px; border-radius: 4px;
          font-size: 0.75rem; font-weight: bold; color: #0d1117;
        }
        .opp-prices { display: flex; gap: 20px; margin-bottom: 8px; font-size: 0.9rem; }
        .opp-prices .label { color: #8b949e; margin-right: 4px; }
        .price.listing { color: #f85149; font-weight: bold; }
        .price.argus { color: #3fb950; font-weight: bold; }
        .opp-discount { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .discount-bar { flex: 1; height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; }
        .discount-fill { height: 100%; background: #3fb950; border-radius: 4px; }
        .discount-text { font-weight: bold; color: #3fb950; font-size: 0.9rem; }
        .opp-actions { display: flex; gap: 8px; }
        .btn-link {
          color: #f0c040; text-decoration: none; font-size: 0.85rem;
          border: 1px solid #f0c040; padding: 4px 10px; border-radius: 4px;
        }
        .btn-seen {
          background: none; color: #8b949e; border: 1px solid #21262d;
          padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;
        }
        .empty { color: #484f58; text-align: center; padding: 20px; font-style: italic; }
      `}</style>
    </>
  );
}
