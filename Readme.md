# Multi-Source Financial Statements MCP Tool

An MCP tool that delivers normalized financial statements from SEC EDGAR at $0.10 per query. Replaces Bloomberg Terminal ($24,000/yr), FactSet ($12,000/yr), and Capital IQ ($20,000/yr) for basic financial statement analysis.

## What it does

Takes a company ticker, fetches the latest 10-K or 10-Q filing from SEC EDGAR, and returns a normalized JSON response with balance sheet, income statement, and cash flow data.

## Tools

### get_financials

Returns full financial statements for a single US public company.

**Parameters:**

- `ticker` (required) — stock ticker e.g. `AAPL`, `MSFT`, `TSLA`
- `formType` (optional) — `10-K` for annual, `10-Q` for quarterly. Defaults to `10-K`

### get_financials_comparison

Compares a specific financial metric across multiple companies in one call.

**Parameters:**

- `tickers` (required) — array of tickers e.g. `["AAPL", "MSFT", "GOOGL"]`
- `metric` (required) — one of: `revenue`, `gross_profit`, `operating_income`, `net_income`, `total_assets`, `total_liabilities`, `total_equity`, `operating_cash_flow`, `free_cash_flow`

## Stack

- Node.js + Express
- SEC EDGAR public API
- Upstash Redis (caching)
- Deployed on Render

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## Environment Variables

```
REDIS_URL=your_redis_url
PORT=5000
```

## MCP Endpoint

```
POST /mcp
```
