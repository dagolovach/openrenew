# Expired Contract Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show an amber inline warning on the `expiry_date` field when a contract being reviewed has already expired.

**Architecture:** Add one new rule to `validateDateOrder()` in `lib/utils.ts` (after the existing three rules). No other files need changing — the warning display infrastructure in `field-panel.tsx` and `FieldRow` already handles amber warnings on `expiry_date`.

**Tech Stack:** TypeScript, Jest (via `npm test`)

---

## File Map

| File | Change |
|------|--------|
| `lib/utils.ts` | Add Rule 4 inside `validateDateOrder()` after line 132 (before `return warnings`) |
| `__tests__/lib/utils.test.ts` | Add a `describe("past-expiry warning")` block with 10 test cases |

---

### Task 1: Write failing tests for the past-expiry warning rule

**Files:**
- Modify: `__tests__/lib/utils.test.ts`

- [ ] **Step 1: Open the test file and add the new `describe` block at the end, inside the outer `describe("validateDateOrder")`**

The existing file ends at line 94 with `});`. Insert the new block before that closing `});`:

```ts
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
        message:  "Renewal date is after expiry date — please check",
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
```

- [ ] **Step 2: Run the new tests to confirm they all fail**

```bash
npm test -- --testPathPattern="__tests__/lib/utils.test.ts" --verbose 2>&1 | tail -30
```

Expected: 10 failures in the `past-expiry warning` describe block. All failures should say something like "expected array to contain equal..." — confirming the rule doesn't exist yet.

---

### Task 2: Implement Rule 4 in `validateDateOrder`

**Files:**
- Modify: `lib/utils.ts:132` (after the third existing rule, before `return warnings`)

- [ ] **Step 3: Add the new rule after line 132 in `lib/utils.ts`**

Insert between the closing `}` of Rule 3 (line 132) and `return warnings` (line 134):

```ts
  // Rule 4: expiry_date is in the past and no future renewal_date covers it
  // Uses same midnight-normalisation pattern as isExpired() — today is NOT expired (strict <)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
```

**Why this placement:** `noRedOnExpiry` must be evaluated after Rules 1–3 have run. Adding this rule last guarantees the suppression check sees all existing red warnings.

- [ ] **Step 4: Run all tests to confirm they pass**

```bash
npm test -- --testPathPattern="__tests__/lib/utils.test.ts" --verbose 2>&1 | tail -30
```

Expected: all tests in the file pass (existing 12 + new 10 = 22 total). Zero failures.

- [ ] **Step 5: Commit**

```bash
git add lib/utils.ts __tests__/lib/utils.test.ts
git commit -m "feat: warn on review screen when contract has already expired"
```

---

## Done

The warning will now appear inline on the `expiry_date` field on the review screen whenever the extracted expiry date is in the past and no future renewal date makes the contract still active. No UI, routing, or API changes are needed.
