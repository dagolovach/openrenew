## Status

**Last verified:** 2026-03-24
**Build status:** Completed

`validateDateOrder()` and `DateWarning` type are in `lib/utils.ts`. `FieldRow` renders inline warnings. `FieldPanel` computes and passes warnings. `/api/confirm` logs `date_order_warning` events to `activity_log`. All tests pass.

---

# Date Order Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface inline amber/red warnings on the review screen when AI-extracted contract dates are in an illogical order, and log anomalies server-side for extraction quality observability.

**Architecture:** A pure `validateDateOrder()` utility in `lib/utils.ts` is called on every render of `FieldPanel` to compute per-field warnings, which are passed down to `FieldRow` for inline display. The same function is called server-side in `/api/confirm` to insert an `activity_log` row when violations are present. Warnings are advisory — they never block confirmation.

**Tech Stack:** TypeScript, Next.js 14 App Router, Jest, React Testing Library

---

## File Map

| File | Change |
|------|--------|
| `lib/utils.ts` | Add `DateWarning` type + `validateDateOrder()` function |
| `__tests__/lib/utils.test.ts` | New — unit tests for `validateDateOrder()` |
| `components/review/field-row.tsx` | Add optional `warning?: DateWarning` prop + inline render |
| `components/review/field-panel.tsx` | Compute warnings each render, pass to `FieldRow` |
| `app/api/confirm/route.ts` | Call `validateDateOrder()` post-update, log to `activity_log` |
| `__tests__/api/confirm.test.ts` | Add test: date order warning is logged when violations present |

---

## Task 1: `validateDateOrder()` utility + unit tests

**Files:**
- Create: `__tests__/lib/utils.test.ts`
- Modify: `lib/utils.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/utils.test.ts`:

```typescript
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
    expect(validateDateOrder({ effective_date: "2025-01-01", expiry_date: "2026-01-01" })).toEqual([]);
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
      renewal_date: "2026-01-01",
      expiry_date: "2026-01-01",
    })).toEqual([]);
  });

  test("returns amber renewal_date warning when renewal_date > expiry_date", () => {
    const warnings = validateDateOrder({
      effective_date: "2025-01-01",
      renewal_date: "2027-01-01",
      expiry_date: "2026-01-01",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("renewal_date");
    expect(warnings[0].severity).toBe("amber");
  });

  test("returns amber renewal_date warning when effective_date > renewal_date", () => {
    const warnings = validateDateOrder({
      effective_date: "2025-06-01",
      renewal_date: "2025-01-01",
      expiry_date: "2026-01-01",
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].field).toBe("renewal_date");
    expect(warnings[0].severity).toBe("amber");
  });

  test("returns amber renewal_date warning when effective_date == renewal_date", () => {
    const warnings = validateDateOrder({
      effective_date: "2025-01-01",
      renewal_date: "2025-01-01",
      expiry_date: "2026-01-01",
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
    expect(validateDateOrder({ effective_date: "2025-01-01", renewal_date: null, expiry_date: "2026-01-01" })).toEqual([]);
  });

  test("each warning has a non-empty message string", () => {
    const warnings = validateDateOrder({ effective_date: "2026-01-01", expiry_date: "2025-01-01" });
    expect(warnings[0].message).toBeTruthy();
    expect(typeof warnings[0].message).toBe("string");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest __tests__/lib/utils.test.ts --no-coverage
```

Expected: `validateDateOrder is not a function` or similar import error.

- [ ] **Step 3: Add `DateWarning` type and `validateDateOrder()` to `lib/utils.ts`**

Add after the existing `formatExpiredDate` function:

```typescript
export type DateWarning = {
  field: 'effective_date' | 'renewal_date' | 'expiry_date';
  message: string;
  severity: 'amber' | 'red';
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

  const parse = (iso: string) => new Date(iso + "T00:00:00");

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
      message: "Renewal date is after expiry date — please check",
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

  return warnings;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest __tests__/lib/utils.test.ts --no-coverage
```

Expected: all tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/dmitrygolovach/code/renewl && git add lib/utils.ts __tests__/lib/utils.test.ts && git commit -m "feat: add validateDateOrder utility with unit tests"
```

---

## Task 2: `FieldRow` — accept and render `warning` prop

**Files:**
- Modify: `components/review/field-row.tsx`

No new test file needed here — the warning rendering will be covered by the `FieldPanel` integration in Task 3.

- [ ] **Step 1: Add `warning` prop to `FieldRow`**

In `components/review/field-row.tsx`, import `DateWarning` and add `warning` to the Props type:

```typescript
// Add to import at top of file
import type { DateWarning } from "@/lib/utils";
```

Change the `Props` type (around line 12) to add:
```typescript
  warning?: DateWarning;
