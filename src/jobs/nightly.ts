import cron from "node-cron";
import { fetchFinancialReport } from "../services/edgar";
import { normalizeEDGARData } from "../normalizers/edgar";
import { setCache, getCache, redis } from "../utils/cache";
import { JobStats } from "../interface/IFinancialStatement";

const TOP_COMPANIES = [
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
  "NVDA",
  "META",
  "TSLA",
  "JPM",
  "V",
  "JNJ",
  "WMT",
  "XOM",
  "UNH",
  "MA",
  "PG",
  "HD",
  "CVX",
  "MRK",
  "ABBV",
  "PEP",
  "KO",
  "AVGO",
  "COST",
  "MCD",
  "TMO",
  "CSCO",
  "ACN",
  "ABT",
  "DHR",
  "NEE",
  "LIN",
  "TXN",
  "PM",
  "RTX",
  "ORCL",
  "QCOM",
  "HON",
  "UPS",
  "IBM",
  "SBUX",
  "GS",
  "CAT",
  "BA",
  "GE",
  "AMGN",
  "INTU",
  "AMAT",
  "BKNG",
  "ISRG",
  "NOW",
];

const CONCURRENCY_LIMIT = 5;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;
const JOB_LOCK_KEY = "cron:nightly:lock";
const JOB_LOCK_TTL = 3600;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const prefetchWithRetry = async (
  ticker: string,
  attempt: number = 1,
): Promise<boolean> => {
  try {
    const cacheKey = `financials:${ticker}:10-K`;
    const rawData = await fetchFinancialReport(ticker);
    const normalized = normalizeEDGARData(rawData, "10-K");
    await setCache(cacheKey, normalized, 86400);
    return true;
  } catch (error) {
    if (attempt < RETRY_ATTEMPTS) {
      await sleep(RETRY_DELAY_MS * attempt);
      return prefetchWithRetry(ticker, attempt + 1);
    }
    console.error(
      `Failed to prefetch ${ticker} after ${RETRY_ATTEMPTS} attempts:`,
      error,
    );
    return false;
  }
};

const processBatch = async (
  tickers: string[],
): Promise<{ succeeded: string[]; failed: string[] }> => {
  const succeeded: string[] = [];
  const failed: string[] = [];

  for (let i = 0; i < tickers.length; i += CONCURRENCY_LIMIT) {
    const batch = tickers.slice(i, i + CONCURRENCY_LIMIT);

    const results = await Promise.allSettled(
      batch.map((ticker) => prefetchWithRetry(ticker)),
    );

    results.forEach((result, index) => {
      const ticker = batch[index];
      if (result.status === "fulfilled" && result.value === true) {
        succeeded.push(ticker);
        console.log(`[CRON] Prefetched: ${ticker}`);
      } else {
        failed.push(ticker);
      }
    });

    if (i + CONCURRENCY_LIMIT < tickers.length) {
      await sleep(1000);
    }
  }

  return { succeeded, failed };
};

const runNightlyJob = async () => {
  const lockAcquired = await redis.set(
    JOB_LOCK_KEY,
    "locked",
    "EX",
    JOB_LOCK_TTL,
    "NX",
  );

  if (!lockAcquired) {
    console.log("[CRON] Job already running, skipping...");
    return;
  }

  const stats: JobStats = {
    startedAt: new Date().toISOString(),
    completedAt: null,
    total: TOP_COMPANIES.length,
    succeeded: 0,
    failed: 0,
    failedTickers: [],
  };

  console.log(`[CRON] Nightly prefetch started at ${stats.startedAt}`);
  console.log(
    `[CRON] Processing ${stats.total} companies in batches of ${CONCURRENCY_LIMIT}`,
  );

  try {
    const { succeeded, failed } = await processBatch(TOP_COMPANIES);

    stats.succeeded = succeeded.length;
    stats.failed = failed.length;
    stats.failedTickers = failed;
    stats.completedAt = new Date().toISOString();

    await setCache("cron:nightly:last_run", stats, 86400 * 7);

    console.log(`[CRON] Job completed at ${stats.completedAt}`);
    console.log(
      `[CRON] Success: ${stats.succeeded}/${stats.total} | Failed: ${stats.failed}`,
    );

    if (failed.length > 0) {
      console.warn(`[CRON] Failed tickers: ${failed.join(", ")}`);
    }
  } finally {
    await redis.del(JOB_LOCK_KEY);
  }
};

const startCronJob = () => {
  cron.schedule("0 2 * * *", runNightlyJob, {
    timezone: "UTC",
  });
  console.log("[CRON] Nightly job scheduled for 02:00 UTC");
};

export { startCronJob, runNightlyJob };
