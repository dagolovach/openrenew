## Status

**Last verified:** 2026-03-24
**Build status:** Completed

`isExpired()`, `daysUntil()`, and `activeExpiryDate()` are in `lib/utils.ts`. Expired contracts display correctly across dashboard, detail page, and review screen. A contract expiring today is NOT considered expired (strict `<` comparison).

---

# Expired Contract Display Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix display of expired contracts across dashboard cards, sort order, detail page, and review screen by introducing a shared `isExpired` helper and applying consistent expired-state UI.

**Architecture:** Add `isExpired` and `formatExpiredDate` to a new `lib/utils.ts` (single source of truth), then update each component to import and use it. No API changes needed — all changes are pure UI/display logic in client components plus one server component select query fix.

**Tech Stack:** Next.js 14 App Router, TypeScript, React inline styles, Tailwind (minimal use), Supabase for data shape.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `lib/utils.ts` | `isExpired`, `daysUntil`, `formatExpiredDate` helpers |
| Modify | `components/dashboard/contract-card.tsx` | Add `expired` CardState variant, render expired card |
| Modify | `components/dashboard/contract-list.tsx` | Update `computeCardState`, `sortContracts`, `computeMetrics`; add Expired metric card |
| Modify | `app/(dashboard)/dashboard/contracts/[id]/page.tsx` | Add `renewal_date` to Supabase select query |
| Modify | `components/contracts/ContractDetailClient.tsx` | Replace countdown with expired display; grey progress bar; EXPIRED badge; muted expiry date |
| Modify | `components/contracts/ProgressBar.tsx` | Add `expired` prop: 100% grey fill, no marker dot |
| Modify | `components/review/review-client.tsx` | Add `expiry_date`/`renewal_date` to Contract type; show dismissible expired warning banner |

---

## Task 1: Create `lib/utils.ts` with shared helpers

**Files:**
- Create: `lib/utils.ts`

### Notes
- ISO date strings like `"2026-03-20"` parse as UTC midnight, which drifts by timezone offset when passed to `new Date()` directly. Append `"T00:00:00"` to force local-midnight parsing — consistent with existing `contract-list.tsx` convention.

- [ ] **Step 1: Create `lib/utils.ts`**

```typescript
// lib/utils.ts

export type ContractDates = {
  expiry_date: string | null;
  renewal_date: string | null;
};

/**
 * A contract is expired when expiry_date is in the past AND
 * renewal_date is absent or also in the past.
 * A contract with a future renewal_date is still active (auto-renewed).
 *
 * Dates are parsed as local midnight (T00:00:00) to match the rest of the codebase.
 */
export function isExpired(contract: ContractDates): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!contract.expiry_date) return false;

  const expiry = new Date(contract.expiry_date + "T00:00:00");
  const renewal = contract.renewal_date
    ? new Date(contract.renewal_date + "T00:00:00")
    : null;

  const expiryPast = expiry < today;
  // "past or absent" — true when renewal is either missing or also expired.
  // A future renewal_date means the contract auto-renewed and is still active.
  const renewalPastOrAbsent = !renewal || renewal < today;

  return expiryPast && renewalPastOrAbsent;
}

/**
 * Days from today until the given ISO date string.
 * Negative when date is in the past.
 * Parses as local midnight (T00:00:00).
 */
export function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil(
    (new Date(iso + "T00:00:00").getTime() - today.getTime()) / 86400000
  );
}

/**
 * Format a date as "14 Mar 2024" (en-GB short).
 */
export function formatExpiredDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/utils.ts
git commit -m "feat: add isExpired, daysUntil, formatExpiredDate to lib/utils"
```

---

## Task 2: Update `ContractCard` — add expired card state

**Files:**
- Modify: `components/dashboard/contract-card.tsx`

### Context

Current `CardState` union:
```typescript
export type CardState =
  | { type: "processing" }
  | { type: "review"; unresolvedCount: number }
  | { type: "confirmed"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; counterpartyName: string | null }
  | { type: "manual"; message: string };
```

The `confirmed` branch renders a coloured days-left counter. Expired contracts must instead show a neutral "EXPIRED · date" display with no days counter and neutral grey border/background.

Note: the `expired` variant uses `expiryDate: string` (non-nullable) because `isExpired` only returns true when `expiry_date` is present.

