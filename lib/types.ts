export type Workflow = "ev_detector" | "steufy_intel";

export interface EVDetectorPayload {
  event: string;
  score: number;
  direction: "YES" | "NO";
  resume: string;
  polymarket_prob: number;
}

export interface IntelPayload {
  prices: {
    SOL: { price: number; change_24h: number };
    HYPE: { price: number; change_24h: number };
    BP: { price: number; change_24h: number };
  };
  narratives: Array<{ token: string; change_24h: number; category: string }>;
  digest: string;
  action: string;
}

export interface Signal {
  id: string;
  workflow: Workflow;
  timestamp: string;
  payload: EVDetectorPayload | IntelPayload;
  received_at: string;
}

export interface SignalsStore {
  signals: Signal[];
}
