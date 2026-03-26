import { fetchFinancialReport } from "../services/edgar";
import {
  debugPDFText,
  fetchCompaniesHouseReport,
} from "../services/companiesHouse";
import { normalizeEDGARData } from "../normalizers/edgar";
import { normalizeCompaniesHouseData } from "../normalizers/companiesHouse";
import { detectSource } from "../utils/sourceDetector";
import { getCache, setCache } from "../utils/cache";
import { Request, Response } from "express";

const getFinancials = async (req: Request, res: Response) => {
  try {
    const { ticker, formType } = req.query;

    if (!ticker || typeof ticker !== "string") {
      return res.status(400).json({
        success: false,
        error:
          "Ticker or company number is required. Example: ?ticker=AAPL or ?ticker=00102498",
      });
    }

    const identifier = ticker.toUpperCase();
    const form = formType === "10-Q" ? "10-Q" : "10-K";
    const source = detectSource(identifier);
    const cacheKey = `financials:${identifier}:${source}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: "cache",
        data: cached,
      });
    }

    let normalized;
    await debugPDFText("00445790");
    if (source === "SEC_EDGAR") {
      const rawData = await fetchFinancialReport(identifier);
      normalized = normalizeEDGARData(rawData, form);
    } else if (source === "COMPANIES_HOUSE") {
      const { profile, iXBRLContent, filedAt } =
        await fetchCompaniesHouseReport(identifier);
      normalized = normalizeCompaniesHouseData(profile, iXBRLContent, filedAt);
    } else {
      return res.status(400).json({
        success: false,
        error: `Could not detect source for: ${identifier}. Use a US ticker like AAPL or a UK company number like 00102498`,
      });
    }

    await setCache(cacheKey, normalized, 86400);

    return res.status(200).json({
      success: true,
      source: source === "SEC_EDGAR" ? "edgar" : "companies_house",
      data: normalized,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message ?? "Something went wrong",
    });
  }
};

export { getFinancials };
