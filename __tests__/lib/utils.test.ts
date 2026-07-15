import { validateDateOrder } from "@/lib/utils";

describe("validateDateOrder", () => {
  test("returns [] when all dates are null", () => {
    expect(validateDateOrder({})).toEqual([]);
    expect(validateDateOrder({ effective_date: null, renewal_date: null, expiry_date: null })).toEqual([]);
  });

  test("returns [] when only effective_date is present", () => {
    expect(validateDateOrder({ effective_date: "2025-01-01" })).toEqual([]);
  });

  test("returns [] when effective_date < expiry_date (no renewal)", () => {
    expect(validateDateOrder({ effective_date: "2025-01-01", expiry_date: "2099-01-01" })).toEqual([]);
  });

  test("returns red expiry_date warning when effective_date > expiry_date", () => {
    const warnings = validateDateOrder({ effective_date: "2026-01-01", expiry_date: "2025-01-01" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("expiry_date");
    expect(warnings[0].severity).toBe("red");
  });

  test("returns red expiry_date warning when effective_date == expiry_date (same day)", () => {
    const warnings = validateDateOrder({ effective_date: "2025-06-01", expiry_date: "2025-06-01" });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("expiry_date");
    expect(warnings[0].severity).toBe("red");
  });

  test("returns [] when renewal_date == expiry_date (common auto-renew case)", () => {
    expect(validateDateOrder({
      effective_date: "2025-01-01",
      renewal_date: "2099-01-01",
      expiry_date: "2099-01-01",
    })).toEqual([]);
  });

  test("returns amber renewal_date warning when renewal_date > expiry_date", () => {
    const warnings = validateDateOrder({
      effective_date: "2025-01-01",
      renewal_date: "2100-01-01",
      expiry_date: "2099-01-01",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("renewal_date");
    expect(warnings[0].severity).toBe("amber");
  });

  test("returns amber renewal_date warning when effective_date > renewal_date", () => {
    const warnings = validateDateOrder({
      effective_date: "2098-06-01",
      renewal_date: "2098-01-01",
      expiry_date: "2099-01-01",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("renewal_date");
    expect(warnings[0].severity).toBe("amber");
  });

  test("returns amber renewal_date warning when effective_date == renewal_date", () => {
    const warnings = validateDateOrder({
      effective_date: "2098-01-01",
      renewal_date: "2098-01-01",
      expiry_date: "2099-01-01",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("renewal_date");
    expect(warnings[0].severity).toBe("amber");
  });

  test("returns multiple warnings when multiple violations present", () => {
    // effective after expiry, AND renewal after expiry
    const warnings = validateDateOrder({
      effective_date: "2026-06-01",
      renewal_date: "2027-01-01",
      expiry_date: "2025-01-01",
    });
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    const fields = warnings.map((w) => w.field);
    expect(fields).toContain("expiry_date");
    expect(fields).toContain("renewal_date");
  });

  test("skips rules when renewal_date is null", () => {
    expect(validateDateOrder({ effective_date: "2025-01-01", renewal_date: null, expiry_date: "2099-01-01" })).toEqual([]);
  });

  test("each warning has a non-empty message string", () => {
    const warnings = validateDateOrder({ effective_date: "2026-01-01", expiry_date: "2025-01-01" });
    expect(warnings[0].message).toBeTruthy();
    expect(typeof warnings[0].message).toBe("string");
  });

  describe("past-expiry warning", () => {
    const today    = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const future   = "2099-12-31";
    const PAST_EXPIRY_WARNING = {
      field:    "expiry_date" as const,
      severity: "amber"       as const,
      message:  "This contract has already expired — confirm to save for historical records",
    };

    test("emits amber warning when expiry_date is in the past", () => {
      const warnings = validateDateOrder({ expiry_date: "2023-12-31" });
      expect(warnings).toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("emits amber warning when expiry_date is past and effective_date is null (common case)", () => {
      const warnings = validateDateOrder({ effective_date: null, expiry_date: "2023-12-31" });
      expect(warnings).toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("does NOT emit warning when expiry_date is today (strict <)", () => {
      const warnings = validateDateOrder({ expiry_date: today });
      expect(warnings).not.toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("does NOT emit warning when expiry_date is in the future", () => {
      const warnings = validateDateOrder({ expiry_date: tomorrow });
      expect(warnings).not.toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("does NOT emit warning when renewal_date is in the future (auto-renewed)", () => {
      const warnings = validateDateOrder({ expiry_date: "2023-12-31", renewal_date: future });
      expect(warnings).not.toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("does NOT emit warning when renewal_date is today (contract still active)", () => {
      const warnings = validateDateOrder({ expiry_date: "2023-12-31", renewal_date: today });
      expect(warnings).not.toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("emits warning when expiry_date and renewal_date are the same past date", () => {
      const warnings = validateDateOrder({ expiry_date: "2023-12-31", renewal_date: "2023-12-31" });
      expect(warnings).toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("emits two warnings when expiry is past and renewal is past-but-after-expiry", () => {
      // effective_date: null is load-bearing — avoids triggering Rule 3 (eff >= ren)
      const warnings = validateDateOrder({
        effective_date: null,
        expiry_date:    "2023-12-31",
        renewal_date:   "2024-06-01",
      });
      expect(warnings).toHaveLength(2);
      expect(warnings).toContainEqual(PAST_EXPIRY_WARNING);
      expect(warnings).toContainEqual({
        field:    "renewal_date",
        severity: "amber",
        message:  "Renewal date is after expiry date — typical for auto-renew contracts. Confirm if correct.",
      });
    });

    test("does NOT emit warning when expiry_date is null", () => {
      const warnings = validateDateOrder({ expiry_date: null });
      expect(warnings).not.toContainEqual(PAST_EXPIRY_WARNING);
    });

    test("does NOT emit amber when a red warning already targets expiry_date", () => {
      // effective_date > expiry_date triggers Rule 1 red on expiry_date — amber must be suppressed
      const warnings = validateDateOrder({ effective_date: "2024-01-01", expiry_date: "2023-12-31" });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({ field: "expiry_date", severity: "red" });
      expect(warnings).not.toContainEqual(PAST_EXPIRY_WARNING);
    });
  });
});

