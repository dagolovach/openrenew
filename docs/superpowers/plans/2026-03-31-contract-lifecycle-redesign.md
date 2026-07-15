# Contract Lifecycle Redesign + Early Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename contract statuses to contract management language (`draft`/`active`/`renewed`) and move the comparison panel from the detail page confirm flow to the review screen so users can negotiate before confirming.

**Architecture:** DB migration renames status values in-place; client code is updated in lock-step; the review screen client fires a POST to `/api/compare` on mount and polls until results arrive — identical to the polling pattern in `RenewalHistoryPanel`.

**Tech Stack:** Next.js App Router, Supabase (Postgres + RLS), TypeScript, inline styles (no Tailwind in dashboard/review pages)

---

## File Map

| File | Change |
|------|--------|
| `supabase/migrations/20260331200000_contract_lifecycle_statuses.sql` | **Create** — new CHECK constraint, data migration, index rebuild |
| `app/api/upload/route.ts` | Modify — exclude `renewed` from plan-limit count |
| `app/api/extract/route.ts` | Modify — guard and set `draft` not `review` |
| `app/api/confirm/route.ts` | Modify — set `active` not `confirmed`; parent becomes `renewed`; **remove** `triggerComparison` call |
| `app/api/contracts/[id]/route.ts` | Modify — restore parent to `active` not `confirmed` on delete |
| `app/api/cron/send-weekly-digest/route.ts` | Modify — query `active` not `confirmed` |
| `app/(dashboard)/dashboard/review/new/page.tsx` | Modify — query and insert `draft` not `review` |
| `app/(dashboard)/dashboard/calendar/page.tsx` | Modify — query `active` |
| `app/(dashboard)/dashboard/contracts-feed.tsx` | Modify — filter on `active` |
| `app/(dashboard)/dashboard/review/[id]/page.tsx` | Modify — add `parent_contract_id` to select; pass to `ReviewClient` |
| `components/dashboard/contract-list.tsx` | Modify — all `"confirmed"`→`"active"`, `"review"`→`"draft"`, add `"renewed"` to expired section |
| `components/dashboard/contract-card.tsx` | Modify — `CardState` type union renames |
| `components/contracts/ContractDetailClient.tsx` | Modify — `"confirmed"` → `"active"` for RenewalUploadButton guard |
| `components/review/review-client.tsx` | Modify — new `parentContractId` prop + comparison panel |
| `__tests__/api/confirm.test.ts` | Modify — fixture and assertion updates |
| `CLAUDE.md` | Modify — status model + comparison flow docs |

---

## Task 1: DB Migration — new status values

**Files:**
- Create: `supabase/migrations/20260331200000_contract_lifecycle_statuses.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260331200000_contract_lifecycle_statuses.sql

-- 1. Drop old CHECK, add new with 'draft', 'active', 'renewed'
ALTER TABLE public.contracts DROP CONSTRAINT contracts_status_check;
ALTER TABLE public.contracts ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('processing', 'draft', 'active', 'expired', 'renewed'));

-- 2. Migrate existing rows
UPDATE public.contracts SET status = 'draft'  WHERE status = 'review';
UPDATE public.contracts SET status = 'active' WHERE status = 'confirmed';

-- 3. Contracts with a successor child become 'renewed' (not 'expired')
UPDATE public.contracts c SET status = 'renewed'
WHERE c.status = 'expired'
  AND EXISTS (
    SELECT 1 FROM public.contracts child
    WHERE child.parent_contract_id = c.id
  );

-- 4. Rebuild partial index for new status name
DROP INDEX IF EXISTS idx_contracts_expiry_date;
CREATE INDEX idx_contracts_expiry_date
  ON public.contracts(user_id, expiry_date) WHERE status = 'active';
```

- [ ] **Step 2: Apply migration**

```bash
supabase db push
```

