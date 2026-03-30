import { FinancialStatement } from "../interface/IFinancialStatement";

const extractNamespacePrefixes = (
  iXBRLContent: string,
): Record<string, string> => {
  const prefixMap: Record<string, string> = {};
  const xmlnsRegex = /xmlns:([^=]+)="([^"]+)"/g;
  let match;
  while ((match = xmlnsRegex.exec(iXBRLContent)) !== null) {
    const prefix = match[1].trim();
    const namespace = match[2].trim();
    prefixMap[prefix] = namespace;
  }
  return prefixMap;
};

const buildTaxonomyMap = (
  prefixMap: Record<string, string>,
): Record<string, string> => {
  const taxonomyMap: Record<string, string> = {};

  for (const [prefix, namespace] of Object.entries(prefixMap)) {
    if (
      namespace.includes("xbrl.frc.org.uk/fr") ||
      namespace.includes("xbrl.frc.org.uk/FRS")
    ) {
      taxonomyMap[`${prefix}:TurnoverRevenue`] = "revenue";
      taxonomyMap[`${prefix}:Turnover`] = "revenue";
      taxonomyMap[`${prefix}:Revenue`] = "revenue";
      taxonomyMap[`${prefix}:GrossProfitLoss`] = "gross_profit";
      taxonomyMap[`${prefix}:GrossProfit`] = "gross_profit";
      taxonomyMap[`${prefix}:OperatingProfitLoss`] = "operating_income";
      taxonomyMap[`${prefix}:ProfitLoss`] = "net_income";
      taxonomyMap[`${prefix}:ProfitLossForPeriod`] = "net_income";
      taxonomyMap[`${prefix}:ProfitLossOnOrdinaryActivitiesAfterTax`] =
        "net_income";
      taxonomyMap[`${prefix}:Assets`] = "total_assets";
      taxonomyMap[`${prefix}:TotalAssetsLessCurrentLiabilities`] =
        "total_assets";
      taxonomyMap[`${prefix}:Liabilities`] = "total_liabilities";
      taxonomyMap[`${prefix}:Creditors`] = "total_liabilities";
      taxonomyMap[`${prefix}:Equity`] = "total_equity";
      taxonomyMap[`${prefix}:NetAssetsLiabilities`] = "total_equity";
      taxonomyMap[`${prefix}:NetCashGeneratedFromOperations`] =
        "operating_cash_flow";
      taxonomyMap[`${prefix}:NetCashFlowsFromOperatingActivities`] =
        "operating_cash_flow";
      taxonomyMap[`${prefix}:PurchaseOfPropertyPlantEquipment`] =
        "capital_expenditure";
    }

    if (
      namespace.includes("xbrl.ifrs.org") ||
      namespace.includes("ifrs-full")
    ) {
      taxonomyMap[`${prefix}:Revenue`] = "revenue";
      taxonomyMap[`${prefix}:RevenueFromContractsWithCustomers`] = "revenue";
      taxonomyMap[`${prefix}:GrossProfit`] = "gross_profit";
      taxonomyMap[`${prefix}:ProfitLossFromOperatingActivities`] =
        "operating_income";
      taxonomyMap[`${prefix}:ProfitLoss`] = "net_income";
      taxonomyMap[`${prefix}:Assets`] = "total_assets";
      taxonomyMap[`${prefix}:Liabilities`] = "total_liabilities";
      taxonomyMap[`${prefix}:Equity`] = "total_equity";
      taxonomyMap[`${prefix}:CashFlowsFromUsedInOperatingActivities`] =
        "operating_cash_flow";
      taxonomyMap[`${prefix}:PurchaseOfPropertyPlantAndEquipment`] =
        "capital_expenditure";
    }

    if (namespace.includes("uk-gaap") || namespace.includes("ukGAAP")) {
      taxonomyMap[`${prefix}:TurnoverGrossOperatingRevenue`] = "revenue";
      taxonomyMap[`${prefix}:Turnover`] = "revenue";
      taxonomyMap[`${prefix}:GrossProfitLoss`] = "gross_profit";
      taxonomyMap[`${prefix}:OperatingProfitLoss`] = "operating_income";
      taxonomyMap[`${prefix}:ProfitLossForPeriod`] = "net_income";
      taxonomyMap[`${prefix}:Assets`] = "total_assets";
      taxonomyMap[`${prefix}:Liabilities`] = "total_liabilities";
      taxonomyMap[`${prefix}:Equity`] = "total_equity";
      taxonomyMap[`${prefix}:NetCashInflowsFromOperations`] =
        "operating_cash_flow";
      taxonomyMap[`${prefix}:PurchaseOfPropertyPlantEquipment`] =
        "capital_expenditure";
    }
  }

  return taxonomyMap;
};

