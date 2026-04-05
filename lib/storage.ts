import fs from "fs";
import path from "path";
import type { Signal, SignalsStore, Workflow } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const SIGNALS_FILE = path.join(DATA_DIR, "signals.json");
const MAX_SIGNALS = 500;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): SignalsStore {
  ensureDataDir();
  if (!fs.existsSync(SIGNALS_FILE)) {
    return { signals: [] };
  }
  try {
    const raw = fs.readFileSync(SIGNALS_FILE, "utf-8");
    return JSON.parse(raw) as SignalsStore;
  } catch {
    return { signals: [] };
  }
}

function writeStore(store: SignalsStore) {
  ensureDataDir();
  fs.writeFileSync(SIGNALS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function saveSignal(signal: Signal): void {
  const store = readStore();
  store.signals.unshift(signal);
  // cap at MAX_SIGNALS to avoid unbounded growth
  if (store.signals.length > MAX_SIGNALS) {
    store.signals = store.signals.slice(0, MAX_SIGNALS);
  }
  writeStore(store);
}

export function getSignals(workflow?: Workflow, limit = 20): Signal[] {
  const store = readStore();
  let filtered = workflow
    ? store.signals.filter((s) => s.workflow === workflow)
    : store.signals;
  // already stored newest-first, sort by timestamp DESC to be safe
  filtered = filtered.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  return filtered.slice(0, limit);
}
