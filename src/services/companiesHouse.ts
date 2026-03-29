import { pdfToText } from "pdf-ts";
import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const BASE_URL = "https://api.companieshouse.gov.uk";

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

const fetchYahooFinanceReport = async (ticker: string) => {
  console.log(`Fetching Yahoo Finance data for ${ticker}`);
  const result = await yahooFinance.quoteSummary(ticker, {
    modules: [
      "incomeStatementHistory",
      "cashflowStatementHistory",
      "financialData",
      "defaultKeyStatistics",
      "quoteType",
    ],
  });

  const income = result.incomeStatementHistory?.incomeStatementHistory ?? [];
  const financial = result.financialData;
  const quoteType = (result as any).quoteType;

  const currentIncome = income[0];
  const priorIncome = income[1];

  // Derive equity and assets from debtToEquity ratio
  const totalDebt = financial?.totalDebt ?? null;
  const debtToEquity = financial?.debtToEquity ?? null;
  const totalEquity =
    totalDebt && debtToEquity ? totalDebt / (debtToEquity / 100) : null;
  const totalAssets = totalDebt && totalEquity ? totalDebt + totalEquity : null;

  // Derive capex from free cash flow and operating cash flow
  const operatingCashFlow = financial?.operatingCashflow ?? null;
  const freeCashFlow = financial?.freeCashflow ?? null;
  const capitalExpenditure =
    operatingCashFlow && freeCashFlow
      ? Math.abs(freeCashFlow - operatingCashFlow)
      : null;

  // Calculate YoY
  const currentRevenue = currentIncome?.totalRevenue ?? null;
  const priorRevenue = priorIncome?.totalRevenue ?? null;
  const revenuePct =
    currentRevenue && priorRevenue
      ? parseFloat(
          (((currentRevenue - priorRevenue) / priorRevenue) * 100).toFixed(2),
        )
      : null;

  const currentNetIncome = currentIncome?.netIncome ?? null;
  const priorNetIncome = priorIncome?.netIncome ?? null;
  const netIncomePct =
    currentNetIncome && priorNetIncome
      ? parseFloat(
          (
            ((currentNetIncome - priorNetIncome) / priorNetIncome) *
            100
          ).toFixed(2),
        )
      : null;

  // console.log("currentRevenue:", currentRevenue);
  // console.log("priorRevenue:", priorRevenue);
  // console.log("revenuePct:", revenuePct);
  // console.log("income array length:", income.length);
  // console.log("debtToEquity:", debtToEquity);
  // console.log("totalDebt:", totalDebt);
  // console.log("totalEquity:", totalEquity);
  // console.log("totalAssets:", totalAssets);
  // console.log("currentRevenue:", currentRevenue);
  // console.log("priorRevenue:", priorRevenue);
  // console.log("revenuePct:", revenuePct);
  // console.log("currentNetIncome:", currentNetIncome);
  // console.log("priorNetIncome:", priorNetIncome);
  // console.log("netIncomePct:", netIncomePct);

  return {
    company: quoteType?.longName ?? quoteType?.shortName ?? ticker,
    iXBRLContent: JSON.stringify({
      revenue: currentRevenue ?? financial?.totalRevenue ?? null,
      gross_profit: financial?.grossProfits ?? null,
      operating_income: financial?.ebitda ?? null,
      net_income: currentNetIncome ?? null,
      total_assets: totalAssets,
      total_liabilities: totalDebt,
      total_equity: totalEquity,
      operating_cash_flow: operatingCashFlow,
      capital_expenditure: capitalExpenditure,
      free_cash_flow: freeCashFlow,
      revenue_pct: revenuePct,
      net_income_pct: netIncomePct,
    }),
    format: "yahoo",
    filedAt:
      currentIncome?.endDate?.toISOString().split("T")[0] ??
      new Date().toISOString().split("T")[0],
    currency: financial?.financialCurrency ?? "USD",
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
