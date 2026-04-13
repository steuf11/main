import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import pLimit from "p-limit";
import Table from "cli-table3";
import { createObjectCsvWriter } from "csv-writer";
import { fetchWalletStats, closeBrowser } from "./lpagent";
import { computeScore } from "./scoring";
import { applyFilters } from "./filters";
import { WalletStats, HunterConfig } from "./types";

const config: HunterConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf8")
);

// ─── Output helpers ───────────────────────────────────────────────────────────

function ensureOutputDir(): void {
  if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
  }
}

function printTable(wallets: WalletStats[], limit?: number): void {
  const rows = wallets.slice(0, limit ?? wallets.length);
  const table = new Table({
    head: [
      "#",
      "Address",
      "Score",
      "WinRate",
      "ProfitRatio",
      "AvgMonthly (SOL)",
      "TotalProfit (SOL)",
      "Positions",
      "Followers",
      "Pass",
    ],
    colWidths: [4, 46, 7, 9, 13, 18, 19, 11, 11, 6],
    style: { head: ["cyan"] },
  });

  rows.forEach((w, i) => {
    table.push([
      String(i + 1),
      w.address,
      w.score.toFixed(1),
      (w.winRate * 100).toFixed(1) + "%",
      w.profitRatio.toFixed(4),
      w.avgMonthlyProfit.toFixed(2),
      w.totalProfit.toFixed(2),
      String(w.totalPositionsClosed),
      w.followers !== undefined ? String(w.followers) : "—",
      w.passesFilter ? "✓" : "✗",
    ]);
  });

  console.log(table.toString());
}

async function exportCsv(wallets: WalletStats[], filename: string): Promise<void> {
  ensureOutputDir();
  const writer = createObjectCsvWriter({
    path: path.join(config.outputDir, filename),
    header: [
      { id: "address", title: "Address" },
      { id: "score", title: "Score" },
      { id: "winRate", title: "WinRate" },
      { id: "profitRatio", title: "ProfitRatio" },
      { id: "avgMonthlyProfit", title: "AvgMonthlyProfit_SOL" },
      { id: "totalProfit", title: "TotalProfit_SOL" },
      { id: "avgInvestedPerPosition", title: "AvgInvested_SOL" },
      { id: "totalPositionsClosed", title: "PositionsClosed" },
      { id: "followers", title: "Followers" },
      { id: "passesFilter", title: "PassesFilter" },
    ],
  });
  await writer.writeRecords(wallets);
  console.log(`CSV → ${path.join(config.outputDir, filename)}`);
}

function exportJson(wallets: WalletStats[], filename: string): void {
  ensureOutputDir();
  const p = path.join(config.outputDir, filename);
  fs.writeFileSync(p, JSON.stringify(wallets, null, 2));
  console.log(`JSON → ${p}`);
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

async function analyzeOne(address: string): Promise<WalletStats> {
  console.log(`Fetching ${address}…`);
  const stats = await fetchWalletStats(address.trim());
  stats.score = computeScore(stats);
  stats.passesFilter = applyFilters(stats, config.filters);
  return stats;
}

async function analyzeMany(
  addresses: string[],
  concurrency: number = config.concurrency
): Promise<WalletStats[]> {
  const limit = pLimit(concurrency);
  const results = await Promise.all(
    addresses.map((addr) => limit(() => analyzeOne(addr)))
  );
  return results.sort((a, b) => b.score - a.score);
}

function readWalletFile(filePath: string): string[] {
  return fs
    .readFileSync(filePath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

// ─── CLI commands ─────────────────────────────────────────────────────────────

const program = new Command();
program.name("wallet-hunter").description("Meteora DLMM Wallet Hunter").version("1.0.0");

// wallet <ADDRESS>
program
  .command("wallet <address>")
  .description("Analyse a single wallet")
  .action(async (address: string) => {
    try {
      const stats = await analyzeOne(address);
      printTable([stats]);
      const ts = Date.now();
      await exportCsv([stats], `wallet_${ts}.csv`);
      exportJson([stats], `wallet_${ts}.json`);
    } finally {
      await closeBrowser();
    }
  });

// analyze --file wallets.txt
program
  .command("analyze")
  .description("Analyse a list of wallets from a file")
  .requiredOption("-f, --file <path>", "Path to wallet list (one address per line)")
  .option("-c, --concurrency <n>", "Parallel requests", String(config.concurrency))
  .action(async (opts: { file: string; concurrency: string }) => {
    try {
      const addresses = readWalletFile(opts.file);
      console.log(`Analysing ${addresses.length} wallets (concurrency ${opts.concurrency})…`);
      const results = await analyzeMany(addresses, parseInt(opts.concurrency, 10));
      printTable(results);
      const ts = Date.now();
      await exportCsv(results, `analysis_${ts}.csv`);
      exportJson(results, `analysis_${ts}.json`);
    } finally {
      await closeBrowser();
    }
  });

// top --limit 10
program
  .command("top")
  .description("Show top N wallets from latest analysis JSON")
  .option("-l, --limit <n>", "Number of wallets to display", "10")
  .option("--file <path>", "JSON file to read from (defaults to latest in outputDir)")
  .action((opts: { limit: string; file?: string }) => {
    let jsonPath = opts.file;
    if (!jsonPath) {
      const files = fs
        .readdirSync(config.outputDir)
        .filter((f) => f.startsWith("analysis_") && f.endsWith(".json"))
        .map((f) => path.join(config.outputDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (files.length === 0) {
        console.error("No analysis JSON found in output dir. Run `analyze` first.");
        process.exit(1);
      }
      jsonPath = files[0];
    }
    const wallets: WalletStats[] = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    console.log(`Top ${opts.limit} — source: ${jsonPath}`);
    printTable(wallets, parseInt(opts.limit, 10));
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
