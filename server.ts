import "dotenv/config";
import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import router from "./src/routes/index";
import { startCronJob } from "./src/jobs/nightly";
import { fetchFinancialReport } from "./src/services/edgar";
import { normalizeEDGARData } from "./src/normalizers/edgar";
import { getCache, setCache } from "./src/utils/cache";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// REST API routes
app.use("/api", router);

// MCP endpoint
app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const server = new McpServer({
      name: "multisource-financial-statements",
      version: "1.0.0",
    });

    // Tool 1 - get financials for a single company
    server.tool(
      "get_financials",
      "Get normalized financial statements for any US public company. Returns balance sheet, income statement, and cash flow data from SEC EDGAR. Replaces Bloomberg Terminal at $0.10 per query.",
      {
        ticker: z
          .string()
          .describe("Stock ticker symbol e.g. AAPL, MSFT, GOOGL, TSLA"),
        formType: z
          .enum(["10-K", "10-Q"])
          .optional()
          .default("10-K")
          .describe("10-K for annual data, 10-Q for most recent quarter"),
      },
      async ({ ticker, formType }) => {
        const identifier = ticker.toUpperCase();
        const form = formType ?? "10-K";
        const cacheKey = `financials:${identifier}:${form}`;

        const cached = await getCache(cacheKey);
        if (cached) {
          return {
            content: [{ type: "text", text: JSON.stringify(cached, null, 2) }],
          };
        }

        const rawData = await fetchFinancialReport(identifier);
        const normalized = normalizeEDGARData(rawData, form);
        await setCache(cacheKey, normalized, 86400);

        return {
          content: [
            { type: "text", text: JSON.stringify(normalized, null, 2) },
          ],
        };
      },
    );

    // Tool 2 - compare metric across multiple companies
    server.tool(
      "get_financials_comparison",
      "Compare a specific financial metric across multiple US public companies in one call. Useful for competitive analysis and benchmarking.",
      {
        tickers: z
          .array(z.string())
          .describe(
            "Array of ticker symbols to compare e.g. ['AAPL', 'MSFT', 'GOOGL']",
          ),
        metric: z
          .enum([
            "revenue",
            "gross_profit",
            "operating_income",
            "net_income",
            "total_assets",
            "total_liabilities",
            "total_equity",
            "operating_cash_flow",
            "free_cash_flow",
          ])
          .describe("The financial metric to compare across all companies"),
      },
      async ({ tickers, metric }) => {
        const results = await Promise.allSettled(
          tickers.map(async (ticker) => {
            const identifier = ticker.toUpperCase();
            const cacheKey = `financials:${identifier}:10-K`;

            const cached = await getCache(cacheKey);
            if (cached) return { ticker: identifier, data: cached };

            const rawData = await fetchFinancialReport(identifier);
            const normalized = normalizeEDGARData(rawData, "10-K");
            await setCache(cacheKey, normalized, 86400);
            return { ticker: identifier, data: normalized };
          }),
        );

        const comparison = results.map((result, index) => {
          if (result.status === "rejected") {
            return {
              ticker: tickers[index].toUpperCase(),
              error: result.reason?.message,
            };
          }

          const { ticker, data } = result.value;
          const f = data.financials;

          const valueMap: Record<string, number | null> = {
            revenue: f.income_statement.revenue,
            gross_profit: f.income_statement.gross_profit,
            operating_income: f.income_statement.operating_income,
            net_income: f.income_statement.net_income,
            total_assets: f.balance_sheet.total_assets,
            total_liabilities: f.balance_sheet.total_liabilities,
            total_equity: f.balance_sheet.total_equity,
            operating_cash_flow: f.cash_flow.operating_cash_flow,
            free_cash_flow: f.cash_flow.free_cash_flow,
          };

          return {
            ticker,
            company: data.company,
            period: data.period,
            currency: data.currency,
            metric,
            value: valueMap[metric] ?? null,
            yoy_pct:
              metric === "revenue"
                ? data.yoy_changes.revenue_pct
                : metric === "net_income"
                  ? data.yoy_changes.net_income_pct
                  : null,
          };
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ metric, results: comparison }, null, 2),
            },
          ],
        };
      },
    );

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startCronJob();
});

export default app;
