## Status

**Last verified:** 2026-03-24
**Build status:** Completed

`FieldRow` uses `<input type="date">` for `effective_date`, `renewal_date`, `expiry_date`. `stripDate()` helper strips T-suffix. All 7 tests pass (3 warning + 4 date picker).

---

# Date Picker for Contract Date Fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text input with a native `<input type="date">` for the three date fields (`effective_date`, `renewal_date`, `expiry_date`) on the contract review screen.

**Architecture:** Single file change to `components/review/field-row.tsx`. Add a `DATE_FIELDS` constant, a `stripDate` helper that strips any `T`-suffix from ISO strings, and switch the edit input to `type="date"` with `colorScheme: "dark"`. Apply the strip guard in all three places where a date value is written to `draft` or passed to `onResolve`. No new dependencies, no API changes.

**Tech Stack:** React (Next.js 14 App Router), TypeScript, inline styles, Jest + React Testing Library

---

## File Map

| File | Change |
|------|--------|
| `components/review/field-row.tsx` | Add `DATE_FIELDS`, `stripDate`, swap input type, apply strip guard |
| `__tests__/components/review/field-row.test.tsx` | Add 4 new tests for date picker behaviour |

---

## Task 1: Date picker input + tests

This is a single cohesive change — all in one file, committed together after tests pass.

**Files:**
- Modify: `components/review/field-row.tsx`
- Modify: `__tests__/components/review/field-row.test.tsx`

---

- [ ] **Step 1: Write the failing tests**

Open `__tests__/components/review/field-row.test.tsx` and add a new `describe` block after the existing `"FieldRow warning prop"` describe block:

```typescript
import userEvent from "@testing-library/user-event";

describe("FieldRow date picker", () => {
  test("date field renders <input type='date'>", () => {
    render(
      <FieldRow
        {...baseProps}
        fieldName="effective_date"
        label="Effective date"
        extractedValue="2025-01-01"
        resolution={{ value: null, isResolved: false }}
        isManual={true}
      />
    );
    const input = screen.getByDisplayValue("2025-01-01");
    expect(input).toHaveAttribute("type", "date");
  });

  test("T-suffix is stripped — input shows YYYY-MM-DD not blank", () => {
    render(
      <FieldRow
        {...baseProps}
        fieldName="expiry_date"
        label="Expiry date"
        extractedValue="2026-06-15T00:00:00"
        resolution={{ value: null, isResolved: false }}
        isManual={true}
      />
    );
    const input = screen.getByDisplayValue("2026-06-15");
    expect(input).toHaveAttribute("type", "date");
  });

  test("non-date field still renders <input type='text'>", () => {
    render(
      <FieldRow
        {...baseProps}
        fieldName="party_a"
        label="Party A"
        extractedValue="Acme Corp"
        resolution={{ value: null, isResolved: false }}
        isManual={true}
      />
    );
    const input = screen.getByDisplayValue("Acme Corp");
    expect(input).toHaveAttribute("type", "text");
  });

  test("re-entry path: T-suffix stripped after dismiss and re-open", async () => {
    const user = userEvent.setup();
    render(
      <FieldRow
        {...baseProps}
        fieldName="renewal_date"
        label="Renewal date"
        extractedValue="2027-03-01T00:00:00"
        resolution={{ value: null, isResolved: false }}
        isManual={false}
        confidence={0.95}
      />
    );

    // Should start in display mode (green/high-confidence, not pre-expanded)
    // Click the edit (✎) button to enter edit mode
    const editButton = screen.getByRole("button", { name: "✎" });
    await user.click(editButton);

    // Now in edit mode — input should show stripped date
    const input = screen.getByDisplayValue("2027-03-01");
    expect(input).toHaveAttribute("type", "date");
  });
});
```