const extractXBRLValues = (iXBRLContent: string): Record<string, number> => {
  const values: Record<string, number> = {};
  const prefixMap = extractNamespacePrefixes(iXBRLContent);
  const taxonomyMap = buildTaxonomyMap(prefixMap);

  const regex = /<ix:nonFraction([^>]*)>([\s\S]*?)<\/ix:nonFraction>/gi;
  let match;
  let tagCount = 0;

  while ((match = regex.exec(iXBRLContent)) !== null) {
    tagCount++;
    const attributes = match[1];
    const rawContent = match[2];

    const nameMatch = attributes.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const tagName = nameMatch[1];

    const contextMatch = attributes.match(/contextRef="([^"]+)"/);
    if (!contextMatch) continue;
    const contextRef = contextMatch[1];

    const scaleMatch = attributes.match(/scale="([^"]+)"/);
    const scale = scaleMatch ? Math.pow(10, parseInt(scaleMatch[1])) : 1;

    const signMatch = attributes.match(/sign="([^"]+)"/);
    const sign = signMatch && signMatch[1] === "-" ? -1 : 1;

    const rawValue = rawContent
      .replace(/<[^>]+>/g, "")
      .replace(/,/g, "")
      .replace(/\s/g, "")
      .trim();

    const value = parseFloat(rawValue);
    if (isNaN(value)) continue;

    const canonicalField = taxonomyMap[tagName];
    if (!canonicalField) continue;

    const isPriorYear =
      contextRef.toLowerCase().includes("prior") ||
      contextRef.toLowerCase().includes("prev") ||
      contextRef.toLowerCase().includes("comparative");

    if (!values[canonicalField] && !isPriorYear) {
      values[canonicalField] = value * scale * sign;
    }
  }

  return values;
};

const normalizeCompaniesHouseData = (
  profile: any,
  iXBRLContent: string,
  filedAt: string,
): FinancialStatement => {
  const values = extractXBRLValues(iXBRLContent);

  const operatingCashFlow = values["operating_cash_flow"] ?? null;
  const capitalExpenditure = values["capital_expenditure"] ?? null;
  const freeCashFlow =
    operatingCashFlow != null && capitalExpenditure != null
      ? operatingCashFlow - capitalExpenditure
      : null;

  const filingYear = new Date(filedAt).getFullYear();
  const currentYear = new Date().getFullYear();
  const isStale = currentYear - filingYear > 1;

  return {
    company: profile?.company_name ?? "Unknown",
    ticker: profile?.company_number ?? "", // Companies House number used as identifier
    currency: "GBP",
    period_end: filedAt ?? "",
    data_type: "official_filing",
    filing_type: "Annual Accounts",
    filed_at: filedAt ?? null,
    data_note: isStale
      ? "Most recent structured iXBRL filing available. This company may have switched to PDF-only filing for more recent accounts."
      : undefined,
    financials: {
      income_statement: {
        revenue: values["revenue"] ?? null,
        gross_profit: values["gross_profit"] ?? null,
        operating_income: values["operating_income"] ?? null,
        net_income: values["net_income"] ?? null,
      },
      balance_sheet: {
        total_assets: values["total_assets"] ?? null,
        total_liabilities: values["total_liabilities"] ?? null,
        total_equity: values["total_equity"] ?? null,
      },
      cash_flow: {
        operating_cash_flow: operatingCashFlow,
        capital_expenditure: capitalExpenditure,
        free_cash_flow: freeCashFlow,
      },
    },
    yoy_changes: {
      revenue_pct: null,
      net_income_pct: null,
    },
  };
};

const normalizeYahooFinanceData = (
  ticker: string,
  rawData: any,
): FinancialStatement => {
  const values = JSON.parse(rawData.iXBRLContent);

  const nullIfZero = (v: number | null): number | null => (v === 0 ? null : v);

  const revenue = nullIfZero(values.revenue ?? null);
  const grossProfit = nullIfZero(values.gross_profit ?? null);
  const operatingIncome = nullIfZero(values.operating_income ?? null);
  const netIncome = nullIfZero(values.net_income ?? null);
  const totalAssets = nullIfZero(values.total_assets ?? null);
  const totalLiabilities = nullIfZero(values.total_liabilities ?? null);
  const totalEquity = nullIfZero(values.total_equity ?? null);
  const operatingCashFlow = nullIfZero(values.operating_cash_flow ?? null);
  const capitalExpenditure = nullIfZero(values.capital_expenditure ?? null);
  const freeCashFlow =
    operatingCashFlow != null && capitalExpenditure != null
      ? operatingCashFlow - capitalExpenditure
      : nullIfZero(values.free_cash_flow ?? null);

  const revenuePct = values.revenue_pct ?? null;
  const netIncomePct = values.net_income_pct ?? null;

  const yoyNotes: string[] = [];
  if (revenuePct != null && Math.abs(revenuePct) > 50) {
    yoyNotes.push(
      `Revenue YoY change is unusually large (${revenuePct}%) — verify against source.`,
    );
  }
  if (netIncomePct != null && Math.abs(netIncomePct) > 50) {
    yoyNotes.push(
      `Net income YoY change is unusually large (${netIncomePct}%) — verify against source.`,
    );
  }

  const dataNotes = [
    "filed_at reflects period end date, not actual filing date.",
    ...yoyNotes,
  ].join(" ");

  return {
    company: rawData.company,
    ticker,
    currency: rawData.currency ?? "GBP",
    period_end: rawData.filedAt ?? "",
    data_type: "estimated",
    filing_type: "Annual Accounts",
    filed_at: rawData.filedAt ?? null,
    data_note: dataNotes || undefined,
    financials: {
      income_statement: {
        revenue,
        gross_profit: grossProfit,
        operating_income: operatingIncome,
        net_income: netIncome,
      },
      balance_sheet: {
        total_assets: totalAssets,
        total_liabilities: totalLiabilities,
        total_equity: totalEquity,
      },
      cash_flow: {
        operating_cash_flow: operatingCashFlow,
        capital_expenditure: capitalExpenditure,
        free_cash_flow: freeCashFlow,
      },
    },
    yoy_changes: {
      revenue_pct: revenuePct,
      net_income_pct: netIncomePct,
    },
  };
};

export { normalizeCompaniesHouseData, normalizeYahooFinanceData };
