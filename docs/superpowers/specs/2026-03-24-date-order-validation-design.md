# Date Order Validation — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

AI extraction can produce dates in illogical order (e.g. expiry before effective). Rather than blocking the user or auto-correcting — which could discard a correct extraction — we surface warnings inline on the review screen and log anomalies server-side for prompt-tuning observability.

## Validation Rules

The correct relationship is `effective_date < renewal_date ≤ expiry_date`, with nulls allowed for any field.

| Condition | Severity | Affected field | Message |
|-----------|----------|----------------|---------|
| `effective_date >= expiry_date` (both present) | **red** | `expiry_date` | "Expiry date is before or same as effective date — please check" |
| `renewal_date > expiry_date` (both present) | **amber** | `renewal_date` | "Renewal date is after expiry date — please check" |
| `effective_date >= renewal_date` (both present) | **amber** | `renewal_date` | "Renewal date is before or same as effective date — please check" |

**Severity rationale:**
- `effective_date >= expiry_date` is red — a contract that ends before it starts is almost certainly an extraction error.
- Renewal date anomalies are amber — unusual but could legitimately be a pre-negotiated renewal for a successor contract.
- `renewal_date == expiry_date` is valid and must never warn (the most common auto-renew case).
- Any rule where either operand is null is skipped entirely.

**Important:** Warnings never block confirmation. The user can confirm with warnings present.

## Components

### 1. `lib/utils.ts` — `validateDateOrder()`

New exported type and function, alongside the existing `isExpired()`:

```typescript
export type DateWarning = {
  field: 'effective_date' | 'renewal_date' | 'expiry_date';
  message: string;
  severity: 'amber' | 'red';
};

export function validateDateOrder(dates: {
  effective_date?: string | null;
  renewal_date?: string | null;
  expiry_date?: string | null;
}): DateWarning[]
```

- Dates are parsed to `Date` objects via `new Date(iso + "T00:00:00")` (local midnight, matching the `isExpired` pattern) before comparison — not compared as strings.
- The `effective_date >= expiry_date` rule uses `>=` (not `>`), so a same-day effective/expiry (zero-duration contract) is also red.
- Returns an empty array when no violations are found.
- Safe to call with all-null input (returns `[]`).

### 2. `components/review/field-panel.tsx`

- On each render, compute `warnings = validateDateOrder(currentDateValues)` from the current `resolutions` state.
- To get the correct value per date field, mirror the `handleConfirm` resolution logic: use `resolutions[fn].value` when `resolutions[fn].isResolved` is true; otherwise fall back to `row?.confirmed_value ?? row?.extracted_value ?? null`. This ensures the validated value matches exactly what will be submitted — particularly for fields pre-resolved in the DB where `isResolved` starts as `false`.
- Pass the matching `DateWarning | undefined` to the `FieldRow` for each date field via a new optional `warning` prop.
- No changes to the Confirm button disable logic — warnings are advisory only.

### 3. `components/review/field-row.tsx`

- Accept a new optional `warning?: DateWarning` prop.
- When present, render a small inline note below the field value using existing amber/red colour tokens:
  - amber: `#F59E0B`
  - red: `#EF4444`
- Visual style matches the existing confidence colour coding pattern.

### 4. `app/api/confirm/route.ts`

- After the contracts table update succeeds, call `validateDateOrder()` with the confirmed date values (`f.effective_date`, `f.renewal_date`, `f.expiry_date`, coerced to strings/null via the existing `coerceDate` helper).
- If `warnings.length > 0`, insert a **second** `activity_log` row (in addition to the existing `contract_confirmed` row — not a replacement):
  ```json
  {
    "event_type": "date_order_warning",
    "user_id": "<userId>",
    "contract_id": "<contract_id>",
    "metadata": { "warnings": [...] }
  }
  ```
- Proceed with normal confirm flow regardless of warnings — no HTTP error, no blocking.

## Data Flow

```
User edits date field
  → FieldPanel recomputes validateDateOrder()
  → FieldRow receives warning prop
  → Inline amber/red note appears next to field

User clicks "Confirm & activate alerts"
  → /api/confirm receives fields
  → validateDateOrder() called server-side
  → If warnings: activity_log row inserted (event_type: date_order_warning)
  → Contract confirmed normally
```

## What is NOT in scope

- Hard blocking confirmation on date order errors
- Auto-correcting dates
- Modifying the extraction (Python) service
- Database schema changes
- New API endpoints

## Testing

- Unit tests for `validateDateOrder()` covering: all-null input, single-rule violations, multiple violations, `renewal_date == expiry_date` (no warning — most common auto-renew case), `effective_date == expiry_date` (same-day → red, verifying `>=` not `>`), missing renewal date with valid effective/expiry.
- Tests for `FieldRow` rendering with a `warning` prop present.
- Tests for `/api/confirm` logging to `activity_log` when warnings are present.
