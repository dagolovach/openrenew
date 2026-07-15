# Upload Zone — Compact Layout

**Date:** 2026-04-03
**Status:** Approved

---

## Goal

Shrink the upload zone to a compact single row when the user already has contracts. The contract list is the primary surface once onboarding is done — the upload zone should recede into a utility bar rather than dominating the page.

---

## Behaviour

### State determination

`dashboard/page.tsx` adds one server-side count query (filter: `status NOT IN ('expired','renewed')`). Result passed as `contractCount: number` prop to `UploadZone`. No client-side fetch. Count refreshes on every `router.refresh()`, which already fires after upload.

### Full layout — `contractCount === 0`

Unchanged from current implementation. Large drop target, centred icon, helper text, "Add contract manually →" link. This is the primary CTA when the user has nothing yet.

### Compact layout — `contractCount > 0`

Single row, full width, click/drop target:

```
[↑ icon]  Drop a contract PDF here or click to browse · PDF only · max 20MB     Add contract manually →
```

- Upload arrow icon: 18px, `#10B981` at 0.7 opacity, left-aligned
- Primary text: "Drop a contract PDF here or click to browse", `#F9FAFB`, 14px, `var(--font-inter)`
- Secondary text: "· PDF only · max 20MB", `#6B7280`, 14px, same line
- "Add contract manually →": right-aligned, `#10B981`, `e.stopPropagation()` on click
- Padding: `12px 20px`
- Border-radius: `8px`
- Border at rest: `1px dashed rgba(255,255,255,0.2)`
- Border on drag-over: `1px dashed #10B981`
- Background at rest: transparent
- Background on drag-over: `rgba(16,185,129,0.04)`
- Transition: `200ms ease` on border and background

### Uploading state (compact)

Replace text content with the existing pulsing dot + "Uploading…" inline. Row does not expand.

### Error / limit states (compact)

Render error text as a block below the compact row (not inside it).

### First-upload transition

When `contractCount` goes from 0 → 1 after `router.refresh()`, the zone shrinks from full to compact. Apply a CSS `transition` on `padding` (and optionally `max-height`) so the collapse takes 200–300ms ease rather than snapping.

### Contracts remaining banner

Currently absolutely positioned at `bottom: -48px` relative to the full layout container. In compact mode, render it as a normal block element below the row — remove the absolute positioning for the compact case. Appearance and copy unchanged.

---

## Files changed

| File | Change |
|------|--------|
| `components/dashboard/upload-zone.tsx` | Add `contractCount` prop; conditional full/compact render; transition |
| `app/(dashboard)/dashboard/page.tsx` | Add count query; pass `contractCount` to `UploadZone` |

---

## Out of scope

- No changes to `ContractsFeed`, `ContractList`, or any other component
- No new Supabase queries in `UploadZone` — count comes from the prop only
- Confirming parties UI (after upload) is unchanged regardless of compact/full state
