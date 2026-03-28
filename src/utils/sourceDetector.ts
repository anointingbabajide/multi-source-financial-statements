type DataSource = "SEC_EDGAR" | "COMPANIES_HOUSE" | "YAHOO_FINANCE" | "UNKNOWN";

const detectSource = (identifier: string): DataSource => {
  // UK company number: 8 digits or starts with SC, NI, OC
  if (/^(SC|NI|OC)?\d{6,8}$/.test(identifier)) {
    return "COMPANIES_HOUSE";
  }

  // Yahoo Finance ticker: contains a dot e.g. TSCO.L, ULVR.L, BP.L
  if (/^[A-Z0-9]+\.[A-Z]+$/.test(identifier)) {
    return "YAHOO_FINANCE";
  }

  // US ticker: 1-5 uppercase letters only e.g. AAPL, MSFT
  if (/^[A-Z]{1,5}$/.test(identifier)) {
    return "SEC_EDGAR";
  }

  return "UNKNOWN";
};

export { detectSource, DataSource };
