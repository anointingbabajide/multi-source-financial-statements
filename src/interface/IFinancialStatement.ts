export interface FinancialStatement {
  company: string;
  ticker: string;
  currency: string;
  period_end: string;
  data_type: "official_filing" | "estimated" | "mixed";
  filing_type?: string;
  filed_at?: string | null;
  data_note?: string;
  confidence_score?: number; // 0.0–1.0
  financials: {
    income_statement: {
      revenue: number | null;
      gross_profit: number | null;
      operating_income: number | null;
      net_income: number | null;
    };
    balance_sheet: {
      total_assets: number | null;
      total_liabilities: number | null;
      total_equity: number | null;
    };
    cash_flow: {
      operating_cash_flow: number | null;
      capital_expenditure: number | null;
      free_cash_flow: number | null;
    };
  };
  yoy_changes: {
    revenue_pct: number | null;
    net_income_pct: number | null;
  };
}

export interface FinancialResponse {
  success: boolean;
  source: "sec_edgar" | "companies_house" | "yahoo_finance";
  data: FinancialStatement;
}

export interface JobStats {
  startedAt: string;
  completedAt: string | null;
  total: number;
  succeeded: number;
  failed: number;
  failedTickers: string[];
}
