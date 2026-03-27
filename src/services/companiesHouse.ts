import { pdfToText } from "pdf-ts";

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

export { fetchCompaniesHouseReport, debugPDFText };
