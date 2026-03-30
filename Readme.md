# Multi-Source Financial Statements MCP Tool

An MCP tool that delivers normalized financial statements for US and UK public companies from SEC EDGAR, Companies House, and Yahoo Finance,at a fraction of the cost of Bloomberg Terminal ($24,000/yr), FactSet ($12,000/yr), or Capital IQ ($20,000/yr).

## What it does

Pass a US stock ticker, UK company registration number, or LSE ticker and get back a normalized JSON response with balance sheet, income statement, cash flow data, and YoY changes — auto-routed to the right data source.

## Data Sources

- **SEC EDGAR** — US public companies via 10-K and 10-Q filings
- **Companies House iXBRL** — UK private and SME companies via structured digital filings
- **Yahoo Finance fallback** — UK listed companies (FTSE 100, FTSE 250, AIM) that only file scanned PDFs on Companies House

## Tools

### get_financials

Returns full financial statements for a single US or UK company.

**Parameters:**

- `ticker` (required) — US stock ticker (e.g. `AAPL`), UK company number (e.g. `08130873`), or LSE ticker (e.g. `TSCO.L`)
- `formType` (optional) — `10-K` for annual, `10-Q` for quarterly. US only, defaults to `10-K`
- `yahooTicker` (optional) — LSE Yahoo Finance ticker to use as fallback if UK company number returns scanned PDF only (e.g. `TSCO.L` for Tesco)

### get_financials_comparison

Compares a specific financial metric across multiple US companies in one call.

**Parameters:**

- `tickers` (required) — array of tickers e.g. `["AAPL", "MSFT", "GOOGL"]`
- `metric` (required) — one of: `revenue`, `gross_profit`, `operating_income`, `net_income`, `total_assets`, `total_liabilities`, `total_equity`, `operating_cash_flow`, `free_cash_flow`

## Known Working Examples

| Company  | Identifier            | Source                          |
| -------- | --------------------- | ------------------------------- |
| Apple    | `AAPL`                | SEC EDGAR                       |
| Tesla    | `TSLA`                | SEC EDGAR                       |
| Gymshark | `08130873`            | Companies House iXBRL           |
| Tesco    | `00445790` + `TSCO.L` | Companies House + Yahoo Finance |
| Unilever | `00041424` + `ULVR.L` | Companies House + Yahoo Finance |
| BP       | `BP.L`                | Yahoo Finance                   |
| GSK      | `GSK.L`               | Yahoo Finance                   |

## Stack

- Node.js + TypeScript + Express
- SEC EDGAR public API
- Companies House public API
- Yahoo Finance via yahoo-finance2
- Redis caching
- MCP SDK

## Setup

```
npm install
cp .env.example .env
npm run dev
```

## Environment Variables

```
COMPANIES_HOUSE_API_KEY=
REDIS_URL=
PORT=5000
```

## MCP Endpoint

```
POST /mcp
```
