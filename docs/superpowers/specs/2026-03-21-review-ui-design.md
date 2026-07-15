# Review UI Design Spec
**Date:** 2026-03-21
**Week:** 2 of the Renewl 30-day build plan

---

## Overview

Week 2 delivers the full human-in-the-loop review flow: upload a contract PDF, watch extraction happen in real time on the dashboard, confirm or correct AI-extracted fields on the review screen, and activate alerts. This is the core product loop.

---

## 1. Pages & Routes

### New pages

| Route | Type | Purpose |
|---|---|---|
| `/dashboard` | Server + client | Contract list with upload zone. Replaces current stub. |
| `/dashboard/review/[id]` | Server + client | Side-by-side PDF viewer + fields review panel |

### New API routes

| Route | Method | Purpose |
|---|---|---|
| `/api/upload` | POST | Validate file, store in Supabase Storage, create contract row, return `contract_id` |
| `/api/confirm` | POST | Write confirmed values, update contract, pre-generate alerts |

### Unchanged

`/api/extract` — unchanged. Accepts `{ contract_id }`, calls Python microservice, writes to `contract_extractions`. No file handling.

---

## 2. Upload Flow

1. User drops PDF onto upload zone (or clicks to browse) → client validates: PDF MIME type only, ≤ 20MB.
2. POST file to `/api/upload`:
   - Server enforces 20MB limit; return `413` with `{ error: "File exceeds 20MB limit" }` if exceeded.
   - Store file at `{user_id}/{contract_id}/original.pdf` in the `contracts` Supabase Storage bucket. (`file_path` stored as `{user_id}/{contract_id}/original.pdf` — bucket name not included in the path string.)
   - Create `contracts` row: `status: 'processing'`, `extraction_status: 'pending'`, `file_path`, `file_name`, `name` (filename minus extension — satisfies NOT NULL constraint; overwritten during confirm), `category: 'other'` (default; overwritten during confirm).
   - Return `{ contract_id }`.
3. Client immediately POSTs `{ contract_id }` to `/api/extract` — **fire and forget** (no `await`).
4. A processing card appears instantly via optimistic state.
5. Client polls the `contracts` row every 3 seconds until `status !== 'processing'`.
   - On change → card transitions to new state.
   - **Timeout:** stop polling after 90 seconds. If status is still `'processing'`, transition card to manual entry state with message: _"Extraction timed out. Enter dates manually."_

### Known limitations (v1)
- If the fire-and-forget POST to `/api/extract` fails to send (network error, cold start), the contract stays `'processing'` until the 90s polling timeout recovers it to manual entry.

---

## 3. Dashboard (`/dashboard`)

### Architecture
- **Server component** renders the initial contract list (SSR).
- **`<UploadZone />`** is a fully isolated client component with its own local state. SSR re-renders must never reset it.
- **`<ContractList />`** is a client component that receives the initial list from SSR and owns polling state. Only this component updates on poll — the upload zone is unaffected.

### Card state precedence

Card state is determined by evaluating conditions in this priority order:

1. If `status === 'confirmed'` → always show a confirmed card (green/amber/red based on days left). Never show manual entry for a confirmed contract.
2. Else if `extraction_status === 'manual'` → show manual entry card.
3. Else if `status === 'processing'` → show processing card.
4. Else if `status === 'review'` AND `extraction_status === 'review'` → show ready-to-review card.

### Card states

| State | Condition (evaluated in precedence order above) | Visual |
|---|---|---|
| **Processing** | `status: 'processing'` | Skeleton/pulse animation, "Extracting dates…" label |
| **Ready to review** | `status: 'review'` AND `extraction_status: 'review'` | Amber border, dynamic label (see below), "Review & confirm →" CTA |
| **Confirmed — green** | `status: 'confirmed'`, days until expiry > 60 | Green border, expiry date, days-left number |
| **Confirmed — amber** | `status: 'confirmed'`, days until expiry > 30 AND ≤ 60 | Amber border, expiry date, days-left number |
| **Confirmed — red** | `status: 'confirmed'`, days until expiry ≤ 30 | Red border, expiry date, days-left number (urgent) |
| **Manual entry** | `extraction_status: 'manual'` AND `status !== 'confirmed'` | Neutral border, contextual message (see below), "Enter dates →" CTA |

