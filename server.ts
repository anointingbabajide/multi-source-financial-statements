import "dotenv/config";
import express, { Request, Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import router from "./src/routes/index";
import { startCronJob } from "./src/jobs/nightly";
import { fetchFinancialReport } from "./src/services/edgar";
import { normalizeEDGARData } from "./src/normalizers/edgar";
import { getCache, setCache } from "./src/utils/cache";

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use("/api", router);

const TOOLS = [
  {
    name: "get_financials",
    description:
      "Get normalized financial statements for any US public company. Returns balance sheet, income statement, and cash flow data from SEC EDGAR.",
    inputSchema: {
      type: "object",
      properties: {
        ticker: {
          type: "string",
          description: "Stock ticker e.g. AAPL, MSFT, GOOGL, TSLA",
        },
        formType: {
          type: "string",
          enum: ["10-K", "10-Q"],
          description: "10-K for annual, 10-Q for quarterly. Defaults to 10-K",
        },
      },
      required: ["ticker"],
    },
    outputSchema: {
      type: "object",
      properties: {
        company: { type: "string" },
        cik: { type: "string" },
        currency: { type: "string" },
        period: { type: "string" },
        filing_type: { type: "string" },
        filed_at: { type: "string" },
        financials: {
          type: "object",
          properties: {
            income_statement: {
              type: "object",
              properties: {
                revenue: { type: ["number", "null"] },
                gross_profit: { type: ["number", "null"] },
                operating_income: { type: ["number", "null"] },
                net_income: { type: ["number", "null"] },
              },
            },
            balance_sheet: {
              type: "object",
              properties: {
                total_assets: { type: ["number", "null"] },
                total_liabilities: { type: ["number", "null"] },
                total_equity: { type: ["number", "null"] },
              },
            },
            cash_flow: {
              type: "object",
              properties: {
                operating_cash_flow: { type: ["number", "null"] },
                capital_expenditure: { type: ["number", "null"] },
                free_cash_flow: { type: ["number", "null"] },
              },
            },
          },
        },
        yoy_changes: {
          type: "object",
          properties: {
            revenue_pct: { type: ["number", "null"] },
            net_income_pct: { type: ["number", "null"] },
          },
        },
      },
      required: [
        "company",
        "cik",
        "currency",
        "period",
        "filing_type",
        "filed_at",
        "financials",
      ],
    },
  },
  {
    name: "get_financials_comparison",
    description:
      "Compare a specific financial metric across multiple US public companies in one call. Useful for competitive analysis and benchmarking.",
    inputSchema: {
      type: "object",
      properties: {
        tickers: {
          type: "array",
          items: { type: "string" },
          description: "Array of tickers e.g. ['AAPL', 'MSFT', 'GOOGL']",
        },
        metric: {
          type: "string",
          enum: [
            "revenue",
            "gross_profit",
            "operating_income",
            "net_income",
            "total_assets",
            "total_liabilities",
            "total_equity",
            "operating_cash_flow",
            "free_cash_flow",
          ],
          description: "The financial metric to compare across all companies",
        },
      },
      required: ["tickers", "metric"],
    },
    outputSchema: {
      type: "object",
      properties: {
        metric: { type: "string" },
        results: {
          type: "array",
          items: {
            type: "object",
            properties: {
              ticker: { type: "string" },
              company: { type: "string" },
              cik: { type: "string" },
              period: { type: "string" },
              filing_type: { type: "string" },
              filed_at: { type: "string" },
              currency: { type: "string" },
              metric: { type: "string" },
              value: { type: ["number", "null"] },
              yoy_pct: { type: ["number", "null"] },
              error: { type: "string" },
            },
            required: ["ticker"],
          },
        },
      },
      required: ["metric", "results"],
    },
  },
];

app.post("/mcp", async (req: Request, res: Response) => {
  try {
    const server = new Server(
      { name: "multisource-financial-statements", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS,
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      if (name === "get_financials") {
        const ticker = (args?.ticker as string).toUpperCase();
        const formType = (args?.formType as string) ?? "10-K";
        const cacheKey = `financials:${ticker}:${formType}`;

        const cached = await getCache(cacheKey);
        if (cached) {
          return {
            content: [{ type: "text", text: JSON.stringify(cached, null, 2) }],
            structuredContent: cached,
          };
        }

        const rawData = await fetchFinancialReport(ticker);
        const normalized = normalizeEDGARData(rawData, formType);
        await setCache(cacheKey, normalized, 86400);

        return {
          content: [
            { type: "text", text: JSON.stringify(normalized, null, 2) },
          ],
          structuredContent: normalized,
        };
      }

      if (name === "get_financials_comparison") {
        const tickers = args?.tickers as string[];
        const metric = args?.metric as string;

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
            cik: data.cik,
            period: data.period,
            filing_type: data.filing_type,
            filed_at: data.filed_at,
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

        const output = { metric, results: comparison };

        return {
          content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
          structuredContent: output,
        };
      }

      throw new Error(`Unknown tool: ${name}`);
    });

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
