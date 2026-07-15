# Expired Contract Warning on Review Screen

**Date:** 2026-03-24
**Status:** Approved

## Problem

When a user uploads a contract that has already expired, the review screen shows no indication of this. The user can confirm the contract without any awareness that the expiry date is in the past. Expired contracts are valid to save (historical records), but the user should be informed.

## Solution

Extend `validateDateOrder()` in `lib/utils.ts` with one new rule: if `expiry_date` is in the past (and not superseded by a future `renewal_date`), emit an amber warning on the `expiry_date` field. The existing warning infrastructure (`DateWarning` type, `warningByField` map, `FieldRow` warning prop) handles display with no further changes.

## Design

### Rule

```
if expiry_date < today
   AND (renewal_date is null OR renewal_date < today)
   AND no red warning already targets expiry_date
→ amber warning on "expiry_date"
  message: "This contract has already expired — confirm to save for historical records"
```

**Conditions explained:**

- **`expiry_date < today`** — strict `<` (not `<=`) to match `isExpired()` semantics — a contract expiring today is NOT expired.
- **`renewal_date` suppression** — if `renewal_date` is in the future, the contract has auto-renewed and is still active. Emitting "already expired" in that case is a misleading false positive. Suppress the warning when `renewal_date >= today`. This condition mirrors `isExpired()` in `lib/utils.ts`: a renewal date of today means `renewal < today` is false, so the contract is not expired — hence suppression fires for today too (see test case "renewal today").
- **Red-warning suppression** — `warningByField` in `field-panel.tsx` is a last-write-wins map keyed on field name. The suppression check is applied entirely inside `validateDateOrder` (not in `field-panel.tsx`): skip the push when any red warning already targets `expiry_date`. Implement by checking `warnings.some(w => w.field === "expiry_date" && w.severity === "red")` before pushing. This suppression is intentional for **any** current or future red rule on `expiry_date`. **Invariant:** the new rule must remain the last rule added to `validateDateOrder` — if a future red rule on `expiry_date` is inserted *after* the new rule, the suppression will silently fail. Two amber warnings on the same field do not require suppression; no existing rule emits an amber on `expiry_date` today, so last-write-wins between two ambers cannot currently occur.
- **Severity: amber** — informational, not an error. Saving historical contracts is valid.
- Warning is advisory and never blocks confirmation, consistent with all other date warnings.
- **"Today" computation** — use `const today = new Date(); today.setHours(0, 0, 0, 0)` — the same pattern as `isExpired()` in `lib/utils.ts`. Do not pass a string to the existing `parse()` helper; `parse()` takes an ISO date string and cannot be used for the current date.

### Rule ordering in `validateDateOrder`

Add the new rule **after** the existing three rules so the red-warning suppression check is accurate.

### Files changed

| File | Change |
|------|--------|
| `lib/utils.ts` | Add past-expiry rule inside `validateDateOrder()` after existing rules |
| `__tests__/lib/utils.test.ts` | Add test cases for past-expiry warning |

### No changes needed

- `DateWarning` type — already supports `"expiry_date"` field and `"amber"` severity
- `components/review/field-panel.tsx` — already passes `warningByField` warnings to `FieldRow`
- `components/review/field-row.tsx` — already renders amber/red warnings inline
- `/api/confirm` route — warnings are UI-only; confirmation is never blocked

## Testing

**Computing dynamic dates in tests** — use runtime ISO string construction; do not hardcode today's date:
```ts
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const future = "2099-12-31"; // safe static far-future date
```

New test cases in `__tests__/lib/utils.test.ts`:

| Case | Input | Expected |
|------|-------|----------|
| Past expiry, no renewal | `expiry_date: "2023-12-31"` | amber warning `{ field: "expiry_date", severity: "amber", message: "This contract has already expired — confirm to save for historical records" }` |
| Past expiry, no effective date | `effective_date: null`, `expiry_date: "2023-12-31"` | same amber warning (most common real-world case — contracts often lack an effective date) |
| Expiry today | `expiry_date: <today>` | no past-expiry warning (strict `<`) |
| Expiry in future | `expiry_date: <tomorrow>` | no past-expiry warning |
| Past expiry, future renewal | `expiry_date: "2023-12-31"`, `renewal_date: <future>` | no past-expiry warning (contract auto-renewed) |
| Past expiry, renewal today | `expiry_date: "2023-12-31"`, `renewal_date: <today>` | no past-expiry warning (`renewal_date >= today` suppresses; contract considered still active) |
| Past expiry, past renewal — same date | `expiry_date: "2023-12-31"`, `renewal_date: "2023-12-31"` | amber warning on `expiry_date` (both dates past; no future renewal suppresses) |
| Past expiry, past renewal — renewal after expiry | `effective_date: null`, `expiry_date: "2023-12-31"`, `renewal_date: "2024-06-01"` | two warnings: Rule 2 amber on `renewal_date` + new amber on `expiry_date`. `effective_date: null` is load-bearing — a non-null effective_date before renewal_date would still yield two warnings, but one before renewal_date would not trigger Rule 3; an effective_date after renewal_date would add a third. |
| Null expiry | `expiry_date: null` | no warning (rule skipped) |
| Red already on expiry_date | `effective_date: "2024-01-01"`, `expiry_date: "2023-12-31"` | one warning: existing red on `expiry_date`; amber suppressed by `warnings.some(w => w.field === "expiry_date" && w.severity === "red")` check |

New test cases must assert the full `{ field, severity, message }` shape. Existing test cases in the file need not be retrofitted.
