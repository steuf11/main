import puppeteer, { Browser, Page } from "puppeteer";
import * as fs from "fs";
import * as path from "path";
import { WalletStats } from "./types";

const CACHE_DIR = path.join(process.cwd(), ".cache");
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface RawLpData {
  totalPositionsClosed: number;
  avgInvestedPerPosition: number;
  totalProfit: number;
  avgMonthlyProfit: number;
  winRate: number;
  followers?: number;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cachePath(address: string): string {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  return path.join(CACHE_DIR, `${address}.json`);
}

function readCache(address: string): RawLpData | null {
  const p = cachePath(address);
  if (!fs.existsSync(p)) return null;
  const stat = fs.statSync(p);
  if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as RawLpData;
  } catch {
    return null;
  }
}

function writeCache(address: string, data: RawLpData): void {
  fs.writeFileSync(cachePath(address), JSON.stringify(data, null, 2));
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

function parseNumber(raw: string): number {
  // Remove currency symbols, commas, spaces; handle "−" (minus sign variant)
  const cleaned = raw.replace(/[,$%\s]/g, "").replace("−", "-");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parsePercent(raw: string): number {
  // Returns 0–1
  const n = parseNumber(raw.replace("%", ""));
  return n / 100;
}

// ─── DOM extraction (runs inside page context) ────────────────────────────────

interface PageRaw {
  positionsRaw: string;
  avgInvestedRaw: string;
  totalProfitRaw: string;
  avgMonthlyRaw: string;
  winRateRaw: string;
  followersRaw: string;
}

async function extractFromPage(page: Page): Promise<RawLpData> {
  const raw: PageRaw = await page.evaluate((): PageRaw => {
    function findByLabel(label: string): string {
      const allElems = Array.from(document.querySelectorAll("*"));
      for (const el of allElems) {
        const htmlEl = el as HTMLElement;
        const text = htmlEl.innerText?.trim() ?? "";
        if (text.toLowerCase().includes(label.toLowerCase()) && el.children.length < 5) {
          const siblings = el.parentElement
            ? Array.from(el.parentElement.children)
            : [];
          for (const sib of siblings) {
            if (sib !== el) {
              const val = (sib as HTMLElement).innerText?.trim();
              if (val && /[\d.%,\-\u2212]/.test(val)) return val;
            }
          }
          const parent = el.parentElement?.parentElement;
          if (parent) {
            const cousins = Array.from(parent.children);
            const myIdx = cousins.indexOf(el.parentElement!);
            if (myIdx >= 0 && myIdx + 1 < cousins.length) {
              const val = (cousins[myIdx + 1] as HTMLElement).innerText?.trim();
              if (val && /[\d.%,\-\u2212]/.test(val)) return val;
            }
          }
        }
      }
      return "";
    }

    const bodyText = (document.body as HTMLElement).innerText;

    function regexFallback(pattern: RegExp): string {
      const m = bodyText.match(pattern);
      return m ? m[1] : "";
    }

    return {
      positionsRaw:
        findByLabel("Positions Closed") ||
        findByLabel("Closed Positions") ||
        findByLabel("Total Positions") ||
        regexFallback(/positions?\s*closed[:\s]*([0-9,]+)/i),
      avgInvestedRaw:
        findByLabel("Avg Invested") ||
        findByLabel("Average Invested") ||
        findByLabel("Avg Size") ||
        regexFallback(/avg\s*invested[:\s]*([0-9.,]+)/i),
      totalProfitRaw:
        findByLabel("Total Profit") ||
        findByLabel("Total PnL") ||
        findByLabel("Total P&L") ||
        regexFallback(/total\s*profit[:\s]*(-?[0-9.,]+)/i),
      avgMonthlyRaw:
        findByLabel("Avg Monthly") ||
        findByLabel("Monthly Profit") ||
        findByLabel("Monthly PnL") ||
        regexFallback(/avg\s*monthly[:\s]*(-?[0-9.,]+)/i),
      winRateRaw:
        findByLabel("Win Rate") ||
        findByLabel("Win %") ||
        regexFallback(/win\s*rate[:\s]*([0-9.]+\s*%)/i),
      followersRaw:
        findByLabel("Followers") ||
        regexFallback(/followers[:\s]*([0-9,]+)/i),
    };
  });

  const totalPositionsClosed = parseNumber(raw.positionsRaw);
  const avgInvestedPerPosition = parseNumber(raw.avgInvestedRaw);
  const totalProfit = parseNumber(raw.totalProfitRaw);
  const avgMonthlyProfit = parseNumber(raw.avgMonthlyRaw);
  const winRate = raw.winRateRaw.includes("%")
    ? parsePercent(raw.winRateRaw)
    : parseNumber(raw.winRateRaw);
  const followers = raw.followersRaw ? parseNumber(raw.followersRaw) : undefined;

  return {
    totalPositionsClosed,
    avgInvestedPerPosition,
    totalProfit,
    avgMonthlyProfit,
    winRate,
    followers,
  };
}

// ─── Retry wrapper ────────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = delayMs * Math.pow(2, attempt);
      console.warn(
        `  Retry ${attempt + 1}/${retries} after ${wait}ms — ${(err as Error).message}`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

// ─── Public API ───────────────────────────────────────────────────────────────

let sharedBrowser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!sharedBrowser || !sharedBrowser.connected) {
    sharedBrowser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

export async function fetchWalletStats(address: string): Promise<WalletStats> {
  const cached = readCache(address);
  if (cached) {
    console.log(`  [cache] ${address}`);
    return buildStats(address, cached);
  }

  const raw = await withRetry(async () => {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      await page.setUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      );
      const url = `https://app.lpagent.io/portfolio?address=${address}`;
      await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
      // Give JS frameworks extra time to hydrate
      await new Promise((r) => setTimeout(r, 3000));
      return await extractFromPage(page);
    } finally {
      await page.close();
    }
  });

  writeCache(address, raw);
  return buildStats(address, raw);
}

function buildStats(address: string, raw: RawLpData): WalletStats {
  const denom = raw.avgInvestedPerPosition * raw.totalPositionsClosed;
  const profitRatio = denom > 0 ? raw.totalProfit / denom : 0;

  return {
    address,
    totalPositionsClosed: raw.totalPositionsClosed,
    avgInvestedPerPosition: raw.avgInvestedPerPosition,
    totalProfit: raw.totalProfit,
    avgMonthlyProfit: raw.avgMonthlyProfit,
    winRate: raw.winRate,
    profitRatio,
    followers: raw.followers,
    score: 0,         // filled by scoring.ts
    passesFilter: false, // filled by filters.ts
  };
}
