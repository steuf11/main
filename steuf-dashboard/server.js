require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.DASHBOARD_SECRET;

if (!SECRET) {
  console.error("DASHBOARD_SECRET is required in .env");
  process.exit(1);
}

// ─── Data files ──────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "data");
const INTEL_FILE = path.join(DATA_DIR, "intel.json");
const SIGNALS_FILE = path.join(DATA_DIR, "signals.json");
const MAX_INTEL = 30;
const MAX_SIGNALS = 50;

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(INTEL_FILE)) fs.writeFileSync(INTEL_FILE, "[]");
  if (!fs.existsSync(SIGNALS_FILE)) fs.writeFileSync(SIGNALS_FILE, "[]");
}
ensureDataFiles();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return [];
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function appendEntry(file, entry, max) {
  const data = readJson(file);
  data.unshift(entry);
  const trimmed = data.slice(0, max);
  writeJson(file, trimmed);
  return trimmed;
}

// ─── SSE ─────────────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcastSSE(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    res.write(msg);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// SSE endpoint (no auth — public for dashboard)
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write("event: connected\ndata: {}\n\n");
  sseClients.add(res);
  req.on("close", () => sseClients.delete(res));
});

// Read APIs (no auth — dashboard reads)
app.get("/api/intel", (_req, res) => {
  res.json(readJson(INTEL_FILE).slice(0, MAX_INTEL));
});

app.get("/api/signals", (_req, res) => {
  res.json(readJson(SIGNALS_FILE).slice(0, MAX_SIGNALS));
});

// Webhook: intel from N8N
app.post("/webhook/intel", authMiddleware, (req, res) => {
  const entry = { id: uuidv4(), received_at: new Date().toISOString(), ...req.body };
  const data = appendEntry(INTEL_FILE, entry, MAX_INTEL);
  broadcastSSE("intel", entry);
  console.log(`[Intel] New entry from ${entry.workflow || "unknown"}`);
  res.json({ ok: true, total: data.length });
});

// Webhook: signals from N8N
app.post("/webhook/signals", authMiddleware, (req, res) => {
  const entry = { id: uuidv4(), received_at: new Date().toISOString(), ...req.body };
  const data = appendEntry(SIGNALS_FILE, entry, MAX_SIGNALS);
  broadcastSSE("signal", entry);
  console.log(`[Signal] ${entry.event || "unknown"} — score ${entry.score || "?"}`);
  res.json({ ok: true, total: data.length });
});

// Health
app.get("/health", (_req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Dashboard] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Dashboard] SSE clients: /events`);
  console.log(`[Dashboard] Webhooks: POST /webhook/intel, POST /webhook/signals`);
});