**Manual entry message:** Use `"Scanned PDF · Manual entry needed"` if `extraction_status` was set to `'manual'` by the extract route. Use `"Extraction timed out. Enter dates manually."` if set by the 90s polling timeout on the client.

**Dynamic "ready to review" label:**
- Count fields in `contract_extractions` where `field_name != 'confidence'` AND `confidence < 0.90` AND `confirmed_value IS NULL` AND `was_edited = false` (i.e., amber/red fields not yet resolved by any action). The `confidence` row is metadata inserted by `/api/extract` and must be excluded. A field resolved via "Looks good" will have `confirmed_value IS NOT NULL`; a field resolved via "Not applicable" will have `was_edited = true`; both are excluded.
- Fetch this count via an eager join/subquery on the contracts query — do not make a separate per-card request (avoids N+1).
- Label: `"N field(s) need review"` if N > 0, or `"Ready to confirm — looks good"` if N = 0.

**Confirmed card with null expiry_date:** Show `"No expiry set"` in place of the expiry date. Still show days-left number using `renewal_date` if present; otherwise omit the days-left counter entirely.

**Sort order:** Confirmed-red → confirmed-amber → confirmed-green → ready-to-review → processing → manual entry.
- Within confirmed groups: ascending by `expiry_date` (soonest first). Null expiry sorts to end of group.
- Within ready-to-review group: descending by `updated_at` (most recently extracted first, since `expiry_date` may not be confirmed yet).
- Within processing and manual entry groups: descending by `created_at`.

**Urgency thresholds mirror alert tiers (evaluate in this order — red takes priority):**
- ≤ 30 days → red (urgent, notice deadline approaching)
- > 30 AND ≤ 60 days → amber (first alert tier)
- > 60 days → green

---

## 4. Review Screen (`/dashboard/review/[id]`)

### Layout

**Desktop (≥ 768px):** Two fixed-height columns.
- Left: PDF `<iframe>` (full height, Supabase signed URL at 600s expiry).
- Right: scrollable fields panel.
- Default split: 50/50. When overall `extraction_confidence < 0.70`: 60/40 (PDF wider) to emphasise the source document.

**Mobile (< 768px):** Stacked. Fields panel on top, PDF below (collapsed by default, tap to expand).

### PDF signed URL
Generated server-side in the page loader at 600s expiry. If the user spends longer, the iframe shows a Supabase error.
**Known limitation (v1):** no auto-refresh of the signed URL.

### Fields panel — field order

Fields render in this fixed order:

1. Contract name _(editable text input, pre-filled from filename minus extension — not AI-extracted)_
2. Counterparty name
3. Category _(dropdown: saas / lease / vendor / employment / other, default: other — not AI-extracted)_
4. Effective date
5. Expiry date
6. Renewal date
7. Auto renew _(boolean toggle)_
8. Notice period days
9. Notice period text
10. Contract value

Contract name and category are not AI-extracted — always render as editable inputs with neutral styling (no confidence colour, never pre-expanded).

**Valid AI-extracted field names** (used as keys in `contract_extractions.field_name` and in the `/api/confirm` request body `fields` object): `counterparty_name`, `effective_date`, `expiry_date`, `renewal_date`, `auto_renew`, `notice_period_days`, `notice_period_text`, `contract_value`. `name` and `category` are passed as top-level keys in the confirm request, never written to `contract_extractions`.

### Field confidence rendering — page load

On page load, determine each field's render state as follows (in order):

1. If `was_edited = true` OR `confirmed_value IS NOT NULL` in `contract_extractions` → render **blue**, show `confirmed_value`. This handles returning to a partially-reviewed contract — `was_edited = true` covers explicit edits and "Not applicable" (null) resolutions; `confirmed_value IS NOT NULL` covers "Looks good" acceptances (see below).
2. Else if `confidence ≥ 0.90` → render **green**, collapsed, show `extracted_value`.
3. Else if `confidence 0.70–0.89` → render **amber**, pre-expanded.
4. Else (`confidence < 0.70`) → render **red**, pre-expanded. PDF column widens to 60%.

