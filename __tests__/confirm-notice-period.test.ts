/**
 * Regression test for the notice_period_days parseInt NaN guard.
 *
 * The guard lives at app/api/confirm/route.ts:74-75.
 * This test locks the behaviour: NaN and null inputs must produce null,
 * never a NaN number that would corrupt buildAlerts().
 */

// Exact logic from confirm/route.ts — keep in sync if that changes.
function parseNoticePeriodDays(raw: unknown): number | null {
  if (raw == null) return null;
  const parsed = parseInt(String(raw), 10);
  return !isNaN(parsed) ? parsed : null;
}

describe("parseNoticePeriodDays (confirm route NaN guard)", () => {
  it("returns null for null input", () => {
    expect(parseNoticePeriodDays(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseNoticePeriodDays(undefined)).toBeNull();
  });

  it("returns null for non-numeric string", () => {
    expect(parseNoticePeriodDays("not-a-number")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseNoticePeriodDays("")).toBeNull();
  });

  it("parses valid integer string", () => {
    expect(parseNoticePeriodDays("30")).toBe(30);
  });

  it("parses numeric value", () => {
    expect(parseNoticePeriodDays(90)).toBe(90);
  });

  it("parses integer prefix of mixed string (parseInt behaviour)", () => {
    // parseInt("30 days") === 30 — acceptable, documents known behaviour
    expect(parseNoticePeriodDays("30 days")).toBe(30);
  });

  it("never returns NaN for any input", () => {
    const inputs: unknown[] = [null, undefined, "", "abc", NaN, {}, []];
    for (const input of inputs) {
      const result = parseNoticePeriodDays(input);
      if (typeof result === "number") {
        expect(isNaN(result)).toBe(false);
      }
    }
  });
});
