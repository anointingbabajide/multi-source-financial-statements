import { fetchFinancialReport } from "../services/edgar";
import { normalizeEDGARData } from "../normalizers/edgar";
import { getCache, setCache } from "../utils/cache";
import { Request, Response } from "express";

const getFinancials = async (req: Request, res: Response) => {
  try {
    const { ticker, formType } = req.query;

    if (!ticker || typeof ticker !== "string") {
      return res.status(400).json({
        success: false,
        error: "Ticker is required. Example: ?ticker=AAPL",
      });
    }

    const form = formType === "10-Q" ? "10-Q" : "10-K";
    const cacheKey = `financials:${ticker.toUpperCase()}:${form}`;

    const cached = await getCache(cacheKey);
    if (cached) {
      return res.status(200).json({
        success: true,
        source: "cache",
        data: cached,
      });
    }

    const rawData = await fetchFinancialReport(ticker.toUpperCase());
    const normalized = normalizeEDGARData(rawData, form);

    await setCache(cacheKey, normalized, 86400);

    return res.status(200).json({
      success: true,
      source: "edgar",
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