| State | Rendering |
|---|---|
| Green (≥ 0.90) | Collapsed. Value shown, confidence dot, pencil icon to open inline edit. |
| Amber (0.70–0.89) | Pre-expanded on page load. Inline input open with amber ring. |
| Red (< 0.70) | Pre-expanded. Inline input open with red ring. PDF column widens to 60/40. |
| Blue (user-edited, `was_edited=true`) | Collapsed. Shows `confirmed_value`. Pencil icon to re-edit. Overrides confidence colour. |

### Null value handling

| Case | Rendering |
|---|---|
| Null, confidence ≥ 0.90 | Show `"Not found in contract"` as greyed placeholder. Green. Collapsed. No action required. |
| Null, confidence 0.70–0.89 | Pre-expanded amber input. User must enter a value or select "Not applicable." |
| Null, confidence < 0.70 | Pre-expanded red input. User must enter a value or select "Not applicable." |

All nullable fields include a **"Not applicable"** option so users can explicitly confirm a field is absent rather than leaving it null by accident. Selecting "Not applicable" stores `null` as `confirmed_value` and counts as resolving the field.

**Row guarantee:** The `/api/extract` route always inserts one `contract_extractions` row per AI-extracted field (all 9 fields), even when the extracted value is null. The review page can therefore assume a row exists for every field and never needs to handle a missing row case.

### "Confirm all" button

- Label: **"Confirm & activate alerts"**
- A field is **resolved** when the user has explicitly: (a) clicked "Looks good" / accepted the field, (b) edited its value, or (c) selected "Not applicable." Collapsing a field without one of these actions does NOT mark it resolved.
- **Disabled** (greyed, tooltip: _"Resolve highlighted fields first"_) while any amber or red field is unresolved.
- **Enabled** once every field is either green-collapsed (AI confidence ≥ 0.90, no user action needed) or explicitly resolved by the user.
- No confirmation modal. Button label is explicit enough.

### "Looks good" affordance
For amber and red fields (pre-expanded on load), the expanded inline edit area includes a **"Looks good ✓"** button alongside the save/cancel controls. **Only show "Looks good" when `extracted_value IS NOT NULL`.** When `extracted_value IS NULL` (AI found nothing, moderate confidence), replace "Looks good" with "Not applicable" only — do not render a "Looks good" button at all. This prevents a silent unresolvable state: if "Looks good" were allowed on a null field, clicking it would write `null` as `confirmed_value`, but `null IS DISTINCT FROM null` is false so the trigger would not set `was_edited = true`, leaving the field unresolvable on a return visit.

When `extracted_value IS NOT NULL` and the user clicks "Looks good": send `extracted_value` as `confirmed_value` for that field (i.e., the client populates the field value with `extracted_value` before submitting). This sets `confirmed_value IS NOT NULL` in `contract_extractions`, which is what the page-load blue state check (condition 1 above) and the dashboard "fields need review" count use to detect resolution. The client tracks "Looks good" acceptances in local state before the final confirm POST.

### Post-confirm read-only state
If the user navigates to `/dashboard/review/[id]` for a contract with `status === 'confirmed'`, show a **read-only view**: all fields collapsed, no editable inputs, a banner at the top — _"This contract has been confirmed. Alerts are active."_ — with a back link to `/dashboard`. The "Confirm & activate alerts" button is not rendered. This prevents a confusing 409 response from a form that appears functional.

### After confirm
POST to `/api/confirm` → on `{ ok: true }` → redirect to `/dashboard`.

---

## 5. `/api/upload` Route

**Request:** `multipart/form-data` with `file` field.

**Steps:**
1. Auth check — 401 if no session. Extract `user_id = session.user.id`.
2. Validate: PDF MIME type only. Size ≤ 20MB — return `413` with `{ error: "File exceeds 20MB limit" }` if exceeded.
3. Generate `contract_id` (UUID).
4. Upload to Supabase Storage via **admin client** (service role) to avoid edge cases with the storage RLS `foldername` function — the session client would also work given the current policy (users can upload to their own path), but service role is simpler and safer in an API route context: path = `{user_id}/{contract_id}/original.pdf` in the `contracts` bucket.
5. Insert `contracts` row via **sessionClient** (RLS): `status: 'processing'`, `extraction_status: 'pending'`, `file_path: '{user_id}/{contract_id}/original.pdf'`, `file_name` (taken from the multipart filename), `name` (set to filename minus extension — the `contracts.name` column is `NOT NULL` in the schema, so a default is required; overwritten during confirm), `category: 'other'` (the `contracts.category` column is also `NOT NULL`; overwritten during confirm).
6. Return `{ contract_id }`.

