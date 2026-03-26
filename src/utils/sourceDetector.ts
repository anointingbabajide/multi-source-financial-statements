type DataSource = "SEC_EDGAR" | "COMPANIES_HOUSE" | "UNKNOWN";

const detectSource = (identifier: string): DataSource => {
  // US ticker: 1-5 uppercase letters only e.g. AAPL, MSFT
  if (/^[A-Z]{1,5}$/.test(identifier)) {
    return "SEC_EDGAR";
  }

  // UK company number: 8 digits or starts with SC, NI, OC
  if (/^(SC|NI|OC)?\d{6,8}$/.test(identifier)) {
    return "COMPANIES_HOUSE";
  }

  return "UNKNOWN";
};

export { detectSource, DataSource };
