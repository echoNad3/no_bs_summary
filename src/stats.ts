/**
 * Tiny statistics helpers. Percentiles use the "nearest rank" method:
 * sort the values, then take the value at position ceil(p% × count).
 * With very small samples the numbers are still computed the same way —
 * the report always states the sample size so nobody over-trusts them.
 */

export function median(values: number[]): number | undefined {
  return percentile(values, 50);
}

export function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function max(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.max(...values);
}