---

## 6. `/api/confirm` Route

**Request:** `POST /api/confirm` with `{ contract_id, name, category, fields: { [field_name]: string | boolean | number | null } }`

Valid `field_name` keys in `fields`: `counterparty_name`, `effective_date`, `expiry_date`, `renewal_date`, `auto_renew`, `notice_period_days`, `notice_period_text`, `contract_value`. `name` and `category` are top-level keys only, never written to `contract_extractions`.

**The client must include all 8 AI-extracted field names in `fields` on every confirm POST — including fields the user never interacted with (e.g., high-confidence green fields).** For untouched green fields, send `extracted_value` as the `confirmed_value`. Omitting a field leaves the corresponding `contracts` top-level column unpopulated and breaks alert generation.

**Type coercion before DB writes:**
- `auto_renew` → coerce to boolean before writing to `contracts.auto_renew`. Accept `true`/`false` (boolean) or `"true"`/`"false"` (string). Write `null` if null.
- `notice_period_days` → coerce to integer (`parseInt`) before writing to `contracts.notice_period_days`. Write `null` if null.
- All other fields → write as-is (TEXT columns accept strings and null).
- `confirmed_value` in `contract_extractions` is always stored as TEXT (or null) — coercion only applies when copying to `contracts` top-level columns.

**`user_id` source:** Use `session.user.id` (from the authenticated session) as `user_id` for all inserted `alerts` and `activity_log` rows.

**Steps:**
1. Auth check — 401 if no session. Extract `user_id = session.user.id`.
2. Fetch contract via `sessionClient` (RLS). 404 if not found. 409 if `status === 'confirmed'` already.
3. Validate `fields` keys — return `400` if any key is not in the list of valid AI-extracted field names (see Section 4). `confidence` is never a valid key; reject it if present. Upsert `contract_extractions` — write `confirmed_value` (as TEXT, or null) for each field in `fields`. Skip any row where `field_name = 'confidence'` (metadata row, not user-reviewable). Conflict target: `ON CONFLICT (contract_id, field_name)`. **Do not compute or write `was_edited`** — the DB trigger sets it automatically.

   **DB trigger note:** The existing `set_was_edited` trigger only fires `was_edited = true` when `confirmed_value IS NOT NULL`. This means "Not applicable" resolutions (where `confirmed_value = NULL`) do not set `was_edited`, so on a return visit those fields render amber/red again. **Fix:** the migration in Section 7 updates the trigger to also set `was_edited = true` when `confirmed_value IS NULL AND extracted_value IS NOT NULL` (user explicitly nulled a field that had an extracted value). This ensures the blue collapsed state appears correctly for "Not applicable" resolutions.

4. Update `contracts` row via `sessionClient`. **This step must complete before step 5** — the `status: 'confirmed'` write is what makes the 409 guard effective against network retries:
   - Set `name`, `category`, `status: 'confirmed'`, `updated_at: now()`
   - Copy confirmed field values to top-level columns: `expiry_date`, `renewal_date`, `effective_date`, `auto_renew` (coerced bool), `notice_period_days` (coerced int), `notice_period_text`, `counterparty_name`, `contract_value`
   - A `null` `confirmed_value` writes `NULL` to the corresponding column.
   - **Do not include `extraction_confidence` in the update** — preserve the AI confidence score from extraction unchanged.
   - **Do not update `extraction_status`** — leave it as `'review'` (or `'manual'`). The card state precedence logic uses `status === 'confirmed'` as the definitive confirmed indicator; `extraction_status` is not changed on confirm and its value is irrelevant once `status = 'confirmed'`.