```

Change the function signature (line 53) to destructure `warning`:
```typescript
export default function FieldRow({ fieldName, label, hint, extractedValue, confidence, wasEdited, confirmedValue, resolution, onResolve, isManual, warning }: Props) {
```

- [ ] **Step 2: Render the warning inline below the field content**

Add this block just before the closing `</div>` of the outer container (after the `!editing` / `editing` conditional block, before the final `</div>`):

```typescript
      {warning && (
        <div style={{
          fontSize: "11px",
          color: warning.severity === "red" ? "#FCA5A5" : "#FCD34D",
          marginTop: "6px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}>
          <span>⚠</span>
          {warning.message}
        </div>
      )}
```

- [ ] **Step 3: Verify TypeScript compiles with no errors**

```bash
cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/dmitrygolovach/code/renewl && git add components/review/field-row.tsx && git commit -m "feat: FieldRow accepts optional warning prop for date order violations"
```

---

## Task 3: `FieldPanel` — compute warnings and pass to date `FieldRow`s

**Files:**
- Modify: `components/review/field-panel.tsx`

- [ ] **Step 1: Import `validateDateOrder` in `FieldPanel`**

Add to the imports at the top of `components/review/field-panel.tsx`:

```typescript
import { validateDateOrder } from "@/lib/utils";
import type { DateWarning } from "@/lib/utils";
```

- [ ] **Step 2: Compute warnings on each render**

In `FieldPanel`, the date fields are `effective_date`, `renewal_date`, and `expiry_date`. Add this block inside the component body, after the `resolutions` state declaration and before the `return`:

```typescript
  // Compute the effective value for a date field — mirrors handleConfirm resolution logic
  function getDateValue(fn: "effective_date" | "renewal_date" | "expiry_date"): string | null {
    const row = extractions.find((e) => e.field_name === fn);
    if (resolutions[fn].isResolved) return resolutions[fn].value;
    return row?.confirmed_value ?? row?.extracted_value ?? null;
  }

  const dateWarnings = validateDateOrder({
    effective_date: getDateValue("effective_date"),
    renewal_date:   getDateValue("renewal_date"),
    expiry_date:    getDateValue("expiry_date"),
  });

  const warningByField = Object.fromEntries(
    dateWarnings.map((w) => [w.field, w])
  ) as Partial<Record<"effective_date" | "renewal_date" | "expiry_date", DateWarning>>;
```

- [ ] **Step 3: Pass `warning` prop to `FieldRow` for date fields**

In the `FIELD_ORDER.map(...)` render (around line 154), update the `FieldRow` call to pass the warning:

```typescript
      {FIELD_ORDER.map(({ name: fn, label, hint }) => {
        const row = extractions.find((e) => e.field_name === fn);
        const isDateField = fn === "effective_date" || fn === "renewal_date" || fn === "expiry_date";
        return (
          <FieldRow key={fn} fieldName={fn} label={label} hint={hint}
            extractedValue={row?.extracted_value ?? null}
            confidence={row?.confidence ?? 0}
            wasEdited={row?.was_edited ?? false}
            confirmedValue={row?.confirmed_value ?? null}
            resolution={resolutions[fn]}
            onResolve={(v) => resolve(fn, v)}
            isManual={isManual}
            warning={isDateField ? warningByField[fn as "effective_date" | "renewal_date" | "expiry_date"] : undefined}
          />
        );
      })}
```

- [ ] **Step 4: TypeScript check**

```bash
cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run full test suite to confirm nothing is broken**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest --no-coverage
```

Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/dmitrygolovach/code/renewl && git add components/review/field-panel.tsx && git commit -m "feat: FieldPanel computes date order warnings and passes to FieldRow"
```

---

## Task 4: `/api/confirm` — log date order warnings to `activity_log`

**Files:**
- Modify: `app/api/confirm/route.ts`
- Modify: `__tests__/api/confirm.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe("POST /api/confirm", ...)` block in `__tests__/api/confirm.test.ts`:

```typescript
  test("logs date_order_warning to activity_log when dates are out of order", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const chain = makeChain({ id: "c1", status: "review", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
    mockFrom.mockReturnValue(chain);

    // effective_date > expiry_date — should trigger a red warning
    const badFields = {
      ...validFields,
      effective_date: "2026-01-01",
      expiry_date: "2025-01-01",
    };
    const res = await POST(makeReq({ contract_id: "c1", name: "My Contract", category: "saas", fields: badFields }));
    expect(res.status).toBe(200);

    // Find the date_order_warning insert call
    const insertCalls = chain.insert.mock.calls;
    const warningInsert = insertCalls.find((call: unknown[]) => {
      const arg = call[0] as { event_type?: string };
      return arg?.event_type === "date_order_warning";
    });
    expect(warningInsert).toBeDefined();
    expect(warningInsert[0].metadata.warnings).toHaveLength(1);
    expect(warningInsert[0].metadata.warnings[0].field).toBe("expiry_date");
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest __tests__/api/confirm.test.ts --no-coverage
```

Expected: the new test fails (no warning insert found).

- [ ] **Step 3: Add `validateDateOrder` call to `/api/confirm`**

In `app/api/confirm/route.ts`, add the import at the top:

```typescript
import { validateDateOrder } from "@/lib/utils";
```

Then, after the existing `activity_log` insert for `contract_confirmed` (around line 126), add:

```typescript
  // Log date order anomalies for extraction quality observability
  const dateWarnings = validateDateOrder({
    effective_date: coerceDate(f.effective_date),
    renewal_date:   coerceDate(f.renewal_date),
    expiry_date:    coerceDate(f.expiry_date),
  });
  if (dateWarnings.length > 0) {
    await sessionClient.from("activity_log").insert({
      user_id: userId,
      contract_id,
      event_type: "date_order_warning",
      metadata: { warnings: dateWarnings },
    });
  }
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest --no-coverage
```

Expected: all tests pass including the new one.

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/dmitrygolovach/code/renewl && git add app/api/confirm/route.ts __tests__/api/confirm.test.ts && git commit -m "feat: log date order warnings to activity_log on contract confirm"
```
