# Immediate Redirect with Analyzing Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect user to dashboard immediately on "Confirm & extract", show "Analyzing…" status on the contract card while AI analysis runs in background, then transition to active when done.

**Architecture:** `/api/confirm` sets contract status to `"analyzing"` and returns instantly. A Next.js `after()` callback runs `triggerAnalysis()` post-response and updates status to `"active"`. The dashboard's existing polling loop is extended to include `analyzing` contracts, and the card renders an "Analyzing…" spinner.

**Tech Stack:** Next.js 16 (`after` from `next/server`), Supabase admin client, React inline styles (no Tailwind)

---

### Task 1: Add `analyzing` card state to `contract-card.tsx`

**Files:**
- Modify: `components/dashboard/contract-card.tsx`

- [ ] **Step 1: Add `analyzing` to the `CardState` union type**

Find the `CardState` export (line ~8) and add the new variant:

```typescript
export type CardState =
  | { type: "processing" }
  | { type: "analyzing" }
  | { type: "party_review" }
  | { type: "draft"; unresolvedCount: number }
  | { type: "active"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; partyA: string | null; partyB: string | null }
  | { type: "manual"; message: string }
  | { type: "expired"; expiryDate: string | null; partyA: string | null; partyB: string | null };
```

- [ ] **Step 2: Add render branch for `analyzing` state**

After the `processing` render block (after the closing `}` of the `if (cardState.type === "processing")` block, before the `party_review` block), insert:

```typescript
// ── analyzing ──────────────────────────────────────────────────────────

if (cardState.type === "analyzing") {
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
      style={{
        ...ROW,
        background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
        cursor: "default",
      }}
    >
      <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
      <div style={{ width: "16px", flexShrink: 0 }} />
      <div style={{
        flex: 1,
        minWidth: 0,
        color: "#9CA3AF",
        fontStyle: "italic",
        fontSize: "14px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}>
        {displayName}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
        <span
          className="pulse-dot"
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "#10B981",
            display: "inline-block",
          }}
        />
        <span style={{
          fontSize: "12px",
          color: "#6B7280",
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          Analyzing…
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/contract-card.tsx
git commit -m "feat: add analyzing card state to contract-card"
```

---

### Task 2: Wire `analyzing` into `contract-list.tsx` logic and polling

**Files:**
- Modify: `components/dashboard/contract-list.tsx`

- [ ] **Step 1: Add `analyzing` to `computeCardState()`**

In `computeCardState()`, add a case for `analyzing` before the `party_review` check (after the `processing` block, around line 91):

```typescript
// 3b. Analyzing (party names confirmed, AI analysis running in background)
if (c.status === "analyzing") {
  return { type: "analyzing" };
}
// 3c. Party review (awaiting party name confirmation)
if (c.status === "party_review") {
  return { type: "party_review" };
}
```

- [ ] **Step 2: Add `analyzing` to `getSortPriority()`**

In `getSortPriority()`, add `analyzing` alongside `processing` (around line 114):

```typescript
if (c.status === "processing") return 5;
if (c.status === "analyzing") return 5;
if (c.status === "party_review") return 5;
```

- [ ] **Step 3: Extend polling init to track `analyzing` contracts**

In the polling `useEffect`, update the mount-time start-time initialiser (around line 321):

```typescript
contractsRef.current
  .filter((c) => c.status === "processing" || c.status === "analyzing")
  .forEach((c) => { if (!startTimes.current.has(c.id)) startTimes.current.set(c.id, Date.now()); });
```

- [ ] **Step 4: Extend timeout tracking in `poll()` to include `analyzing`**

In `poll()`, update the tracking block (around line 336):

```typescript
current.filter((c) => c.status === "processing" || c.status === "analyzing").forEach((c) => {
  if (!startTimes.current.has(c.id)) startTimes.current.set(c.id, Date.now());
  if ((now - (startTimes.current.get(c.id) ?? now)) >= TIMEOUT_MS) timedOut.current.add(c.id);
});
```

- [ ] **Step 5: Extend `pollIds` filter to include `analyzing`**

Update the `pollIds` derivation (around line 341):

```typescript
const pollIds = current
  .filter((c) => (c.status === "processing" || c.status === "analyzing") && !timedOut.current.has(c.id))
  .map((c) => c.id);
```

- [ ] **Step 6: Extend `stillProcessing` check to include `analyzing`**

Update the reschedule guard (around line 376):

```typescript
const stillProcessing = contractsRef.current.some(
  (c) => (c.status === "processing" || c.status === "analyzing") && !timedOut.current.has(c.id)
);
```

- [ ] **Step 7: Extend initial poll trigger to include `analyzing`**

Update the guard that starts the first poll (around line 386):

```typescript
if (contractsRef.current.some((c) => c.status === "processing" || c.status === "analyzing")) {
  timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
}
```

- [ ] **Step 8: Commit**

```bash
git add components/dashboard/contract-list.tsx
git commit -m "feat: extend dashboard polling to include analyzing status"
```

---

### Task 3: Update `/api/confirm` to return immediately and run analysis in background

**Files:**
- Modify: `app/api/confirm/route.ts`

- [ ] **Step 1: Import `after` from `next/server`**

At the top of `app/api/confirm/route.ts`, add `after` to the `next/server` import:

```typescript
import { NextResponse, after } from "next/server";
```

- [ ] **Step 2: Import admin Supabase client**

Add this import (needed inside `after()` since the session client may be unavailable post-response):

```typescript
import { createClient as createAdminClient } from "@supabase/supabase-js";
```

- [ ] **Step 3: Change the contract status update from `"active"` to `"analyzing"`**

In the `.update({...})` call (around line 80), change:

```typescript
status: "active",
```

to:

```typescript
status: "analyzing",
```

- [ ] **Step 4: Replace the `await triggerAnalysis(...)` call with an `after()` block**

Remove this block (around line 153):

```typescript
// Run analysis before responding so it completes within the Vercel function lifetime
await triggerAnalysis(contract_id, userId).catch((err) =>
  console.error("[confirm] Analysis trigger failed:", err)
);
```

Replace it with:

```typescript
// Run analysis after responding — after() keeps the Vercel function alive up to maxDuration
after(async () => {
  try {
    await triggerAnalysis(contract_id, userId);
  } catch (err) {
    console.error("[confirm] Background analysis failed:", err);
    return; // contract remains "analyzing" — polling timeout handles graceful fallback
  }
  // Mark contract active once analysis is complete
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error } = await adminClient
    .from("contracts")
    .update({ status: "active" })
    .eq("id", contract_id);
  if (error) console.error("[confirm] Failed to mark contract active after analysis:", error);
});
```

- [ ] **Step 5: Verify `maxDuration = 60` is still present**

Confirm line 11 still reads:

```typescript
export const maxDuration = 60;
```

Do not remove or change it — it governs the `after()` callback lifetime on Vercel.

- [ ] **Step 6: Commit**

```bash
git add app/api/confirm/route.ts
git commit -m "feat: background analysis via after(), redirect immediately to dashboard"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Upload a PDF contract and walk through the flow**

1. Upload a PDF
2. Wait for party name confirmation dialog
3. Click "Confirm & extract"
4. Verify: redirect to dashboard happens in ~1s (not ~55s)
5. Verify: contract card shows "Analyzing…" with pulsing green dot
6. Wait up to 60s: verify card transitions to active state with expiry info

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Final commit if any lint fixes were needed**

```bash
git add -A
git commit -m "fix: lint cleanup after analyzing status feature"
```
