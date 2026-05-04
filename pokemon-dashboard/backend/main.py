"""
Pokemon Arbitrage Dashboard — FastAPI backend.
"""

import asyncio
from datetime import datetime, timezone, timedelta
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from database import get_db
from scheduler import run_scan, scheduler_loop, current_scan


# ─── WebSocket manager ──────────────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self.connections.remove(ws)

    async def broadcast(self, data: dict):
        for ws in self.connections[:]:
            try:
                await ws.send_json(data)
            except Exception:
                self.connections.remove(ws)

ws_manager = ConnectionManager()


# ─── App lifecycle ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(scheduler_loop())
    yield
    task.cancel()

app = FastAPI(title="Pokemon Arbitrage Dashboard", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── API Routes ──────────────────────────────────────────────────────────────

@app.get("/api/opportunities")
def list_opportunities(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    min_discount: float = Query(20, ge=0),
    platform: str = Query("all"),
    seen: str = Query("all"),
):
    with get_db() as db:
        query = "SELECT * FROM opportunities WHERE discount_pct >= ?"
        params: list = [min_discount]

        if platform != "all":
            query += " AND platform = ?"
            params.append(platform)
        if seen == "unseen":
            query += " AND seen = 0"
        elif seen == "seen":
            query += " AND seen = 1"

        query += " ORDER BY discount_pct DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = db.execute(query, params).fetchall()
        return [dict(r) for r in rows]


@app.get("/api/opportunities/{opp_id}")
def get_opportunity(opp_id: int):
    with get_db() as db:
        row = db.execute("SELECT * FROM opportunities WHERE id = ?", (opp_id,)).fetchone()
        if not row:
            return {"error": "not found"}, 404
        return dict(row)


@app.post("/api/opportunities/{opp_id}/seen")
def mark_seen(opp_id: int):
    with get_db() as db:
        db.execute("UPDATE opportunities SET seen = 1 WHERE id = ?", (opp_id,))
    return {"ok": True}


@app.get("/api/stats")
def get_stats():
    with get_db() as db:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

        total_opps = db.execute("SELECT COUNT(*) as c FROM opportunities").fetchone()["c"]
        today_opps = db.execute(
            "SELECT COUNT(*) as c FROM opportunities WHERE date(created_at) = ?", (today,)
        ).fetchone()["c"]
        best = db.execute("SELECT MAX(discount_pct) as m FROM opportunities").fetchone()["m"] or 0
        today_scanned = db.execute(
            "SELECT SUM(listings_scraped) as s FROM scan_runs WHERE date(started_at) = ?", (today,)
        ).fetchone()["s"] or 0

        last_scan = db.execute(
            "SELECT * FROM scan_runs ORDER BY started_at DESC LIMIT 1"
        ).fetchone()

    return {
        "total_opportunities": total_opps,
        "today_opportunities": today_opps,
        "best_discount_pct": round(best, 1),
        "today_scanned": today_scanned,
        "last_scan": dict(last_scan) if last_scan else None,
        "scanner_running": current_scan["running"],
        "next_scan": current_scan.get("next_run"),
    }


@app.get("/api/scan/status")
def scan_status():
    return {
        "running": current_scan["running"],
        "last_run": current_scan.get("last_run"),
        "next_run": current_scan.get("next_run"),
    }


@app.post("/api/scan/trigger")
async def trigger_scan():
    if current_scan["running"]:
        return {"status": "already_running"}
    result = await run_scan()
    # Broadcast new opportunities via WebSocket
    if result.get("opportunities", 0) > 0:
        with get_db() as db:
            latest = db.execute(
                "SELECT * FROM opportunities ORDER BY created_at DESC LIMIT ?",
                (result["opportunities"],),
            ).fetchall()
            for row in latest:
                await ws_manager.broadcast({"type": "new_opportunity", "data": dict(row)})
    return result


@app.get("/api/history")
def get_history(days: int = Query(7, ge=1, le=30)):
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    with get_db() as db:
        rows = db.execute(
            "SELECT * FROM scan_runs WHERE started_at >= ? ORDER BY started_at DESC",
            (cutoff,),
        ).fetchall()
    return [dict(r) for r in rows]


# ─── WebSocket ───────────────────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_live(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # Keep connection alive
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