Expected: migration applied with no errors. Verify in Supabase dashboard that `contracts` table now has CHECK constraint with `draft`/`active`/`renewed`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260331200000_contract_lifecycle_statuses.sql
git commit -m "feat: migrate contract statuses to lifecycle language (draft/active/renewed)"
```

---

## Task 2: Rename statuses across API routes and server components

**Files:**
- Modify: `app/api/upload/route.ts`
- Modify: `app/api/extract/route.ts`
- Modify: `app/api/confirm/route.ts`
- Modify: `app/api/contracts/[id]/route.ts`
- Modify: `app/api/cron/send-weekly-digest/route.ts`
- Modify: `app/(dashboard)/dashboard/review/new/page.tsx`
- Modify: `app/(dashboard)/dashboard/calendar/page.tsx`
- Modify: `app/(dashboard)/dashboard/contracts-feed.tsx`

- [ ] **Step 1: Update `app/api/upload/route.ts`**

Line 38 — current:
```typescript
.neq('status', 'expired')
```
Replace with (excludes both `expired` and `renewed` from plan-limit count):
```typescript
.not('status', 'in', '("expired","renewed")')
```

- [ ] **Step 2: Update `app/api/extract/route.ts`**

Line 50 — current guard:
```typescript
if (["review", "confirmed"].includes(contract.status)) {
```
Replace with:
```typescript
if (["draft", "active"].includes(contract.status)) {
```

Line 130 — current status set:
```typescript
    status: "review",
```
Replace with:
```typescript
    status: "draft",
```

Line 153 — current response:
```typescript
  return NextResponse.json({
    status: "review",
```
Replace with:
```typescript
  return NextResponse.json({
    status: "draft",
```

- [ ] **Step 3: Update `app/api/confirm/route.ts`**

Line 82 — current:
```typescript
      name, category: (f.category ?? category) as string, status: "confirmed", updated_at: new Date().toISOString(),
```
Replace with:
```typescript
      name, category: (f.category ?? category) as string, status: "active", updated_at: new Date().toISOString(),
```

Line 169 — current parent status:
```typescript
      .update({ status: "expired" })
```
Replace with:
```typescript
      .update({ status: "renewed" })
```

- [ ] **Step 4: Update `app/api/contracts/[id]/route.ts`**

Line 61 — current parent restore:
```typescript
      .update({ status: "confirmed" })
```
Replace with:
```typescript
      .update({ status: "active" })
```

- [ ] **Step 5: Update `app/api/cron/send-weekly-digest/route.ts`**

Line 56 — current:
```typescript
    .eq('status', 'confirmed')
```
Replace with:
```typescript
    .eq('status', 'active')
```

- [ ] **Step 6: Update `app/(dashboard)/dashboard/review/new/page.tsx`**

Line 30 — current:
```typescript
    .eq("status", "review")
```
Replace with:
```typescript
    .eq("status", "draft")
```

Line 48 — current insert:
```typescript
      status: "review",
```
Replace with:
```typescript
      status: "draft",
```

- [ ] **Step 7: Update `app/(dashboard)/dashboard/calendar/page.tsx`**

Line 25 — current:
```typescript
    .eq('status', 'confirmed')
```
Replace with:
```typescript
    .eq('status', 'active')
```

- [ ] **Step 8: Update `app/(dashboard)/dashboard/contracts-feed.tsx`**

Lines 41–42 — current:
```typescript
  const confirmed = (contracts ?? []).filter(
    (c: any) => c.status === 'confirmed' && !isExpired(c as { expiry_date: string | null; renewal_date: string | null })
```
Replace with:
```typescript
  const confirmed = (contracts ?? []).filter(
    (c: any) => c.status === 'active' && !isExpired(c as { expiry_date: string | null; renewal_date: string | null })
```

- [ ] **Step 9: Commit**

```bash
git add app/api/upload/route.ts app/api/extract/route.ts app/api/confirm/route.ts \
        app/api/contracts/[id]/route.ts app/api/cron/send-weekly-digest/route.ts \
        "app/(dashboard)/dashboard/review/new/page.tsx" \
        "app/(dashboard)/dashboard/calendar/page.tsx" \
        "app/(dashboard)/dashboard/contracts-feed.tsx"
git commit -m "feat: rename confirmed→active, review→draft, expired(with-successor)→renewed in API routes"
```

---

## Task 3: Rename statuses in client components

**Files:**
- Modify: `components/dashboard/contract-card.tsx`
- Modify: `components/dashboard/contract-list.tsx`
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Update `CardState` type in `components/dashboard/contract-card.tsx`**

Lines 9–13 — current:
```typescript
export type CardState =
  | { type: "processing" }
  | { type: "review"; unresolvedCount: number }
  | { type: "confirmed"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; partyA: string | null; partyB: string | null }
  | { type: "expired"; expiryDate: string; partyA: string | null; partyB: string | null }
  | { type: "manual"; message: string };
```
Replace with:
```typescript
export type CardState =
  | { type: "processing" }
  | { type: "draft"; unresolvedCount: number }
  | { type: "active"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; partyA: string | null; partyB: string | null }
  | { type: "expired"; expiryDate: string; partyA: string | null; partyB: string | null }
  | { type: "manual"; message: string };
```

- [ ] **Step 2: Update render branches in `contract-card.tsx`**

Line 24 — current:
```typescript
  if (a.type === "confirmed" && b.type === "confirmed") {
```
Replace with:
```typescript
  if (a.type === "active" && b.type === "active") {
```

Line 33 — current:
```typescript
  if (a.type === "review" && b.type === "review") return a.unresolvedCount === b.unresolvedCount;
```
Replace with:
```typescript
  if (a.type === "draft" && b.type === "draft") return a.unresolvedCount === b.unresolvedCount;
```

Line 283 — current:
```typescript
    if (cardState.type === "review") {
      const label = cardState.unresolvedCount > 0
        ? `${cardState.unresolvedCount} field${cardState.unresolvedCount === 1 ? "" : "s"} · Review →`
        : "Ready to confirm · Review →";
```
Replace with:
```typescript
    if (cardState.type === "draft") {
      const label = cardState.unresolvedCount > 0
        ? `${cardState.unresolvedCount} field${cardState.unresolvedCount === 1 ? "" : "s"} · Review →`
        : "Ready to confirm · Review →";
```

Line 341 — current:
```typescript
    if (cardState.type === "confirmed") {
      const { urgency, expiryDate, daysLeft } = cardState;
```
Replace with:
```typescript
    if (cardState.type === "active") {
      const { urgency, expiryDate, daysLeft } = cardState;
```

Line 586 — current (manual fallback cast):
```typescript
          {(cardState as { type: "manual"; message: string }).message}
```
Keep as-is (still correct — manual type unchanged).

- [ ] **Step 3: Update `computeCardState` in `components/dashboard/contract-list.tsx`**

Lines 33–58 — current:
```typescript
function computeCardState(c: ContractRow, timedOut: boolean): CardState {
  // 1. Confirmed wins
  if (c.status === "confirmed") {
    // Check expired first — before computing days to avoid negative urgency display
    if (isExpired(c)) {
      return { type: "expired", expiryDate: c.expiry_date!, partyA: c.party_a, partyB: c.party_b };
    }
    const dateForDays = activeExpiryDate(c);
    if (!dateForDays) return { type: "confirmed", urgency: "green", expiryDate: null, daysLeft: null, partyA: c.party_a, partyB: c.party_b };
    const days = daysUntil(dateForDays);
    const urgency = days <= 30 ? "red" : days <= 60 ? "amber" : "green";
    return { type: "confirmed", urgency, expiryDate: c.expiry_date, daysLeft: days, partyA: c.party_a, partyB: c.party_b };
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
Replace with:
```typescript
function computeCardState(c: ContractRow, timedOut: boolean): CardState {
  // 1. Active wins
  if (c.status === "active") {
    // Check expired first — before computing days to avoid negative urgency display
    if (isExpired(c)) {
      return { type: "expired", expiryDate: c.expiry_date!, partyA: c.party_a, partyB: c.party_b };
    }
    const dateForDays = activeExpiryDate(c);
    if (!dateForDays) return { type: "active", urgency: "green", expiryDate: null, daysLeft: null, partyA: c.party_a, partyB: c.party_b };
    const days = daysUntil(dateForDays);
    const urgency = days <= 30 ? "red" : days <= 60 ? "amber" : "green";
    return { type: "active", urgency, expiryDate: c.expiry_date, daysLeft: days, partyA: c.party_a, partyB: c.party_b };
  }
  // 1b. Renewed (replaced by successor)
  if (c.status === "renewed") {
    return { type: "expired", expiryDate: c.expiry_date ?? new Date().toISOString().split("T")[0], partyA: c.party_a, partyB: c.party_b };
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
  if (c.status === "draft" && c.extraction_status === "review") {
    return { type: "draft", unresolvedCount: c.unresolved_count };
  }
  return { type: "processing" };
}
```

- [ ] **Step 4: Update `getSortPriority` in `contract-list.tsx`**

Lines 61–75 — current:
```typescript
function getSortPriority(c: ContractRow): number {
  if (c.status === "confirmed") {
    if (isExpired(c)) return 7;          // expired — bottom
    if (!c.expiry_date) return 3;        // no expiry date
    const date = activeExpiryDate(c);
    const days = date ? daysUntil(date) : Infinity;
    if (days <= 30) return 0;            // red — top
    if (days <= 60) return 1;            // amber
    return 2;                            // green
  }
  if (c.status === "review" && c.extraction_status === "review") return 4;
  if (c.status === "processing") return 5;
  if (c.extraction_status === "manual") return 6;
  return 8; // fallback
}
```
Replace with:
```typescript
function getSortPriority(c: ContractRow): number {
  if (c.status === "active") {
    if (isExpired(c)) return 7;          // expired — bottom
    if (!c.expiry_date) return 3;        // no expiry date
    const date = activeExpiryDate(c);
    const days = date ? daysUntil(date) : Infinity;
    if (days <= 30) return 0;            // red — top
    if (days <= 60) return 1;            // amber
    return 2;                            // green
  }
  if (c.status === "renewed") return 7;  // treat same as expired
  if (c.status === "draft" && c.extraction_status === "review") return 4;
  if (c.status === "processing") return 5;
  if (c.extraction_status === "manual") return 6;
  return 8; // fallback
}
```

- [ ] **Step 5: Update `sortContracts` in `contract-list.tsx`**

Lines 91–97 — current:
```typescript
    // Within confirmed group: soonest expiry first (asc)
    if (a.status === "confirmed") {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date < b.expiry_date ? -1 : 1;
    }
    if (a.status === "review") return a.updated_at > b.updated_at ? -1 : 1;
```
Replace with:
```typescript
    // Within active group: soonest expiry first (asc)
    if (a.status === "active") {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date < b.expiry_date ? -1 : 1;
    }
    if (a.status === "draft") return a.updated_at > b.updated_at ? -1 : 1;
```

- [ ] **Step 6: Update `SummaryBar` in `contract-list.tsx`**

Line 115 — current:
```typescript
    if (c.status !== "confirmed" || isExpired(c)) return false;
```
Replace with:
```typescript
    if (c.status !== "active" || isExpired(c)) return false;
```

Line 121 — current:
```typescript
  const needsReview = contracts.filter(
    (c) => c.status === "review" && c.extraction_status === "review"
  ).length;
```
Replace with:
```typescript
  const needsReview = contracts.filter(
    (c) => c.status === "draft" && c.extraction_status === "review"
  ).length;
```

- [ ] **Step 7: Update `SECTIONS` in `contract-list.tsx`**

Lines 192–242 — current:
```typescript
const SECTIONS: Section[] = [
  {
    key: "action",
    label: "Action needed",
    filter: (c) => {
      if (c.status !== "confirmed" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      return d ? daysUntil(d) <= 30 : false;
    },
  },
  {
    key: "month",
    label: "This month",
    filter: (c) => {
      if (c.status !== "confirmed" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      if (!d) return false;
      const days = daysUntil(d);
      return days > 30 && days <= 60;
    },
  },
  {
    key: "upcoming",
    label: "Upcoming",
    filter: (c) => {
      if (c.status !== "confirmed" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      if (!d) return false;
      return daysUntil(d) > 60;
    },
  },
  {
    key: "confirmed-nodate",
    label: "Tracked — no expiry",
    filter: (c) =>
      c.status === "confirmed" && !isExpired(c) && !c.expiry_date && !c.renewal_date,
  },
  {
    key: "review",
    label: "Needs review",
    filter: (c) =>
      (c.status === "review" && c.extraction_status === "review") ||
      c.extraction_status === "manual" ||
      (c.status === "processing"),
  },
  {
    key: "expired",
    label: "Expired",
    filter: (c) => c.status === "confirmed" && isExpired(c),
  },
];
```
Replace with:
```typescript
const SECTIONS: Section[] = [
  {
    key: "action",
    label: "Action needed",
    filter: (c) => {
      if (c.status !== "active" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      return d ? daysUntil(d) <= 30 : false;
    },
  },
  {
    key: "month",
    label: "This month",
    filter: (c) => {
      if (c.status !== "active" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      if (!d) return false;
      const days = daysUntil(d);
      return days > 30 && days <= 60;
    },
  },
  {
    key: "upcoming",
    label: "Upcoming",
    filter: (c) => {
      if (c.status !== "active" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      if (!d) return false;
      return daysUntil(d) > 60;
    },
  },
  {
    key: "active-nodate",
    label: "Tracked — no expiry",
    filter: (c) =>
      c.status === "active" && !isExpired(c) && !c.expiry_date && !c.renewal_date,
  },
  {
    key: "draft",
    label: "Needs review",
    filter: (c) =>
      (c.status === "draft" && c.extraction_status === "review") ||
      c.extraction_status === "manual" ||
      (c.status === "processing"),
  },
  {
    key: "expired",
    label: "Expired",
    filter: (c) => (c.status === "active" && isExpired(c)) || c.status === "renewed",
  },
];
```

- [ ] **Step 8: Update `ContractDetailClient.tsx`**

Line 738 — current:
```typescript
        {contract.status === "confirmed" && (
```
Replace with:
```typescript
        {contract.status === "active" && (
```

- [ ] **Step 9: Update `__tests__/api/confirm.test.ts`**

Line 65 — current fixture:
```typescript
    mockFrom.mockReturnValue(makeChain({ id: "c1", status: "review" }));
```
Replace with:
```typescript
    mockFrom.mockReturnValue(makeChain({ id: "c1", status: "draft" }));
```

Line 75 — current fixture:
```typescript
    const chain = makeChain({ id: "123e4567-e89b-12d3-a456-426614174001", status: "review", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
```
Replace with:
```typescript
    const chain = makeChain({ id: "123e4567-e89b-12d3-a456-426614174001", status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
```

Lines 104–105 — current fixtures:
```typescript
      if (call === 1) return makeChain({ id: contractId, status: "review", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
      return makeChain({ id: contractId, status: "review" });
```
Replace with:
```typescript
      if (call === 1) return makeChain({ id: contractId, status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
      return makeChain({ id: contractId, status: "draft" });
```

Also find any assertion that checks the update call set `status: "confirmed"` and update to `status: "active"`, and any that checks `status: "expired"` for the parent and update to `status: "renewed"`.

- [ ] **Step 10: Run tests**

```bash
npx jest __tests__/api/confirm.test.ts --no-coverage
```

Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add components/dashboard/contract-card.tsx components/dashboard/contract-list.tsx \
        components/contracts/ContractDetailClient.tsx __tests__/api/confirm.test.ts
git commit -m "feat: rename CardState types and dashboard sections to active/draft/renewed"
```

---

## Task 4: Add comparison panel to review screen

**Files:**
- Modify: `app/(dashboard)/dashboard/review/[id]/page.tsx`
- Modify: `components/review/review-client.tsx`

- [ ] **Step 1: Add `parent_contract_id` to review page select**

In `app/(dashboard)/dashboard/review/[id]/page.tsx`, line 27 — current:
```typescript
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, name, file_name, category, status, extraction_status, extraction_confidence, file_path, expiry_date, renewal_date, effective_date, auto_renew, notice_period_days, notice_period_text, party_a, party_b, contract_value")
    .eq("id", contractId)
    .single();
```
Replace with:
```typescript
  const { data: contract, error } = await supabase
    .from("contracts")
    .select("id, name, file_name, category, status, extraction_status, extraction_confidence, file_path, expiry_date, renewal_date, effective_date, auto_renew, notice_period_days, notice_period_text, party_a, party_b, contract_value, parent_contract_id")
    .eq("id", contractId)
    .single();
```

- [ ] **Step 2: Pass `parentContractId` to `ReviewClient`**

Line 53 — current:
```typescript
  return <ReviewClient contract={contract} extractions={extractions ?? []} pdfUrl={pdfUrl} isManual={isManual} />;
```
Replace with:
```typescript
  return <ReviewClient contract={contract} extractions={extractions ?? []} pdfUrl={pdfUrl} isManual={isManual} parentContractId={contract.parent_contract_id ?? null} />;
```

- [ ] **Step 3: Add comparison panel to `ReviewClient`**

In `components/review/review-client.tsx`, add the `useEffect` and `useRef` imports at the top alongside existing imports:

Change line 4:
```typescript
import { useState } from "react";
```
to:
```typescript
import { useState, useEffect, useRef } from "react";
```

Update the `Contract` type to include `parent_contract_id`:
```typescript
type Contract = {
  id: string; name: string; file_name: string | null; category: string;
  status: string; extraction_confidence: number | null;
  expiry_date: string | null;
  renewal_date: string | null;
  parent_contract_id?: string | null;
};
```

Add the `ComparisonData` type and `ComparisonPanel` component just before the `export default function ReviewClient`:

```typescript
type FieldChange = {
  field: string;
  previous: string | null;
  current: string | null;
  severity: "high" | "medium" | "low";
};

type ClauseChange = {
  clause: string;
  previous: string | null;
  current: string | null;
};

type ComparisonData = {
  field_changes: FieldChange[];
  clause_changes: ClauseChange[];
  summary: string | null;
};

function ComparisonPanel({ contractId }: { contractId: string }) {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    // Fire-and-forget trigger — idempotent, server ignores if already in progress
    fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contract_id: contractId }),
    }).catch(() => {});

    // Poll for results (20 attempts × 3s = 60s max)
    let attempts = 0;
    async function poll() {
      if (cancelledRef.current) return;
      try {
        const res = await fetch(`/api/compare?contract_id=${contractId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.comparison) {
            if (!cancelledRef.current) setComparison(data.comparison);
            setLoading(false);
            return;
          }
        }
      } catch {}
      attempts++;
      if (attempts < 20 && !cancelledRef.current) {
        setTimeout(poll, 3000);
      } else if (!cancelledRef.current) {
        setLoading(false);
      }
    }
    setTimeout(poll, 3000);

    return () => { cancelledRef.current = true; };
  }, [contractId]);

  const SEVERITY_COLOR: Record<string, string> = {
    high:   "#FCA5A5",
    medium: "#FCD34D",
    low:    "#6EE7B7",
  };

  return (
    <div style={{
      marginTop: "24px",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <span style={{ fontSize: "13px", fontWeight: 600, color: "#E5E7EB" }}>
          Changes from previous version
        </span>
        {loading && (
          <span style={{ fontSize: "11px", color: "#6B7280" }}>Analysing…</span>
        )}
      </div>

      {loading && !comparison && (
        <div style={{ padding: "24px 16px", textAlign: "center", fontSize: "13px", color: "#6B7280" }}>
          Comparing with previous version…
        </div>
      )}

      {comparison && (
        <div style={{ padding: "16px" }}>
          {comparison.summary && (
            <p style={{ fontSize: "13px", color: "#D1D5DB", marginBottom: "16px", lineHeight: 1.6 }}>
              {comparison.summary}
            </p>
          )}

          {comparison.field_changes.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#4B5563", marginBottom: "8px" }}>
                Field changes
              </div>
              {comparison.field_changes.map((fc, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "8px",
                  padding: "6px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  fontSize: "13px",
                }}>
                  <span style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: SEVERITY_COLOR[fc.severity] ?? "#6B7280",
                    flexShrink: 0,
                    marginTop: "2px",
                  }} />
                  <span style={{ color: "#9CA3AF", minWidth: "120px" }}>{fc.field}</span>
                  <span style={{ color: "#6B7280", textDecoration: "line-through" }}>{fc.previous ?? "—"}</span>
                  <span style={{ color: "#D1D5DB" }}>→ {fc.current ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          {comparison.clause_changes.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" as const, color: "#4B5563", marginBottom: "8px" }}>
                Clause changes
              </div>
              {comparison.clause_changes.map((cc, i) => (
                <div key={i} style={{
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#9CA3AF", marginBottom: "4px" }}>{cc.clause}</div>
                  {cc.previous && <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>Was: {cc.previous}</div>}
                  {cc.current && <div style={{ fontSize: "12px", color: "#D1D5DB" }}>Now: {cc.current}</div>}
                </div>
              ))}
            </div>
          )}

          {comparison.field_changes.length === 0 && comparison.clause_changes.length === 0 && (
            <div style={{ fontSize: "13px", color: "#6B7280" }}>No significant changes detected.</div>
          )}

          <div style={{ fontSize: "11px", color: "#4B5563", marginTop: "12px" }}>
            Powered by Claude · For informational purposes only · Not legal advice
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Update `ReviewClient` signature and render**

Change the prop signature (line 59) from:
```typescript
export default function ReviewClient({ contract, extractions, pdfUrl, isManual }: {
  contract: Contract; extractions: ExtractionRow[]; pdfUrl: string | null; isManual: boolean;
}) {
```
to:
```typescript
export default function ReviewClient({ contract, extractions, pdfUrl, isManual, parentContractId }: {
  contract: Contract; extractions: ExtractionRow[]; pdfUrl: string | null; isManual: boolean;
  parentContractId: string | null;
}) {
```

In the **non-manual** return branch, after the `<FieldPanel ... />` closing tag (line 246) and before the closing `</div>` of the fields panel inner div, add the comparison panel:

```typescript
            {parentContractId && (
              <ComparisonPanel contractId={contract.id} />
            )}
```

So the end of the fields panel `<div className="p-5">` block becomes:
```typescript
            <FieldPanel
              name={contract.name || contract.file_name || "Untitled"}
              category={contract.category}
              extractions={extractions}
              onConfirm={handleConfirm}
              isConfirming={confirming}
              isManual={false}
            />
            {parentContractId && (
              <ComparisonPanel contractId={contract.id} />
            )}
          </div>
        </div>
```

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/dashboard/review/[id]/page.tsx" \
        components/review/review-client.tsx
git commit -m "feat: add comparison panel to review screen for renewal contracts"
```

---

## Task 5: Remove comparison trigger from confirm route

**Files:**
- Modify: `app/api/confirm/route.ts`

- [ ] **Step 1: Remove `triggerComparison` import**

Line 6 — current:
```typescript
import { triggerComparison } from "@/lib/comparison";
```
Delete this line entirely.

- [ ] **Step 2: Remove `triggerComparison` call block**

Lines 157–162 — current:
```typescript
  // Trigger comparison if this is a renewal contract
  if (contract.parent_contract_id) {
    await triggerComparison(contract_id, contract.parent_contract_id, userId).catch((err) =>
      console.error("[confirm] Comparison trigger failed:", err)
    );
  }
```
Delete these 5 lines entirely. The parent status update block (lines 164–178) stays intact.

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. If `triggerComparison` is used nowhere else, the import removal may trigger an "unused import" lint warning — verify the build is clean.

- [ ] **Step 4: Commit**

```bash
git add app/api/confirm/route.ts
git commit -m "feat: move comparison trigger from confirm route to review screen"
```

---

## Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the status model in the Database Schema section**

Find the `contracts` table description in CLAUDE.md. Current status values listed:
```
`status` (processing/review/confirmed/expired)
```
Replace with:
```
`status` (processing/draft/active/expired/renewed) — `draft`: extracted, awaiting review; `active`: confirmed, alerts live; `expired`: past expiry date; `renewed`: replaced by a successor renewal contract
```

- [ ] **Step 2: Update the Upload & Extraction flow section**

Current step 5:
```
5. `contract_extractions` rows upserted, contract `status` → `'review'`
6. User reviews/edits on review screen → `/api/confirm` → `status` → `'confirmed'`
7. Alerts pre-generated; analysis triggered (awaited, not fire-and-forget) via Python `/analyse`
```
Replace with:
```
5. `contract_extractions` rows upserted, contract `status` → `'draft'`
6. User reviews/edits on review screen → comparison panel fires POST `/api/compare` on mount, polls GET until result arrives (max 60s)
7. User confirms → `/api/confirm` → `status` → `'active'`; parent contract (if renewal) → `'renewed'`
8. Alerts pre-generated; analysis triggered (awaited, not fire-and-forget) via Python `/analyse`
```

- [ ] **Step 3: Update "Live and working" in Current Build Status**

Add to the "Live and working" list:
```
- Contract lifecycle statuses: draft → active → expired/renewed
- Renewal comparison panel on review screen (early access for negotiation)
- Version chain navigation on contract detail page
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new status model and comparison flow"
```

---

## Verification Checklist

After all tasks are complete:

1. **Migration:** Existing contracts have correct new statuses — check Supabase dashboard
2. **Dashboard:** Active/Draft/Expiring/Expired sections render correctly. No "review"/"confirmed" strings in UI text
3. **Upload new contract:** Status goes `processing` → `draft`. Review screen shows fields. Confirm → `active`.
4. **Early comparison:** Upload a renewal → go to review screen → comparison panel appears within 10–30s
5. **Confirm renewal:** Parent becomes `renewed`, child becomes `active`
6. **Detail page:** Comparison still visible on contract detail page after confirm
7. **Build clean:** `npm run build` produces no TypeScript errors
8. **Tests pass:** `npx jest __tests__/api/confirm.test.ts` all pass
9. **Weekly digest cron:** Queries `active` contracts (verify via code search, not runtime)
10. **Plan limits:** Upload count excludes both `expired` and `renewed` contracts
