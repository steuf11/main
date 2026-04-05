import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { validateApiKey } from "@/lib/auth";
import { saveSignal, getSignals } from "@/lib/storage";
import type { Signal, Workflow } from "@/lib/types";

// POST /api/signals
export async function POST(req: NextRequest) {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("workflow" in body) ||
    !("timestamp" in body) ||
    !("payload" in body)
  ) {
    return NextResponse.json(
      { error: "Missing required fields: workflow, timestamp, payload" },
      { status: 400 }
    );
  }

  const { workflow, timestamp, payload } = body as {
    workflow: string;
    timestamp: string;
    payload: unknown;
  };

  if (workflow !== "ev_detector" && workflow !== "steufy_intel") {
    return NextResponse.json(
      { error: "workflow must be 'ev_detector' or 'steufy_intel'" },
      { status: 400 }
    );
  }

  const signal: Signal = {
    id: uuidv4(),
    workflow: workflow as Workflow,
    timestamp,
    payload: payload as Signal["payload"],
    received_at: new Date().toISOString(),
  };

  saveSignal(signal);

  return NextResponse.json({ status: "ok", id: signal.id }, { status: 201 });
}

// GET /api/signals?workflow=ev_detector&limit=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workflow = searchParams.get("workflow") as Workflow | null;
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "20", 10), 100);

  if (
    workflow &&
    workflow !== "ev_detector" &&
    workflow !== "steufy_intel"
  ) {
    return NextResponse.json(
      { error: "Invalid workflow filter" },
      { status: 400 }
    );
  }

  const signals = getSignals(workflow ?? undefined, limit);
  return NextResponse.json({ signals });
}
