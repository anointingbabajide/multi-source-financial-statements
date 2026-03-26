import { Base_URL } from "./config";
import { getCache, setCache } from "../utils/cache";

const fetchWithRetry = async (
  url: string,
  retries: number = 3,
): Promise<Response> => {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "multisource-financial-statements anointingbabajide@email.com",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error("Max retries exceeded");
};

const getCIKFromTicker = async (ticker: string): Promise<string> => {
  try {
    let tickerMap = await getCache("sec:ticker_map");

    if (!tickerMap) {
      const response = await fetchWithRetry(
        "https://www.sec.gov/files/company_tickers.json",
      );
      tickerMap = await response.json();
      await setCache("sec:ticker_map", tickerMap, 86400);
    }

    const match = Object.values(tickerMap).find(
      (company: any) => company.ticker.toUpperCase() === ticker.toUpperCase(),
    ) as any;

    if (!match) throw new Error(`Ticker ${ticker} not found in SEC EDGAR`);

    return String(match.cik_str).padStart(10, "0");
  } catch (error) {
    throw new Error(
      `Failed to resolve CIK for ticker: ${ticker}. Error: ${error}`,
    );
  }
};
const fetchFinancialReport = async (ticker: string) => {
  const cik = await getCIKFromTicker(ticker);

  try {
    const response = await fetchWithRetry(
      `${Base_URL}/companyfacts/CIK${cik}.json`,
    );
    const data = await response.json();
    return data;
  } catch (error) {
    throw new Error(
      `Failed to fetch financial report for CIK: ${cik}. Error: ${error}`,
    );
  }
};

export { fetchFinancialReport, getCIKFromTicker };