**Note:** `@testing-library/user-event` is already installed (it ships with `@testing-library/react`). If the import fails, check `package.json` — it may need `npm install @testing-library/user-event`.

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest __tests__/components/review/field-row.test.tsx --no-coverage
```

Expected: the 4 new tests fail (input type is `"text"`, not `"date"`; value is blank because `T` suffix isn't stripped).

- [ ] **Step 3: Implement the changes in `field-row.tsx`**

Make the following changes to `/Users/dmitrygolovach/code/renewl/components/review/field-row.tsx`:

**3a. Add `DATE_FIELDS` constant and `stripDate` helper after the `FieldName` type (line ~11):**

```typescript
const DATE_FIELDS = ["effective_date", "renewal_date", "expiry_date"] as const;

/** Strip any time component from an ISO string so <input type="date"> doesn't go blank. */
function stripDate(value: string): string {
  return value.split("T")[0];
}
```

**3b. Compute `isDateField` and update `draft` initial state (line ~61) to strip T-suffix for date fields:**

`displayVal` is defined _after_ the `useState` calls so it can't be used as the initial value. Use the same resolution logic inline — `color` is already computed above the `useState` calls:

Change:
```typescript
const [draft, setDraft] = useState<string>(resolution.value ?? "");
```

To:
```typescript
const isDateField = DATE_FIELDS.includes(fieldName as typeof DATE_FIELDS[number]);
// Mirror displayVal logic: resolved value → confirmed (blue) → extracted
const initialDraftValue = resolution.isResolved
  ? resolution.value
  : (color === "blue" ? confirmedValue : extractedValue);
const [draft, setDraft] = useState<string>(
  isDateField && initialDraftValue ? stripDate(initialDraftValue) : (initialDraftValue ?? "")
);
```

**3c. Update the Edit button `onClick` (line ~120) to strip T-suffix:**

Change:
```typescript
onClick={() => { setDraft(displayVal ?? ""); setEditing(true); }}
```

To:
```typescript
onClick={() => {
  const raw = displayVal ?? "";
  setDraft(isDateField ? stripDate(raw) : raw);
  setEditing(true);
}}
```

**3d. In the editing block (line ~130), replace the `auto_renew` / text-input branch with a three-way branch:**

Change:
```typescript
{fieldName === "auto_renew" ? (
  <select ... />
) : (
  <input
    type="text"
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    placeholder="Enter value…"
    style={inputStyle}
  />
)}
```

To:
```typescript
{fieldName === "auto_renew" ? (
  <select
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    style={{ ...inputStyle, cursor: "pointer" }}
  >
    <option value="">— select —</option>
    <option value="true">Yes</option>
    <option value="false">No</option>
  </select>
) : isDateField ? (
  <input
    type="date"
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    style={{ ...inputStyle, colorScheme: "dark" } as React.CSSProperties & { colorScheme: string }}
  />
) : (
  <input
    type="text"
    value={draft}
    onChange={(e) => setDraft(e.target.value)}
    placeholder="Enter value…"
    style={inputStyle}
  />
)}
```

Note: `colorScheme` is typed in modern `@types/react`. The cast `as React.CSSProperties` handles older versions that don't include it yet. No separate `backgroundColor` override is needed — the existing `inputStyle.background` already styles the input itself; `colorScheme: "dark"` handles the calendar popup.

**3e. Update the "Looks good" button `onClick` (line ~158) to strip T-suffix for date fields:**

Change:
```typescript
onClick={() => { onResolve(extractedValue); setEditing(false); }}
```

To:
```typescript
onClick={() => {
  const val = isDateField && extractedValue ? stripDate(extractedValue) : extractedValue;
  onResolve(val);
  setEditing(false);
}}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest __tests__/components/review/field-row.test.tsx --no-coverage
```

Expected: all 7 tests pass (3 existing warning tests + 4 new date picker tests).

- [ ] **Step 5: TypeScript check**

```bash
cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Full test suite**

```bash
cd /Users/dmitrygolovach/code/renewl && npx jest --no-coverage
```

Expected: 86 passing (same as before), 0 regressions.

- [ ] **Step 7: Commit**

```bash
cd /Users/dmitrygolovach/code/renewl && git add components/review/field-row.tsx __tests__/components/review/field-row.test.tsx && git commit -m "feat: native date picker for date fields with dark theme support"
```
