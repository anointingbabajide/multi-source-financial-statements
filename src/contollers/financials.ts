import { fetchFinancialReport } from "../services/edgar";
import {
  fetchUKCompanyReport,
  fetchYahooFinanceReport,
} from "../services/companiesHouse";
import { normalizeEDGARData } from "../normalizers/edgar";
import {
  normalizeCompaniesHouseData,
  normalizeYahooFinanceData,
} from "../normalizers/companiesHouse";
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
          "Ticker or company number is required. Example: ?ticker=AAPL or ?ticker=00102498 or ?ticker=TSCO.L",
      });
    }

    const identifier = ticker.toUpperCase();
    const form = formType === "10-Q" ? "10-Q" : "10-K";
    const source = detectSource(identifier);
    const cacheKey = `financials:${identifier}:${source}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return res
        .status(200)
        .json({ success: true, source: "cache", data: cached });
    }

    let normalized;
    let actualSource: string;

    if (source === "SEC_EDGAR") {
      const rawData = await fetchFinancialReport(identifier);
      normalized = normalizeEDGARData(rawData, form);
      actualSource = "edgar";
    } else if (source === "COMPANIES_HOUSE") {
      const yahooTicker = req.query.yahooTicker as string | undefined;
      const report = await fetchUKCompanyReport(identifier, yahooTicker);

      if (report.source === "yahoo_finance") {
        normalized = normalizeYahooFinanceData(identifier, report);
        actualSource = "yahoo_finance";
      } else {
        const { profile, iXBRLContent, filedAt } = report as any;
        normalized = normalizeCompaniesHouseData(
          profile,
          iXBRLContent,
          filedAt,
        );
        actualSource = "companies_house";
      }
    } else if (source === "YAHOO_FINANCE") {
      const report = await fetchYahooFinanceReport(identifier);
      normalized = normalizeYahooFinanceData(identifier, report);
      actualSource = "yahoo_finance";
    } else {
      return res.status(400).json({
        success: false,
        error: `Could not detect source for: ${identifier}. Use a US ticker like AAPL, a UK company number like 00102498, or a Yahoo ticker like TSCO.L`,
      });
    }

    await setCache(cacheKey, normalized, 86400);
    return res.status(200).json({
      success: true,
      source: actualSource,
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