- [ ] **Step 1: Add `expired` variant to `CardState` and import helpers**

At the top of `components/dashboard/contract-card.tsx`, add:

```typescript
import { formatExpiredDate } from "@/lib/utils";
```

Extend the `CardState` type (replace the existing type definition):

```typescript
export type CardState =
  | { type: "processing" }
  | { type: "review"; unresolvedCount: number }
  | { type: "confirmed"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; counterpartyName: string | null }
  | { type: "expired"; expiryDate: string; counterpartyName: string | null }
  | { type: "manual"; message: string };
```

- [ ] **Step 2: Add the expired card render branch**

In the chain of `if/else if` blocks that build `inner`, add a new `else if` for expired **after** the `confirmed` block and **before** the final `else` (manual) block:

```typescript
  } else if (cardState.type === "expired") {
    const { expiryDate, counterpartyName } = cardState;
    inner = (
      <div
        onClick={() => router.push(`/dashboard/contracts/${id}`)}
        style={{
          ...CARD_BASE,
          border: "3px solid rgba(255,255,255,0.12)",
          background: "#111827",
          transform: hovered ? "translateY(-1px)" : "none",
          alignItems: "stretch",
          cursor: "pointer",
        }}
      >
        {/* Icon */}
        <div style={{
          width: "40px", height: "40px", borderRadius: "6px",
          background: "rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, color: "#4B5563", fontSize: "18px",
          alignSelf: "center",
        }}>
          ○
        </div>

        {/* Name + metadata */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ fontSize: "15px", fontWeight: 500, color: "#9CA3AF", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {formatContractName(name)}
          </div>
          <div style={{ fontSize: "12px", color: "#6B7280" }}>
            {[counterpartyName, `Expired ${formatExpiredDate(expiryDate)}`]
              .filter(Boolean).join(" · ")}
          </div>
          {/* Edit link — hover-only */}
          <div style={{ marginTop: "8px", opacity: hovered ? 1 : 0, transition: "opacity 150ms ease" }}>
            <Link
              href={`/dashboard/review/${id}?reopen=1`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: "11px", color: "#4B5563", textDecoration: "none", borderBottom: "1px solid transparent", transition: "color 150ms, border-color 150ms" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#9CA3AF"; (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = "#9CA3AF"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "#4B5563"; (e.currentTarget as HTMLAnchorElement).style.borderBottomColor = "transparent"; }}
            >
              Edit
            </Link>
          </div>
        </div>

        {/* Expired right-side display */}
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "flex-end",
          justifyContent: "center", flexShrink: 0, paddingLeft: "16px",
          borderLeft: "1px solid rgba(255,255,255,0.06)",
        }}>
          <div style={{
            fontSize: "10px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#6B7280",
            fontFamily: "var(--font-jetbrains), monospace",
            marginBottom: "4px",
          }}>
            EXPIRED
          </div>
          <div style={{
            fontSize: "14px",
            fontFamily: "var(--font-jetbrains), monospace",
            color: "#6B7280",
          }}>
            {formatExpiredDate(expiryDate)}
          </div>
        </div>
        {trashBtn}
      </div>
    );
  } else {
    // manual (existing block follows unchanged)
```

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/contract-card.tsx
git commit -m "feat: add expired card state to ContractCard"
```

---

## Task 3: Update `ContractList` — sort, computeCardState, metrics

**Files:**
- Modify: `components/dashboard/contract-list.tsx`

### Context

Three functions need updating plus one render block:
1. `computeCardState` — must return `{ type: "expired" }` for confirmed expired contracts (check before computing daysLeft to avoid negative urgency)
2. `sortContracts` — expired goes to priority 7 (bottom), sorted by expiry desc within group
3. `computeMetrics` — exclude expired from `active` and `expiring`; add `expired` count
4. Metrics grid render — add optional 4th card when expired > 0

**Known gap (not fixed in this plan):** `getSortPriority` does not fall back to `renewal_date` for urgency days, unlike `computeCardState`. A confirmed contract with `expiry_date = null` and an upcoming `renewal_date` sorts as "no expiry" (priority 3) even if renewal is imminent. This is a pre-existing inconsistency — fixing it is out of scope here.

- [ ] **Step 1: Add imports**

At the top of `components/dashboard/contract-list.tsx`, add:

```typescript
import { isExpired, daysUntil } from "@/lib/utils";
```

- [ ] **Step 2: Replace `computeCardState`**

Replace the entire `computeCardState` function with:

```typescript
function computeCardState(c: ContractRow, timedOut: boolean): CardState {
  // 1. Confirmed wins
  if (c.status === "confirmed") {
    // Check expired first — before computing days to avoid negative urgency display
    if (isExpired(c)) {
      return { type: "expired", expiryDate: c.expiry_date!, counterpartyName: c.counterparty_name };
    }
    const dateForDays = c.expiry_date ?? c.renewal_date;
    if (!dateForDays) return { type: "confirmed", urgency: "green", expiryDate: null, daysLeft: null, counterpartyName: c.counterparty_name };
    const days = daysUntil(dateForDays);
    const urgency = days <= 30 ? "red" : days <= 60 ? "amber" : "green";
    return { type: "confirmed", urgency, expiryDate: c.expiry_date, daysLeft: days, counterpartyName: c.counterparty_name };
  }
  // 2. Manual (set by extract route)
  if (c.extraction_status === "manual") {
    return { type: "manual", message: "Scanned PDF · Manual entry needed" };
  }
  // 3. Processing (with 90s client-side timeout)
  if (c.status === "processing") {
    if (timedOut) return { type: "manual", message: "Extraction timed out. Enter dates manually." };
    return { type: "processing" };
  }
  // 4. Ready to review
  if (c.status === "review" && c.extraction_status === "review") {
    return { type: "review", unresolvedCount: c.unresolved_count };
  }
  return { type: "processing" };
}
```

- [ ] **Step 3: Replace `sortContracts`**

Replace the entire `sortContracts` function with:

```typescript
function getSortPriority(c: ContractRow): number {
  if (c.status === "confirmed") {
    if (isExpired(c)) return 7;          // expired — bottom
    if (!c.expiry_date) return 3;        // no expiry date
    const days = daysUntil(c.expiry_date);
    if (days <= 30) return 0;            // red — top
    if (days <= 60) return 1;            // amber
    return 2;                            // green
  }
  if (c.status === "review" && c.extraction_status === "review") return 4;
  if (c.status === "processing") return 5;
  if (c.extraction_status === "manual") return 6;
  return 8; // fallback
}

