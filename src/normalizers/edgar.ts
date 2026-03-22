import { FinancialStatement } from "../interface/IFinancialStatement";
import { calculateYoY, extractTwoLatestValues } from "../utils/math";

const normalizeEDGARData = (
  rawData: any,
  formType: string = "10-K",
): FinancialStatement => {
  const facts = rawData?.facts;

  const [revenueOld, previousRevenueOld] = extractTwoLatestValues(
    facts,
    "Revenues",
    formType,
  );

  const [revenueNew, previousRevenueNew] = extractTwoLatestValues(
    facts,
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    formType,
  );

  const revenue =
    !revenueOld ||
    (revenueNew && new Date(revenueNew.end) > new Date(revenueOld.end))
      ? revenueNew
      : revenueOld;

  const previousRevenue =
    !previousRevenueOld ||
    (previousRevenueNew &&
      new Date(previousRevenueNew.end) > new Date(previousRevenueOld.end))
      ? previousRevenueNew
      : previousRevenueOld;
  const [netIncome, previousNetIncome] = extractTwoLatestValues(
    facts,
    "NetIncomeLoss",
    formType,
  );

  const [grossProfit] = extractTwoLatestValues(facts, "GrossProfit", formType);

  const [operatingIncome] = extractTwoLatestValues(
    facts,
    "OperatingIncomeLoss",
    formType,
  );

  const [totalAssets] = extractTwoLatestValues(facts, "Assets", formType);

  const [totalLiabilities] = extractTwoLatestValues(
    facts,
    "Liabilities",
    formType,
  );

  const [totalEquity] =
    extractTwoLatestValues(facts, "StockholdersEquity", formType)[0] !== null
      ? extractTwoLatestValues(facts, "StockholdersEquity", formType)
      : extractTwoLatestValues(
          facts,
          "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
          formType,
        );

  const [operatingCashFlow] = extractTwoLatestValues(
    facts,
    "NetCashProvidedByUsedInOperatingActivities",
    formType,
  );

  const [capEx] = extractTwoLatestValues(
    facts,
    "PaymentsToAcquirePropertyPlantAndEquipment",
    formType,
  );

  const freeCashFlow =
    operatingCashFlow && capEx ? operatingCashFlow.val - capEx.val : null;

  return {
    company: rawData?.entityName ?? "Unknown",
    cik: String(rawData?.cik ?? ""),
    currency: "USD",
    period: revenue?.end ?? "",
    filing_type: formType,
    filed_at: revenue?.filed ?? "",
    financials: {
      income_statement: {
        revenue: revenue?.val ?? null,
        gross_profit: grossProfit?.val ?? null,
        operating_income: operatingIncome?.val ?? null,
        net_income: netIncome?.val ?? null,
      },
      balance_sheet: {
        total_assets: totalAssets?.val ?? null,
        total_liabilities: totalLiabilities?.val ?? null,
        total_equity: totalEquity?.val ?? null,
      },
      cash_flow: {
        operating_cash_flow: operatingCashFlow?.val ?? null,
        capital_expenditure: capEx?.val ?? null,
        free_cash_flow: freeCashFlow,
      },
    },
    yoy_changes: {
      revenue_pct: calculateYoY(
        revenue?.val ?? null,
        previousRevenue?.val ?? null,
      ),
      net_income_pct: calculateYoY(
        netIncome?.val ?? null,
        previousNetIncome?.val ?? null,
      ),
    },
  };
};

export { normalizeEDGARData, FinancialStatement };
