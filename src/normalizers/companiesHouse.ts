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

    // IFRS taxonomy
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

    // UK GAAP older taxonomy
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

  // // DEBUG
  // console.log("Taxonomy map size:", Object.keys(taxonomyMap).length);
  // console.log("Sample taxonomy keys:", Object.keys(taxonomyMap).slice(0, 10));

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

    // DEBUG
    // if (tagCount <= 10) {
    //   console.log(
    //     `Tag: ${tagName}, Context: ${contextRef}, RawValue: "${rawValue}", ParsedValue: ${value}, Scale: ${scale}`,
    //   );
    //   console.log(`  → Canonical: ${taxonomyMap[tagName] ?? "NOT MAPPED"}`);
    // }

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

  // console.log("Total tags found:", tagCount);
  // console.log("Final extracted values:", values);

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
    operatingCashFlow && capitalExpenditure
      ? operatingCashFlow - capitalExpenditure
      : null;

  return {
    company: profile?.company_name ?? "Unknown",
    cik: profile?.company_number ?? "",
    currency: "GBP",
    period: filedAt ?? "",
    filing_type: "Annual Accounts",
    filed_at: filedAt ?? "",
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

export { normalizeCompaniesHouseData };
