import YahooFinance from "yahoo-finance2";

const yahooFinance = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const test = async () => {
  const result = await yahooFinance.quoteSummary("TSCO.L", {
    modules: [
      "incomeStatementHistory",
      "cashflowStatementHistory",
      "financialData",
      "defaultKeyStatistics",
    ],
  });

  console.log(JSON.stringify(result, null, 2));
};

test().catch(console.error);