5. Pre-generate `alerts` rows (all inserts via `sessionClient`):
   - `notice_deadline` formula intent: fire 7 days before the notice deadline so users have advance warning. Formula: `scheduled_for = (expiry_date - notice_period_days days) - 7 days`. Example: expiry 2025-12-31, notice 30 days → deadline is 2025-12-01, alert fires 2025-11-24.
   - Alert generation rules:
     - `expiry_date` present → insert `day_60`, `day_30`, `day_7` at `expiry_date - 60/30/7 days`. Set `target_date = expiry_date` on each row.
     - `renewal_date` present AND `expiry_date` IS NULL → insert `day_60`, `day_30`, `day_7` based on `renewal_date`. Set `target_date = renewal_date` on each row. (Contract has a renewal date but no expiry date — treat renewal_date as the primary target.)
     - `renewal_date` present AND `expiry_date` present AND `renewal_date` differs from `expiry_date` → insert `day_60`, `day_30`, `day_7` based on `renewal_date`. Set `target_date = renewal_date` on each row.
     - `notice_period_days` present AND `expiry_date` present → insert `notice_deadline` at `(expiry_date - notice_period_days days) - 7 days`. Set `target_date = expiry_date - notice_period_days days`. **Sanity check:** if `effective_date` is present, skip this alert if `scheduled_for < effective_date` (would fire before the contract even starts — data anomaly). If `effective_date` is null, skip the sanity check; the `<= today` rule below still applies.
   - **Skip any alert where `scheduled_for <= today`** — this rule applies globally to ALL alert types (day_60, day_30, day_7, notice_deadline). Handles expired contracts and past-pointing notice deadlines — no stale alerts inserted.
   - Insert all alerts with `ON CONFLICT (contract_id, alert_type, target_date) DO NOTHING` to guard against duplicate submissions.
   - `target_date` column: a `date` column on the `alerts` table that stores the actual date the alert is counting down to. Required so expiry-based and renewal-based alerts with the same `alert_type` are distinguishable at send time. **Add migration:** `ALTER TABLE alerts ADD COLUMN target_date date;`
6. Insert `activity_log`: `event_type: 'contract_confirmed'`, metadata: `{ contract_id, alert_count: <number of alert rows inserted> }`.
7. Return `{ ok: true }`.

---

## 7. Database Migration Required

Before implementing `/api/confirm`:

```sql
-- 1. Add target_date column (two-step pattern)
-- WARNING: Safe to run only on databases with no existing confirmed contracts.
-- If alert rows already exist, set target_date to the correct values
-- (expiry_date or renewal_date as appropriate) before adding NOT NULL.
ALTER TABLE public.alerts ADD COLUMN target_date date;
UPDATE public.alerts SET target_date = '1970-01-01' WHERE target_date IS NULL;
ALTER TABLE public.alerts ALTER COLUMN target_date SET NOT NULL;
-- Note: the SET NOT NULL line is mandatory — run all three steps unconditionally.

-- 2. Add notice_deadline to alert_type check constraint
ALTER TABLE public.alerts DROP CONSTRAINT alerts_alert_type_check;
ALTER TABLE public.alerts ADD CONSTRAINT alerts_alert_type_check
  CHECK (alert_type IN ('day_60', 'day_30', 'day_7', 'notice_deadline'));

-- 3. Create unique constraint for ON CONFLICT deduplication guard
ALTER TABLE public.alerts
  ADD CONSTRAINT alerts_contract_alert_target_unique
  UNIQUE (contract_id, alert_type, target_date);

-- 4. Fix was_edited trigger:
--    - Use TG_OP = 'UPDATE' guard so the initial INSERT from /api/extract never sets was_edited.
--    - Use IS DISTINCT FROM semantics so NULL confirmed_value IS DISTINCT FROM non-null extracted_value,
--      correctly handling "Not applicable" resolutions (user explicitly sets null on a non-null field).
CREATE OR REPLACE FUNCTION set_was_edited()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.confirmed_value IS DISTINCT FROM NEW.extracted_value) THEN
    NEW.was_edited = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 8. Known Limitations (v1)

| # | Limitation | Mitigation |
|---|---|---|
| 1 | PDF signed URL expires after 600s; iframe shows Supabase 400 for long review sessions | Acceptable for v1; refresh endpoint can be added later |
| 2 | Fire-and-forget `/api/extract` POST: if it fails to send, contract stays `'processing'` until 90s polling timeout | 90s timeout recovers to manual entry; acceptable for v1 |

---

## 9. Out of Scope (v1)

- Supabase Realtime (polling is sufficient)
- PDF text search / highlight (extract exact positions of matched fields)
- Bulk confirm without review
- Drag-to-reorder contract list
