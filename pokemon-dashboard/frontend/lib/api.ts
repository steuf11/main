const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export interface Opportunity {
  id: number;
  listing_id: number;
  card_name: string;
  listing_usd: number;
  argus_usd: number;
  discount_pct: number;
  confidence: string;
  seller: string;
  url: string;
  platform: string;
  alerted_telegram: number;
  seen: number;
  created_at: string;
}

export interface Stats {
  total_opportunities: number;
  today_opportunities: number;
  best_discount_pct: number;
  today_scanned: number;
  last_scan: { started_at: string; finished_at: string; status: string } | null;
  scanner_running: boolean;
  next_scan: string | null;
}

export interface ScanStatus {
  running: boolean;
  last_run: string | null;
  next_run: string | null;
}

export async function fetchOpportunities(params: {
  limit?: number;
  offset?: number;
  min_discount?: number;
  platform?: string;
  seen?: string;
} = {}): Promise<Opportunity[]> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  if (params.min_discount) qs.set("min_discount", String(params.min_discount));
  if (params.platform) qs.set("platform", params.platform);
  if (params.seen) qs.set("seen", params.seen);
  const res = await fetch(`${API_BASE}/api/opportunities?${qs}`);
  return res.json();
}

export async function markSeen(id: number): Promise<void> {
  await fetch(`${API_BASE}/api/opportunities/${id}/seen`, { method: "POST" });
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${API_BASE}/api/stats`);
  return res.json();
}

export async function fetchScanStatus(): Promise<ScanStatus> {
  const res = await fetch(`${API_BASE}/api/scan/status`);
  return res.json();
}

export async function triggerScan(): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE}/api/scan/trigger`, { method: "POST" });
  return res.json();
}

export function connectWebSocket(onMessage: (data: unknown) => void): WebSocket {
  const wsUrl = API_BASE.replace(/^http/, "ws") + "/ws/live";
  const ws = new WebSocket(wsUrl);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return ws;
}
