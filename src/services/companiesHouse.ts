import { pdfToText } from "pdf-ts";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const BASE_URL = "https://api.companieshouse.gov.uk";

const TIMESERIES_FIELDS = [
  "annualTotalRevenue",
  "annualGrossProfit",
  "annualOperatingIncome",
  "annualNetIncome",
  "annualTotalAssets",
  "annualTotalLiabilitiesNetMinorityInterest",
  "annualStockholdersEquity",
  "annualOperatingCashFlow",
  "annualCapitalExpenditure",
  "annualFreeCashFlow",
].join(",");

const getAuthHeader = (): string => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey)
    throw new Error("COMPANIES_HOUSE_API_KEY not set in environment");
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
};

const fetchWithTimeout = async (
  url: string,
  options: RequestInit = {},
  ms: number = 15000,
): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error(`Request timed out after ${ms}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const getCompanyProfile = async (companyNumber: string) => {
  const response = await fetchWithTimeout(
    `${BASE_URL}/company/${companyNumber}`,
    { headers: { Authorization: getAuthHeader() } },
    10000,
  );
  if (!response.ok) throw new Error(`Company not found: ${companyNumber}`);
  return await response.json();
};

const getFilingHistory = async (companyNumber: string) => {
  const response = await fetchWithTimeout(
    `${BASE_URL}/company/${companyNumber}/filing-history?category=accounts&items_per_page=10`,
    { headers: { Authorization: getAuthHeader() } },
    10000,
  );
  if (!response.ok)
    throw new Error(`Failed to fetch filing history for: ${companyNumber}`);
  return await response.json();
};

const getDocumentMetadata = async (metadataUrl: string) => {
  const response = await fetchWithTimeout(
    metadataUrl,
    { headers: { Authorization: getAuthHeader() } },
    10000,
  );
  if (!response.ok)
    throw new Error(`Failed to fetch document metadata from: ${metadataUrl}`);
  const data = await response.json();
  console.log("Available formats:", Object.keys(data.resources || {}));
  return data;
};

const debugPDFText = async (companyNumber: string) => {
  const filingHistory = await getFilingHistory(companyNumber);

  for (const filing of filingHistory.items) {
    const metadataUrl = filing.links?.document_metadata;
    if (!metadataUrl) continue;

    const metadata = await getDocumentMetadata(metadataUrl);
    const resources = metadata?.resources || {};
    if (!resources["application/pdf"]) continue;

    const documentUrl = metadata?.links?.document;
    if (!documentUrl) continue;

    const contentUrl = documentUrl.endsWith("/content")
      ? documentUrl
      : `${documentUrl}/content`;

    const response = await fetchWithTimeout(
      contentUrl,
      {
        headers: { Authorization: getAuthHeader(), Accept: "application/pdf" },
      },
      20000,
    );

    if (!response.ok) {
      console.log("Failed to fetch PDF:", response.status);
      continue;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const text = await pdfToText(buffer);

    console.log("=== PDF TEXT FOR", companyNumber, filing.date, "===");
    console.log(text);
    console.log("=== END ===");
    break;
  }
};

const downloadDocument = async (documentUrl: string, acceptHeader: string) => {
  const contentUrl = documentUrl.endsWith("/content")
    ? documentUrl
    : `${documentUrl}/content`;

  const response = await fetchWithTimeout(
    contentUrl,
    {
      headers: {
        Authorization: getAuthHeader(),
        Accept: acceptHeader,
      },
    },
    20000, // 20s for document download
  );

  if (!response.ok)
    throw new Error(`Failed to download document: ${response.status}`);

  const content = await response.text();
  return { content };
};

const fetchCompaniesHouseReport = async (companyNumber: string) => {
  const profile = await getCompanyProfile(companyNumber);
  const filingHistory = await getFilingHistory(companyNumber);
  if (!filingHistory.items || filingHistory.items.length === 0) {
    throw new Error(`No filings found for company: ${companyNumber}`);
  }

  const annualAccountsList = filingHistory.items
    .filter(
      (item: any) =>
        item.type === "AA" ||
        item.type === "ACCOUNTS TYPE GROUP" ||
        item.description?.toLowerCase().includes("annual"),
    )
    // Sort by date descending - most recent first
    .sort(
      (a: any, b: any) =>
        new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

  if (annualAccountsList.length === 0) {
    throw new Error(`No annual accounts found for: ${companyNumber}`);
  }

  for (const filing of annualAccountsList) {
    try {
      const metadataUrl = filing.links?.document_metadata;
      if (!metadataUrl) continue;
      const metadata = await getDocumentMetadata(metadataUrl);
      const documentUrl = metadata?.links?.document;
      if (!documentUrl) continue;
      const resources = metadata?.resources || {};
      // console.log(
      //   "Available formats for",
      //   filing.date,
      //   ":",
      //   Object.keys(resources),
      // );
      if (resources["application/xhtml+xml"]) {
        const { content } = await downloadDocument(
          documentUrl,
          "application/xhtml+xml",
        );
        return {
          profile,
          iXBRLContent: content,
          format: "ixbrl",
          filedAt: filing.date,
        };
      } else if (resources["text/html"]) {
        const { content } = await downloadDocument(documentUrl, "text/html");
        return {
          profile,
          iXBRLContent: content,
          format: "ixbrl",
          filedAt: filing.date,
        };
      } else if (resources["application/xml"]) {
        const { content } = await downloadDocument(
          documentUrl,
          "application/xml",
        );
        return {
          profile,
          iXBRLContent: content,
          format: "xbrl",
          filedAt: filing.date,
        };
      } else {
        console.log(`Filing ${filing.date}: no recognised format - skipping`);
        continue;
      }
    } catch (error) {
      console.log(`Filing ${filing.date} failed:`, error);
      continue;
    }
  }

  throw new Error(
    `No structured iXBRL filing found for company: ${companyNumber}. This company may only file scanned PDFs.`,
  );
};

const fetchFundamentalsTimeSeries = async (
  ticker: string,
): Promise<Record<string, any[]>> => {
  const period1 = 1420070400;
  const period2 = Math.floor(Date.now() / 1000);
  const url =
    `https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${ticker}` +
    `?symbol=${ticker}&type=${TIMESERIES_FIELDS}&period1=${period1}&period2=${period2}`;

  const response = await fetchWithTimeout(
    url,
    { headers: { "User-Agent": "Mozilla/5.0" } },
    15000,
  );
  if (!response.ok)
    throw new Error(`Timeseries fetch failed: ${response.status}`);

  const json = await response.json();
  const result: Record<string, any[]> = {};
  for (const item of json?.timeseries?.result ?? []) {
    const key = item.meta?.type?.[0];
    if (key) result[key] = item[key] ?? [];
  }
  return result;
};

const fetchYahooFinanceReport = async (ticker: string) => {
  console.log(`Fetching Yahoo Finance data for ${ticker}`);

  const [summary, timeseries] = await Promise.all([
    yahooFinance.quoteSummary(ticker, {
      modules: ["financialData", "quoteType"],
    }),
    fetchFundamentalsTimeSeries(ticker),
  ]);

  const financial = summary.financialData;
  const quoteType = (summary as any).quoteType;

  // Gets the most recent entry's value for a given timeseries key
  const latest = (key: string): number | null => {
    const series = timeseries[key];
    if (!series || series.length === 0) return null;
    return series[series.length - 1]?.reportedValue?.raw ?? null;
  };

  // Gets the prior year entry's value
  const prior = (key: string): number | null => {
    const series = timeseries[key];
    if (!series || series.length < 2) return null;
    return series[series.length - 2]?.reportedValue?.raw ?? null;
  };

  // asOfDate is already a plain "YYYY-MM-DD" string in the timeseries response
  const latestEntry = (key: string): any | null => {
    const series = timeseries[key];
    if (!series || series.length === 0) return null;
    return series[series.length - 1] ?? null;
  };

  const revenueEntry = latestEntry("annualTotalRevenue");

  // filed_at: use asOfDate directly — it's already "YYYY-MM-DD", no conversion needed
  const filedAt: string =
    revenueEntry?.asOfDate ?? new Date().toISOString().split("T")[0];

  // currency: prefer timeseries currencyCode over financialData.financialCurrency
  // because financialCurrency can return "USD" for dual-listed UK stocks
  const currency: string =
    revenueEntry?.currencyCode ?? financial?.financialCurrency ?? "GBP";

  // Income statement
  const currentRevenue = latest("annualTotalRevenue");
  const priorRevenue = prior("annualTotalRevenue");
  const currentNetIncome = latest("annualNetIncome");
  const priorNetIncome = prior("annualNetIncome");

  // Cash flow — capex is negative in timeseries (cash outflow), normalise to positive
  const operatingCashFlow =
    latest("annualOperatingCashFlow") ?? financial?.operatingCashflow ?? null;
  const rawCapex = latest("annualCapitalExpenditure");
  const capitalExpenditure = rawCapex != null ? Math.abs(rawCapex) : null;
  const freeCashFlow =
    latest("annualFreeCashFlow") ??
    (operatingCashFlow != null && capitalExpenditure != null
      ? operatingCashFlow - capitalExpenditure
      : (financial?.freeCashflow ?? null));

  // YoY changes
  const revenuePct =
    currentRevenue && priorRevenue
      ? parseFloat(
          (((currentRevenue - priorRevenue) / priorRevenue) * 100).toFixed(2),
        )
      : null;
  const netIncomePct =
    currentNetIncome && priorNetIncome
      ? parseFloat(
          (
            ((currentNetIncome - priorNetIncome) / priorNetIncome) *
            100
          ).toFixed(2),
        )
      : null;

  return {
    company: quoteType?.longName ?? quoteType?.shortName ?? ticker,
    iXBRLContent: JSON.stringify({
      revenue: currentRevenue ?? financial?.totalRevenue ?? null,
      gross_profit:
        latest("annualGrossProfit") ?? financial?.grossProfits ?? null,
      operating_income: latest("annualOperatingIncome") ?? null,
      net_income: currentNetIncome ?? null,
      total_assets: latest("annualTotalAssets") ?? null,
      total_liabilities:
        latest("annualTotalLiabilitiesNetMinorityInterest") ?? null,
      total_equity: latest("annualStockholdersEquity") ?? null,
      operating_cash_flow: operatingCashFlow,
      capital_expenditure: capitalExpenditure,
      free_cash_flow: freeCashFlow,
      revenue_pct: revenuePct,
      net_income_pct: netIncomePct,
    }),
    format: "yahoo",
    filedAt,
    currency,
  };
};

const fetchUKCompanyReport = async (companyNumber: string, ticker?: string) => {
  const isPDFOnlyError = (message: string) =>
    message.includes("scanned PDFs") || message.includes("No structured iXBRL");

  try {
    const report = await fetchCompaniesHouseReport(companyNumber);
    return { ...report, source: "companies_house" };
  } catch (chError: any) {
    console.log(
      `Companies House failed for ${companyNumber}:`,
      chError.message,
    );

    if (!isPDFOnlyError(chError.message)) {
      throw chError;
    } else if (!ticker) {
      throw new Error(
        `No structured iXBRL filing found for company: ${companyNumber}. ` +
          `This company may only file scanned PDFs. ` +
          `If this is a listed company, provide its stock ticker (e.g. TSCO.L for Tesco) to fetch from Yahoo Finance.`,
      );
    } else {
      console.log(`Falling back to Yahoo Finance for ticker: ${ticker}`);
      const report = await fetchYahooFinanceReport(ticker);
      return { ...report, source: "yahoo_finance" };
    }
  }
};

export {
  fetchCompaniesHouseReport,
  fetchYahooFinanceReport,
  fetchUKCompanyReport,
  debugPDFText,
};
