import { pdfToText } from "pdf-ts";
import { GoogleGenAI } from "@google/genai";
const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const BASE_URL = "https://api.companieshouse.gov.uk";

const getAuthHeader = (): string => {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey)
    throw new Error("COMPANIES_HOUSE_API_KEY not set in environment");
  return `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
};

const getCompanyProfile = async (companyNumber: string) => {
  const response = await fetch(`${BASE_URL}/company/${companyNumber}`, {
    headers: { Authorization: getAuthHeader() },
  });
  if (!response.ok) throw new Error(`Company not found: ${companyNumber}`);
  return await response.json();
};

const getFilingHistory = async (companyNumber: string) => {
  const response = await fetch(
    `${BASE_URL}/company/${companyNumber}/filing-history?category=accounts&items_per_page=10`,
    { headers: { Authorization: getAuthHeader() } },
  );
  if (!response.ok)
    throw new Error(`Failed to fetch filing history for: ${companyNumber}`);
  return await response.json();
};

const getDocumentMetadata = async (metadataUrl: string) => {
  const response = await fetch(metadataUrl, {
    headers: { Authorization: getAuthHeader() },
  });
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

    const response = await fetch(contentUrl, {
      headers: { Authorization: getAuthHeader(), Accept: "application/pdf" },
    });

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

  const response = await fetch(contentUrl, {
    headers: {
      Authorization: getAuthHeader(),
      Accept: acceptHeader,
    },
  });

  if (!response.ok)
    throw new Error(`Failed to download document: ${response.status}`);

  const content = await response.text();
  return { content };
};

const extractFromPDFWithGemini = async (
  documentUrl: string,
): Promise<Record<string, number | null>> => {
  const contentUrl = documentUrl.endsWith("/content")
    ? documentUrl
    : `${documentUrl}/content`;

  const response = await fetch(contentUrl, {
    headers: { Authorization: getAuthHeader(), Accept: "application/pdf" },
  });

  if (!response.ok)
    throw new Error(`Failed to download PDF: ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  const base64PDF = buffer.toString("base64");

  const result = await genai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "application/pdf",
              data: base64PDF,
            },
          },
          {
            text: `Extract the following financial figures from this UK annual report.
Return ONLY a valid JSON object with these exact keys, using null if not found.
All values should be raw numbers (no currency symbols or commas):
{
  "revenue": null,
  "gross_profit": null,
  "operating_income": null,
  "net_income": null,
  "total_assets": null,
  "total_liabilities": null,
  "total_equity": null,
  "operating_cash_flow": null,
  "capital_expenditure": null
}`,
          },
        ],
      },
    ],
  });

  const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
};

const fetchCompaniesHouseReport = async (companyNumber: string) => {
  const profile = await getCompanyProfile(companyNumber);

  const filingHistory = await getFilingHistory(companyNumber);
  if (!filingHistory.items || filingHistory.items.length === 0) {
    throw new Error(`No filings found for company: ${companyNumber}`);
  }

  const annualAccountsList = filingHistory.items.filter(
    (item: any) =>
      item.type === "AA" ||
      item.type === "ACCOUNTS TYPE GROUP" ||
      item.description?.toLowerCase().includes("annual"),
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
      console.log(
        "Available formats for",
        filing.date,
        ":",
        Object.keys(resources),
      );

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
      } else if (resources["application/pdf"]) {
        console.log(`Filing ${filing.date}: PDF - extracting with Gemini`);
        const pdfValues = await extractFromPDFWithGemini(documentUrl);
        return {
          profile,
          iXBRLContent: JSON.stringify(pdfValues),
          format: "pdf",
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
