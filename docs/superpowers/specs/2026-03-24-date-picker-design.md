# Date Picker for Contract Date Fields — Design Spec

**Date:** 2026-03-24
**Status:** Approved

## Overview

The three date fields on the contract review screen (`effective_date`, `renewal_date`, `expiry_date`) currently use `<input type="text">`. Replacing them with `<input type="date">` gives users a native calendar picker, which is simpler and less error-prone than free-text ISO entry.

## Approach

Native `<input type="date">`. No new dependencies. `colorScheme: "dark"` makes the browser render the calendar popup in dark mode, matching the existing dark UI.

**Why not a library (react-datepicker, etc.):**
The users are ops/finance people on desktop Chrome/Edge/Firefox — native pickers are clean and familiar on those browsers. A custom library would add a dependency, require dark-theme CSS, and solve problems (positioning, z-index, portal rendering) that the browser already handles.

## Component Change

**File:** `components/review/field-row.tsx`

### What changes

1. Add a `DATE_FIELDS` constant **after** the `FieldName` type export (values must be assignable to `FieldName`):

```typescript
const DATE_FIELDS = ["effective_date", "renewal_date", "expiry_date"] as const;
```

2. In the editing block, the current branch is:
```
auto_renew → <select>
otherwise  → <input type="text">
```

Change to:
```
date field → <input type="date">
auto_renew → <select>
otherwise  → <input type="text">
```

3. The `<input type="date">` uses the existing `inputStyle` plus:
```typescript
colorScheme: "dark"   // renders the calendar popup in dark mode
```

4. **Draft value guard:** `<input type="date">` requires exactly `YYYY-MM-DD` — a `T` suffix causes the input to render blank. Apply `.split("T")[0]` in **all three places** where `draft` is set from an external value for date fields:
   - `useState` initialisation (initial load)
   - The Edit button's `onClick` re-seeder: `setDraft(displayVal ?? "")` → `setDraft((displayVal ?? "").split("T")[0])`
   - The "Looks good" button calls `onResolve(extractedValue)` directly, bypassing `draft`. For date fields it must strip the suffix: `onResolve(extractedValue.split("T")[0])`

5. **`placeholder` attribute:** Drop `placeholder="Enter value…"` from the date input — native date inputs ignore `placeholder` on most browsers and show their own format hint (e.g. `mm/dd/yyyy`).

6. **TypeScript:** `colorScheme` is typed in `React.CSSProperties` in modern `@types/react`. If the project's installed version does not include it, cast the style object as `React.CSSProperties & { colorScheme: string }` or use an inline style override.

### What does NOT change

- The collapsed (non-editing) display — shows the ISO date string as-is, same as today
- `FieldPanel` — no changes
- `app/api/confirm/route.ts` — no changes; values are still submitted as ISO strings
- `lib/utils.ts` — no changes
- Database schema — no changes
- No new npm packages

## Data Flow

```
AI extraction returns ISO 8601 string (e.g. "2025-01-01" or "2025-01-01T00:00:00")
  → draft initialised: value.split("T")[0]  → "2025-01-01"
  → <input type="date" value="2025-01-01" />
  → User picks a date from the calendar
  → draft updates to "2026-06-15"
  → User clicks Save → onResolve("2026-06-15")
  → FieldPanel sends ISO string to /api/confirm as before
```

## Testing

- When `fieldName` is a date field, the rendered input has `type="date"`
- When `fieldName` is a date field with a `T`-suffixed extracted value (`"2025-01-01T00:00:00"`), the input's value is `"2025-01-01"` (not blank)
- When non-date field (`party_a`, `contract_value`, etc.), input renders `type="text"`
- Re-entry path: render a date field with a `T`-suffixed value, dismiss edit mode, click Edit again — the input's value is still `YYYY-MM-DD` (not blank)

## What is NOT in scope

- Changing how dates are displayed in the collapsed view
- Date range pickers
- Locale-aware date formatting in display
- Mobile-specific behaviour