function sortContracts(contracts: ContractRow[]): ContractRow[] {
  return [...contracts].sort((a, b) => {
    const gd = getSortPriority(a) - getSortPriority(b);
    if (gd !== 0) return gd;

    // Within expired group: most recently expired first (desc)
    if (isExpired(a) && isExpired(b)) {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date > b.expiry_date ? -1 : 1;
    }

    // Within confirmed group: soonest expiry first (asc)
    if (a.status === "confirmed") {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date < b.expiry_date ? -1 : 1;
    }
    if (a.status === "review") return a.updated_at > b.updated_at ? -1 : 1;
    return a.created_at > b.created_at ? -1 : 1;
  });
}
```

- [ ] **Step 4: Replace `computeMetrics`**

Replace the entire `computeMetrics` function with:

```typescript
function computeMetrics(contracts: ContractRow[]) {
  const active = contracts.filter((c) => c.status === "confirmed" && !isExpired(c)).length;
  const expiring = contracts.filter((c) => {
    if (c.status !== "confirmed" || isExpired(c)) return false;
    const d = c.expiry_date ?? c.renewal_date;
    if (!d) return false;
    return daysUntil(d) <= 30;
  }).length;
  const review = contracts.filter((c) => c.status === "review" && c.extraction_status === "review").length;
  const expired = contracts.filter((c) => c.status === "confirmed" && isExpired(c)).length;
  return { active, expiring, review, expired };
}
```

- [ ] **Step 5: Update metrics render to destructure `expired` and add optional 4th card**

Find the line `const { active, expiring, review } = computeMetrics(contracts);` and replace it:

```typescript
const { active, expiring, review, expired } = computeMetrics(contracts);
```

Find the metrics grid JSX block (the `<div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", ... }}>`) and replace it:

```tsx
<div style={{
  display: "grid",
  gridTemplateColumns: expired > 0 ? "repeat(4, 1fr)" : "repeat(3, 1fr)",
  gap: "12px",
  marginBottom: "28px",
}}>
  <MetricCard label="Active contracts" value={active} color="#F9FAFB" />
  <MetricCard label="Expiring soon" value={expiring} color={expiring > 0 ? "#EF4444" : "#4B5563"} dimLabel={expiring === 0} />
  <MetricCard label="Needs review" value={review} color={review > 0 ? "#F59E0B" : "#4B5563"} dimLabel={review === 0} />
  {expired > 0 && (
    <MetricCard label="Expired" value={expired} color="#6B7280" dimLabel />
  )}
</div>
```

- [ ] **Step 6: Commit**

```bash
git add components/dashboard/contract-list.tsx
git commit -m "feat: update sort, card state, and metrics to handle expired contracts"
```

---

## Task 4: Fix detail page server component — add `renewal_date` to select

**Files:**
- Modify: `app/(dashboard)/dashboard/contracts/[id]/page.tsx`

### Context

`ContractDetailClient` will call `isExpired(contract)` which reads `contract.renewal_date`. Currently the server component does not include `renewal_date` in its Supabase select query — it will arrive as `undefined` at runtime. A contract that has auto-renewed (future `renewal_date`) would incorrectly appear as expired.

- [ ] **Step 1: Add `renewal_date` to the select query**

Find the existing select string:

```typescript
"id, name, counterparty_name, category, effective_date, expiry_date, auto_renew, notice_period_days, notice_period_text, contract_value, extraction_confidence"
```

Replace with:

```typescript
"id, name, counterparty_name, category, effective_date, expiry_date, renewal_date, auto_renew, notice_period_days, notice_period_text, contract_value, extraction_confidence"
```

- [ ] **Step 2: Commit**

```bash
git add "app/(dashboard)/dashboard/contracts/[id]/page.tsx"
git commit -m "fix: include renewal_date in contract detail page select query"
```

---

## Task 5: Update `ContractDetailClient` — expired display

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`
- Modify: `components/contracts/ProgressBar.tsx`

### Context

Changes:
1. Add `renewal_date` to the `Contract` type
2. Import `isExpired`, `formatExpiredDate` from `lib/utils`
3. Derive `contractExpired` **before** `expiryColor` (dependency order matters)
4. Pass `contractExpired ? null : contract.expiry_date` to `useCountdown` (stops the 1-second re-render loop for expired contracts)
5. Add `EXPIRED` badge in header
6. Add `(expired)` suffix to expiry date in Section 3
7. Pass `expired` prop to `ProgressBar`
8. Replace countdown Section 5 with static expired display

- [ ] **Step 1: Add `renewal_date` to `Contract` type, add imports, and remove local `daysUntil`**

`ContractDetailClient.tsx` has a local `daysUntil` function (currently around line 46). Remove it entirely — it will be replaced by the canonical version from `lib/utils`.

Find and delete this block:

```typescript
function daysUntil(iso: string): number {
  const ms = new Date(iso).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(ms / 86400000);
}
```

Note: `daysUntil` is not actually called in `ContractDetailClient.tsx` directly — `urgencyColor` uses `daysUntil` locally. Since `urgencyColor` is also a local helper (not imported), it can continue to use the `daysUntil` definition from `lib/utils` if we add it to the import. Or, since `urgencyColor` is used only for `expiryColor` which we now override with `contractExpired ? "#6B7280" : urgencyColor(...)`, we can keep `urgencyColor` as-is but update its `daysUntil` call to use the imported version.

**Simplest approach:** delete the local `daysUntil` function, add `daysUntil` to the `lib/utils` import, and keep `urgencyColor` unchanged — it will pick up the imported `daysUntil` automatically since the local one is gone.

Update the `Contract` type in `ContractDetailClient.tsx`:

```typescript
type Contract = {
  id: string;
  name: string;
  counterparty_name: string | null;
  category: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  renewal_date: string | null;   // NEW
  auto_renew: boolean | null;
  notice_period_days: number | null;
  notice_period_text: string | null;
  contract_value: string | null;
  extraction_confidence: number | null;
};
```

Add imports at the top of the file (includes `daysUntil` to replace the now-deleted local copy):

```typescript
import { isExpired, formatExpiredDate, daysUntil } from "@/lib/utils";
```

- [ ] **Step 2: Derive `contractExpired` and update `expiryColor` (single combined step)**

At the top of the component body, find:

```typescript
const countdown = useCountdown(contract.expiry_date);
const expiryColor = urgencyColor(contract.expiry_date);
```

Replace with:

```typescript
const contractExpired = isExpired(contract);
// Pass null to useCountdown when expired — prevents a live 1-second interval on expired contracts
const countdown = useCountdown(contractExpired ? null : contract.expiry_date);
const expiryColor = contractExpired ? "#6B7280" : urgencyColor(contract.expiry_date);
```

- [ ] **Step 3: Add EXPIRED badge in Section 1 header**

The header currently has a badge ternary `{contract.auto_renew ? ... : ...}` rendered as a single top-level element with `flexShrink: 0`. Replace the entire badge element with a flex column wrapper that stacks an optional EXPIRED badge above the existing auto-renew badge:

```tsx
{/* Badges column */}
<div style={{ display: "flex", flexDirection: "column", gap: "8px", alignItems: "flex-end", flexShrink: 0 }}>
  {contractExpired && (
    <div style={{
      border: "1px solid rgba(255,255,255,0.2)",
      borderRadius: "4px",
      padding: "5px 10px",
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: "10px",
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "#6B7280",
      whiteSpace: "nowrap",
    }}>
      Expired
    </div>
  )}
  {contract.auto_renew ? (
    <div style={{
      border: "1px solid rgba(245,158,11,0.4)",
      borderRadius: "4px",
      padding: "5px 10px",
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: "10px",
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "#F59E0B",
      whiteSpace: "nowrap",
    }}>
      Auto-Renews
    </div>
  ) : (
    <div style={{
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "4px",
      padding: "5px 10px",
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: "10px",
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: "#4B5563",
      whiteSpace: "nowrap",
    }}>
      No Auto-Renew
    </div>
  )}
