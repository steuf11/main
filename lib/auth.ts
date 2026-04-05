import { NextRequest } from "next/server";

export function validateApiKey(req: NextRequest): boolean {
  const apiKey = process.env.OPENCLAW_API_KEY;
  if (!apiKey) return false;

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return false;

  const provided = authHeader.slice(7);
  return provided === apiKey;
}
