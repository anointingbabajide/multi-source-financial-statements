import { Base_URL } from "./config";

const getCIKFromTicker = async (ticker: string): Promise<string> => {
  try {
    const response = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      {
        headers: {
          "User-Agent":
            "multi-source-financial-statements anointingbabajide@email.com",
        },
      },
    );
    const data = await response.json();

    const match = Object.values(data).find(
      (company: any) => company.ticker.toUpperCase() === ticker.toUpperCase(),
    ) as any;

    if (!match) throw new Error(`Ticker ${ticker} not found`);

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
    const response = await fetch(`${Base_URL}/companyfacts/CIK${cik}.json`, {
      headers: {
        "User-Agent":
          "multi-source-financial-statements anointingbabajide@email.com",
      },
    });
    const data = await response.json();
    return data;
  } catch (error) {
    throw new Error(
      `Failed to fetch financial report for CIK: ${cik}. Error: ${error}`,
    );
  }
};

export { fetchFinancialReport, getCIKFromTicker };
