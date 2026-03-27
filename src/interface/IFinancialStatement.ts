export interface FinancialStatement {
  company: string;
  cik: string;
  currency: string;
  period: string;
  filing_type: string;
  filed_at: string;
  data_note?: string;
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

export interface JobStats {
  startedAt: string;
  completedAt: string | null;
  total: number;
  succeeded: number;
  failed: number;
  failedTickers: string[];
}