</div>
```

- [ ] **Step 4: Add `(expired)` suffix to expiry date in Section 3**

Find the Section 3 expiry date block:

```tsx
{contract.expiry_date ? (
  <div
    style={{
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: "32px",
      fontWeight: 700,
      color: expiryColor,
      letterSpacing: "0.04em",
      lineHeight: 1,
    }}
  >
    {formatDateLarge(contract.expiry_date)}
  </div>
```

Replace with:

```tsx
{contract.expiry_date ? (
  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
    <div style={{
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: "32px",
      fontWeight: 700,
      color: expiryColor,
      letterSpacing: "0.04em",
      lineHeight: 1,
    }}>
      {formatDateLarge(contract.expiry_date)}
    </div>
    {contractExpired && (
      <span style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "13px",
        color: "#4B5563",
        letterSpacing: "0.06em",
      }}>
        (expired)
      </span>
    )}
  </div>
```

- [ ] **Step 5: Update `ProgressBar` call to pass `expired` prop**

Find the ProgressBar usage in Section 4:

```tsx
<ProgressBar
  effectiveDate={contract.effective_date}
  expiryDate={contract.expiry_date}
/>
```

Replace with:

```tsx
<ProgressBar
  effectiveDate={contract.effective_date}
  expiryDate={contract.expiry_date}
  expired={contractExpired}
/>
```

- [ ] **Step 6: Replace `ProgressBar.tsx` entirely**

Replace the full contents of `components/contracts/ProgressBar.tsx` with:

```typescript
// components/contracts/ProgressBar.tsx
"use client";

export default function ProgressBar({
  effectiveDate,
  expiryDate,
  expired = false,
}: {
  effectiveDate: string | null;
  expiryDate: string | null;
  expired?: boolean;
}) {
  if (!effectiveDate || !expiryDate) return null;

  const effective = new Date(effectiveDate).getTime();
  const expiry = new Date(expiryDate).getTime();
  const today = Date.now();

  if (expiry <= effective) return null;

  const total = expiry - effective;
  const elapsed = today - effective;
  const pct = expired ? 100 : Math.min(Math.max((elapsed / total) * 100, 0), 100);

  const markerColor = pct > 75 ? "#EF4444" : pct > 50 ? "#F59E0B" : "#10B981";

  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div>
      {/* Bar */}
      <div
        style={{
          position: "relative",
          height: "6px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: "3px",
          marginBottom: "12px",
        }}
      >
        {/* Filled gradient or grey expired fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${pct}%`,
            background: expired
              ? "rgba(255,255,255,0.15)"
              : "linear-gradient(to right, #10B981, #F59E0B, #EF4444)",
            borderRadius: "3px",
          }}
        />
        {/* Today marker dot — hidden when expired */}
        {!expired && (
          <div
            style={{
              position: "absolute",
              left: `${pct}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: markerColor,
              border: "2px solid #0D1117",
              boxShadow: `0 0 8px ${markerColor}80`,
              zIndex: 1,
            }}
          />
        )}
      </div>

      {/* Labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "10px",
          color: "#4B5563",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span>Start · {fmtShort(effectiveDate)}</span>
        <span>Expiry · {fmtShort(expiryDate)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Replace Section 5 countdown with expired-conditional display**

Find the entire Section 5 block (the `{/* ── Section 5: Countdown timer ... */}` div). Replace it with:

```tsx
{/* ── Section 5: Countdown timer or expired status ─────────────────────── */}
<div
  style={{
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "4px",
    padding: "24px",
  }}
>
  {contractExpired ? (
    <>
      <div style={{ ...labelStyle, marginBottom: "16px" }}>Status</div>
      <div style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "32px",
        fontWeight: 700,
        color: "#6B7280",
        letterSpacing: "0.06em",
        lineHeight: 1,
        marginBottom: "8px",
      }}>
        EXPIRED
      </div>
      <div style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "20px",
        color: "#4B5563",
        letterSpacing: "0.04em",
        marginBottom: "16px",
      }}>
        {contract.expiry_date ? formatDateLarge(contract.expiry_date) : ""}
      </div>
      <div>
        {sentAlerts.length > 0 ? (
          <span style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            letterSpacing: "0.1em",
            color: "#6B7280",
            textTransform: "uppercase",
          }}>
            ● {sentAlerts.length} ALERT{sentAlerts.length > 1 ? "S" : ""} SENT BEFORE EXPIRY
          </span>
        ) : (
          <span style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            letterSpacing: "0.1em",
            color: "#4B5563",
            textTransform: "uppercase",
          }}>
            ○ No active alerts
          </span>
        )}
      </div>
    </>
  ) : (
    <>
      <div style={{ ...labelStyle, marginBottom: "20px" }}>
        Time Remaining
      </div>

      {contract.expiry_date && countdown ? (
        <>
          {/* Countdown numbers */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: "4px",
              marginBottom: "8px",
            }}
          >
            {[
              { value: pad(countdown.days), label: "DAYS" },
              { value: pad(countdown.hours), label: "HRS" },
              { value: pad(countdown.minutes), label: "MIN" },
              { value: pad(countdown.seconds), label: "SEC" },
            ].map(({ value, label }, i) => (
              <div key={label} style={{ display: "flex", alignItems: "flex-end", gap: "4px" }}>
                {i > 0 && (
                  <span
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "40px",
                      fontWeight: 700,
                      color: "rgba(255,255,255,0.2)",
                      lineHeight: 1,
                      marginBottom: "14px",
                      marginRight: "2px",
                    }}
                  >
                    .
                  </span>
                )}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "56px",
                      fontWeight: 700,
                      color: "#F9FAFB",
                      lineHeight: 1,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {value}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "9px",
                      letterSpacing: "0.14em",
                      color: "#4B5563",
                      textTransform: "uppercase",
                      marginTop: "6px",
                    }}
                  >
                    {label}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Alert status line */}
          <div style={{ marginTop: "16px" }}>{alertStatusLine}</div>
        </>
      ) : (
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "24px",
            fontWeight: 700,
            color: "#10B981",
            letterSpacing: "0.06em",
          }}
        >
          CONTRACT ACTIVE
        </div>
      )}
    </>
  )}
