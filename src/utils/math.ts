const extractTwoLatestValues = (
  facts: any,
  tag: string,
  formType: string = "10-K",
): [
  { val: number; end: string; filed: string } | null,
  { val: number; end: string; filed: string } | null,
] => {
  try {
    const tagData = facts?.["us-gaap"]?.[tag]?.["units"]?.["USD"];
    if (!tagData) return [null, null];

    const filtered = tagData.filter((entry: any) => entry.form === formType);
    if (filtered.length === 0) return [null, null];

    const sorted = filtered.sort(
      (a: any, b: any) => new Date(b.end).getTime() - new Date(a.end).getTime(),
    );

    const deduplicated = sorted.filter(
      (entry: any, index: number, self: any[]) =>
        index === self.findIndex((e: any) => e.end === entry.end),
    );

    return [deduplicated[0] ?? null, deduplicated[1] ?? null];
  } catch {
    return [null, null];
  }
};

const calculateYoY = (
  current: number | null,
  previous: number | null,
): number | null => {
  if (!current || !previous || previous === 0) return null;
  return parseFloat(
    (((current - previous) / Math.abs(previous)) * 100).toFixed(2),
  );
};

export { extractTwoLatestValues, calculateYoY };
