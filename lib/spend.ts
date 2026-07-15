// lib/spend.ts

export function extractNumericValue(raw: string | null): number | null {
  if (!raw) return null;
  // Match the first number in the string (supports commas and decimals)
  // Using only the first number avoids concatenating multiple digit groups
  // e.g. "GBP 4,200 PER MONTH (GBP 50,400 PER ANNUM)" → 4200, not 420050400
  const match = raw.match(/[\d,]+\.?\d*/);
  if (!match) return null;
  const n = parseFloat(match[0].replace(/,/g, ''));
  if (isNaN(n) || n === 0) return null;
  // Normalise monthly → annual
  const lower = raw.toLowerCase();
  if (lower.includes('/month') || lower.includes('/mo') || lower.includes(' pm') || lower.includes('per month')) {
    return n * 12;
  }
  return n;
}