</div>
```

- [ ] **Step 8: Commit**

```bash
git add components/contracts/ContractDetailClient.tsx components/contracts/ProgressBar.tsx
git commit -m "feat: expired display on contract detail page (badge, grey expiry, static status, grey progress bar)"
```

---

## Task 6: Update `ReviewClient` — expired warning banner

**Files:**
- Modify: `components/review/review-client.tsx`

### Context

The page server component (`review/[id]/page.tsx`) already fetches `expiry_date` and `renewal_date` — they just aren't in the client's `Contract` type. The banner is dismissible (local state only), amber, non-blocking.

- [ ] **Step 1: Add `expiry_date` and `renewal_date` to `Contract` type**

Replace the existing `Contract` type:

```typescript
type Contract = {
  id: string; name: string; file_name: string | null; category: string;
  status: string; extraction_confidence: number | null;
  expiry_date: string | null;
  renewal_date: string | null;
};
```

- [ ] **Step 2: Add imports**

```typescript
import { isExpired, formatExpiredDate } from "@/lib/utils";
```

- [ ] **Step 3: Add `bannerDismissed` state and `showExpiredBanner` derivation**

After the existing `useState` declarations in the component body:

```typescript
const [bannerDismissed, setBannerDismissed] = useState(false);
const showExpiredBanner = !bannerDismissed && isExpired(contract);
```

- [ ] **Step 4: Add `ExpiredWarningBanner` component above the default export**

```tsx
function ExpiredWarningBanner({ expiryDate, onDismiss }: { expiryDate: string; onDismiss: () => void }) {
  return (
    <div style={{
      background: "rgba(245, 158, 11, 0.08)",
      borderLeft: "3px solid #F59E0B",
      borderRadius: "6px",
      padding: "12px 16px",
      marginBottom: "16px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "12px",
    }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <span style={{ color: "#F59E0B", flexShrink: 0, fontSize: "14px" }}>⚠</span>
        <div style={{ fontSize: "13px", color: "#D1D5DB", lineHeight: 1.5 }}>
          This contract appears to have expired on{" "}
          <strong style={{ color: "#E5E7EB" }}>{formatExpiredDate(expiryDate)}</strong>.
          <br />
          No alerts will be generated. You can still save it for your records.
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#6B7280", fontSize: "16px", lineHeight: 1,
          padding: "2px 4px", flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Insert banner in the manual review path**

In the `if (isManual)` return block, insert the banner after the header div and before the error div:

```tsx
{showExpiredBanner && contract.expiry_date && (
  <ExpiredWarningBanner
    expiryDate={contract.expiry_date}
    onDismiss={() => setBannerDismissed(true)}
  />
)}
```

- [ ] **Step 6: Insert banner in the normal review path**

In the normal review fields panel (`<div className="p-5">`), insert the banner after the back `<Link>` and before the title/delete row:

```tsx
{showExpiredBanner && contract.expiry_date && (
  <ExpiredWarningBanner
    expiryDate={contract.expiry_date}
    onDismiss={() => setBannerDismissed(true)}
  />
)}
```

- [ ] **Step 7: Commit**

```bash
git add components/review/review-client.tsx
git commit -m "feat: show dismissible expired warning banner on review screen"
```

---

## Verification Checklist

Run through these manually in the browser after implementation:

- [ ] Dashboard: expired contract card shows `EXPIRED · 14 Mar 2024` in muted grey, neutral border, sorts to bottom
- [ ] Dashboard: expired contracts sort below all active/review/processing/manual cards
- [ ] Dashboard: within expired group, more recently expired appears first
- [ ] Dashboard: `ACTIVE CONTRACTS` count excludes expired contracts
- [ ] Dashboard: `EXPIRING SOON` count excludes expired contracts
- [ ] Dashboard: `EXPIRED` metric card appears when expired count > 0; absent when count is 0
- [ ] Detail page: expired contract shows static `EXPIRED` + date display, not a ticking countdown
- [ ] Detail page: `EXPIRED` badge visible next to auto-renew badge in header
- [ ] Detail page: expiry date shows in muted grey with `(expired)` suffix
- [ ] Detail page: progress bar is 100% filled in grey, no marker dot
- [ ] Review screen: amber banner shows above fields for expired contract
- [ ] Review screen: banner is dismissible with `×`
- [ ] Review screen: `Confirm & activate alerts` button still enabled despite banner
- [ ] Active auto-renewed contract (renewal_date in future) does NOT show as expired anywhere
- [ ] `isExpired` imported from `lib/utils` in all consuming files — no duplicate logic
