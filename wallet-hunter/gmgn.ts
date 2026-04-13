import { Page } from "puppeteer";
import * as fs from "fs";
import * as path from "path";
import { getBrowser } from "./lpagent";

const CACHE_DIR = path.join(process.cwd(), ".cache", "gmgn");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// URL: https://gmgn.ai/sol/address/<WALLET>
const GMGN_BASE = "https://gmgn.ai/sol/address";

// ─── Cache ────────────────────────────────────────────────────────────────────

interface GmgnData {
  followers: number;
}

function cachePath(address: string): string {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${address}.json`);
}

function readCache(address: string): GmgnData | null {
  const p = cachePath(address);
  if (!fs.existsSync(p)) return null;
  if (Date.now() - fs.statSync(p).mtimeMs > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GmgnData;
  } catch {
    return null;
  }
}

function writeCache(address: string, data: GmgnData): void {
  fs.writeFileSync(cachePath(address), JSON.stringify(data, null, 2));
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

function parseCount(raw: string): number {
  // Handles "1.2K", "12K", "123", "1,234"
  const s = raw.trim().replace(/,/g, "");
  const kMatch = s.match(/^([0-9.]+)[kK]$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

// ─── DOM extraction ───────────────────────────────────────────────────────────

interface GmgnPageRaw {
  followersRaw: string;
}

async function extractFromPage(page: Page): Promise<GmgnData> {
  const raw: GmgnPageRaw = await page.evaluate((): GmgnPageRaw => {
    const bodyText = (document.body as HTMLElement).innerText;

    function regexFallback(pattern: RegExp): string {
      const m = bodyText.match(pattern);
      return m ? m[1] : "";
    }

    function findByLabel(label: string): string {
      const allElems = Array.from(document.querySelectorAll("*"));
      for (const el of allElems) {
        const htmlEl = el as HTMLElement;
        const text = htmlEl.innerText?.trim() ?? "";
        if (
          text.toLowerCase() === label.toLowerCase() &&
          el.children.length === 0
        ) {
          // Try next sibling or parent's next sibling value
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            const idx = siblings.indexOf(el);
            if (idx >= 0 && idx + 1 < siblings.length) {
              const val = (siblings[idx + 1] as HTMLElement).innerText?.trim();
              if (val && /[0-9]/.test(val)) return val;
            }
            // Value may be in a preceding sibling (label after value pattern)
            if (idx > 0) {
              const val = (siblings[idx - 1] as HTMLElement).innerText?.trim();
              if (val && /[0-9]/.test(val)) return val;
            }
          }
        }
      }
      return "";
    }

    return {
      followersRaw:
        findByLabel("Followers") ||
        findByLabel("followers") ||
        // gmgn shows "X Followers" as a combined string
        regexFallback(/([0-9][0-9.,kK]*)\s*[Ff]ollowers/) ||
        regexFallback(/[Ff]ollowers[:\s]*([0-9][0-9.,kK]*)/),
    };
  });

  return { followers: parseCount(raw.followersRaw) };
}

// ─── Retry ────────────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1500
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(
        `  [gmgn] Retry ${attempt + 1}/${retries} after ${wait}ms — ${(err as Error).message}`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch followers count for a wallet from gmgn.ai.
 * Returns undefined on failure (non-blocking — caller handles missing value).
 */
export async function fetchFollowers(
  address: string
): Promise<number | undefined> {
  const cached = readCache(address);
  if (cached) {
    console.log(`  [gmgn cache] ${address}`);
    return cached.followers;
  }

  try {
    const data = await withRetry(async () => {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );
        // gmgn is heavy — wait for network to settle then give extra time
        await page.goto(`${GMGN_BASE}/${address}`, {
          waitUntil: "networkidle2",
          timeout: 35_000,
        });
        await new Promise((r) => setTimeout(r, 4000));
        return await extractFromPage(page);
      } finally {
        await page.close();
      }
    });

    writeCache(address, data);
    return data.followers || undefined;
  } catch (err) {
    console.warn(`  [gmgn] Failed for ${address}: ${(err as Error).message}`);
    return undefined; // non-fatal
  }
}
