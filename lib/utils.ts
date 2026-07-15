// lib/utils.ts

export type ContractDates = {
  expiry_date: string | null;
  renewal_date: string | null;
};

/**
 * A contract is expired when expiry_date is in the past AND
 * renewal_date is absent or also in the past.
 * A contract with a future renewal_date is still active (auto-renewed).
 *
 * Dates are parsed as UTC midnight (T00:00:00Z) to match alert scheduling in alerts.ts.
 */
export function isExpired(contract: ContractDates): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  if (!contract.expiry_date) return false;

  const expiry = new Date(contract.expiry_date + "T00:00:00Z");
  const renewal = contract.renewal_date
    ? new Date(contract.renewal_date + "T00:00:00Z")
    : null;

  const expiryPast = expiry < today;
  // Note: a contract expiring today is NOT considered expired (strict <)
  // "past or absent" — true when renewal is either missing or also expired.
  // A future renewal_date means the contract auto-renewed and is still active.
  const renewalPastOrAbsent = !renewal || renewal < today;

  return expiryPast && renewalPastOrAbsent;
}

/**
 * Days from today until the given ISO date string.
 * Negative when date is in the past.
 * Parses as UTC midnight (T00:00:00Z).
 */
export function daysUntil(iso: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.ceil(
    (new Date(iso + "T00:00:00Z").getTime() - today.getTime()) / 86400000
  );
}

/**
 * Returns the effective "days until" date for a contract that is not expired.
 * For auto-renewed contracts where expiry_date is in the past but renewal_date
 * is in the future, use renewal_date for day calculations.
 * Returns null if no relevant date is present.
 */
export function activeExpiryDate(contract: ContractDates): string | null {
  if (!contract.expiry_date) return contract.renewal_date;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const expiry = new Date(contract.expiry_date + "T00:00:00Z");

  // If expiry is in the past but renewal is in the future, use renewal
  if (expiry < today && contract.renewal_date) {
    const renewal = new Date(contract.renewal_date + "T00:00:00Z");
    if (renewal >= today) return contract.renewal_date;
  }

  return contract.expiry_date;
}

/**
 * Format a date as "14 Mar 2024" (en-GB short).
 */
export function formatExpiredDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export type DateWarning = {
  field: "effective_date" | "renewal_date" | "expiry_date";
  message: string;
  severity: "amber" | "red";
};

/**
 * Validates that contract dates are in a logical order.
 * Rules (skipped when either operand is null):
 *   - effective_date >= expiry_date → red on expiry_date
 *   - renewal_date > expiry_date    → amber on renewal_date
 *   - effective_date >= renewal_date → amber on renewal_date
 *
 * renewal_date == expiry_date is valid (common auto-renew case) — never warns.
 * Warnings are advisory; they never block confirmation.
 */
export function validateDateOrder(dates: {
  effective_date?: string | null;
  renewal_date?: string | null;
  expiry_date?: string | null;
}): DateWarning[] {
  const warnings: DateWarning[] = [];

  const parse = (iso: string) => new Date(iso + "T00:00:00Z");

  const eff = dates.effective_date ? parse(dates.effective_date) : null;
  const exp = dates.expiry_date   ? parse(dates.expiry_date)    : null;
  const ren = dates.renewal_date  ? parse(dates.renewal_date)   : null;

  if (eff && exp && eff >= exp) {
    warnings.push({
      field: "expiry_date",
      message: "Expiry date is before or same as effective date — please check",
      severity: "red",
    });
  }

  if (ren && exp && ren > exp) {
    warnings.push({
      field: "renewal_date",
      message: "Renewal date is after expiry date — typical for auto-renew contracts. Confirm if correct.",
      severity: "amber",
    });
  }

  if (eff && ren && eff >= ren) {
    warnings.push({
      field: "renewal_date",
      message: "Renewal date is before or same as effective date — please check",
      severity: "amber",
    });
  }

  // Rule 4: expiry_date is in the past and no future renewal_date covers it
  // Uses same midnight-normalisation pattern as isExpired() — today is NOT expired (strict <)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const noRedOnExpiry = !warnings.some(
    (w) => w.field === "expiry_date" && w.severity === "red"
  );
  if (exp && exp < today && noRedOnExpiry) {
    const renewalSuppresses = ren !== null && ren >= today;
    if (!renewalSuppresses) {
      warnings.push({
        field:    "expiry_date",
        message:  "This contract has already expired — confirm to save for historical records",
        severity: "amber",
      });
    }
  }

  return warnings;
}
