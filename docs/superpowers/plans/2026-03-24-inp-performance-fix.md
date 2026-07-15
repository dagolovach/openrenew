## Status

**Last verified:** 2026-03-24
**Build status:** Completed

INP fixes implemented: `loading=lazy` on PDF iframe, `requestIdleCallback` in RevealObserver, custom memo comparator on FieldRow. Recent commits: `fbc6ace perf: add loading=lazy to PDF iframe and use requestIdleCallback in RevealObserver`, `765254a perf: fix activeExpiryDate regression and add FieldRow custom memo comparator`.

---

# INP Performance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Interaction to Next Paint (INP) across all authenticated routes to <200ms, targeting `/dashboard/review/[id]` (6184ms), `/blog` (3224ms), `/dashboard/contracts/[id]` (568ms), `/dashboard` (440ms).

**Architecture:** Three fix categories: (1) **Timer isolation** — extract the 1Hz countdown `setInterval` out of the 400-line `ContractDetailClient` so the full component no longer re-renders every second; (2) **setTimeout chains** — replace `setInterval` polling in `ContractIntelligencePanel` and `ContractList` with chained `setTimeout` calls that yield to user input between iterations; (3) **Server parallelisation** — fire independent Supabase queries with `Promise.all` in the review and contract-detail server components to cut SSR time.

**Tech Stack:** Next.js 14 App Router, React 18, Supabase, inline styles (no Tailwind), TypeScript.

---

## Baseline Measurement (run before starting)

Open Chrome DevTools → Console on each affected page, paste:

```js
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    if (entry.duration > 50) console.log('INP candidate:', Math.round(entry.duration) + 'ms', entry.name);
  }
}).observe({ type: 'event', buffered: true, durationThreshold: 16 });
```

Then interact (click buttons, edit fields). Note durations before and after each task.

---

## Files Modified

| File | Change |
|------|--------|
| `components/contracts/ContractDetailClient.tsx` | Extract `CountdownDisplay` component; memoize `alertStatusLine` |
| `components/contracts/ContractIntelligencePanel.tsx` | `setInterval` → `setTimeout` chain |
| `components/dashboard/contract-list.tsx` | `setInterval` → `setTimeout` chain; `useMemo` for sort; `React.memo` + stable `onDelete` for ContractCard |
| `components/dashboard/contract-card.tsx` | Wrap in `React.memo` with custom cardState comparator |
| `app/(dashboard)/dashboard/contracts/[id]/page.tsx` | `Promise.all` for contracts + alerts queries |
| `app/(dashboard)/dashboard/review/[id]/page.tsx` | `Promise.all` for extractions + signed URL |
| `components/review/field-row.tsx` | Wrap in `React.memo` |
| `components/review/field-panel.tsx` | `useCallback` + `useTransition` for `resolve` function |
| `components/review/review-client.tsx` | `loading="lazy"` on PDF iframe |

---

## Task 1: Isolate countdown timer in ContractDetailClient

**Root cause:** `useCountdown` stores `tick` state directly in `ContractDetailClient`. Every second `setInterval` fires → `tick` increments → **entire** `ContractDetailClient` re-renders (parties row, dates grid, alert status section, progress bar, intelligence panel). When a user clicks Edit or Delete during that re-render, the browser must finish the render before painting the response.

**Fix:** Move countdown state + display into a dedicated `CountdownDisplay` component. Parent only renders once per route load.

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Read the file to confirm current state**

  Verify `useCountdown` hook is defined at module level (lines 81-103) and called inside `ContractDetailClient` (line 129). The `countdown` value is used only in the countdown section (lines 629-711).

- [ ] **Step 2: Add `CountdownDisplay` component above `ContractDetailClient`**

  Insert immediately after the `useCountdown` hook definition (after line 107, before line 109). This component owns its timer and renders the countdown numbers + alert status line:

  ```tsx
  // ── Isolated countdown display ─────────────────────────────────────────────
  const CountdownDisplay = React.memo(function CountdownDisplay({
    expiryDate,
    alertStatusLine,
  }: {
    expiryDate: string;
    alertStatusLine: React.ReactNode;
  }) {
    const countdown = useCountdown(expiryDate);
    if (!countdown) return null;
    return (
      <>
        <div
          className="countdown-flex"
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            gap: "8px",
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
                    fontSize: "30px",
                    fontWeight: 700,
                    color: "rgba(255,255,255,0.2)",
                    lineHeight: 1,
                    marginBottom: "10px",
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
                    fontSize: "44px",
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
        <div style={{ marginTop: "16px" }}>{alertStatusLine}</div>
      </>
    );
  });
  ```

  The file already has `import { useEffect, useState } from "react"` at line 4. Change it to include `React` as a default import:

  ```tsx
  // BEFORE (line 4)
  import { useEffect, useState } from "react";

  // AFTER
  import React, { useEffect, useState } from "react";
  ```

- [ ] **Step 3: Remove `useCountdown` call from `ContractDetailClient`**

  In `ContractDetailClient` (around line 129):
  ```tsx
  // REMOVE this line:
  const countdown = useCountdown(contractExpired ? null : activeExpiryDate(contract));
  ```

- [ ] **Step 4: Replace inline countdown JSX with `<CountdownDisplay>`**

  Find the block that renders `{contract.expiry_date && countdown ? ( ... ) : ( ... )}` (lines ~629-709).

  Replace the entire inner `{contract.expiry_date && countdown ? ... }` block with:
  ```tsx
  {contract.expiry_date ? (
    <CountdownDisplay
      expiryDate={contract.expiry_date}
      alertStatusLine={alertStatusLine}
    />
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
  ```

  Also remove `{/* Alert status line */}` and `<div style={{ marginTop: "16px" }}>{alertStatusLine}</div>` from the parent (it's now inside `CountdownDisplay`).

- [ ] **Step 5: Memoize `alertStatusLine` to ensure `CountdownDisplay` memo is effective**

  `CountdownDisplay` uses `React.memo`, but `alertStatusLine` is a JSX element computed inline — new object reference on every parent render (e.g. when user clicks Delete, `deleteConfirm` changes). Memoize it so `CountdownDisplay` only re-renders when `alerts` prop changes (which never happens during a session).

  Add `useMemo` to the `useEffect, useState` import:
  ```tsx
  import React, { useEffect, useState, useMemo } from "react";
  ```

  Then find the `let alertStatusLine: React.ReactNode;` block (lines ~143-188) and replace the entire block with a `useMemo`:

  ```tsx
  const alertStatusLine = useMemo((): React.ReactNode => {
    const sent = alerts.filter((a) => a.status === "sent");
    const pending = alerts
      .filter((a) => a.status === "pending")
      .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());

    if (sent.length > 0) {
      const last = sent[sent.length - 1];
      return (
        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", letterSpacing: "0.1em", color: "#10B981", textTransform: "uppercase" }}>
          ● ALERT SENT · {alertTypeDescription(last.alert_type)} DELIVERED
        </span>
      );
    } else if (pending.length > 0) {
      const next = pending[0];
      return (
        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", letterSpacing: "0.1em", color: "#F59E0B", textTransform: "uppercase" }}>
          ● ALERT ACTIVE · {alertTypeDescription(next.alert_type)} SCHEDULED
        </span>
      );
    } else {
      return (
        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", letterSpacing: "0.1em", color: "#4B5563", textTransform: "uppercase" }}>
          ○ NO ALERTS CONFIGURED
        </span>
      );
    }
  }, [alerts]);
  ```

  Also remove the now-unused `sentAlerts` and `pendingAlerts` derived variables (lines ~135-141) since the memoized block handles them.

  **Important:** The expired branch (around lines 600–619, inside the `contractExpired ? ( ... )` block) also references `sentAlerts` directly. After removing `sentAlerts`, update those references to use inline filtering:

  ```tsx
  // BEFORE (expired branch, ~line 600-619)
  {sentAlerts.length > 0 ? (
    <span ...>
      ● {sentAlerts.length} ALERT{sentAlerts.length > 1 ? "S" : ""} SENT BEFORE EXPIRY
    </span>
  ) : ( ... )}
  ```

  ```tsx
  // AFTER
  {alerts.filter((a) => a.status === "sent").length > 0 ? (
    <span ...>
      ● {alerts.filter((a) => a.status === "sent").length} ALERT{alerts.filter((a) => a.status === "sent").length > 1 ? "S" : ""} SENT BEFORE EXPIRY
    </span>
  ) : ( ... )}
  ```

  Or extract a `sentCount` const at the top of the component body: `const sentCount = alerts.filter((a) => a.status === "sent").length;` and use it in both places.

- [ ] **Step 6: Verify the page still works**

  Run `npm run dev`. Navigate to `/dashboard/contracts/[any confirmed contract id]`.
  - Countdown digits should still tick every second
  - Alert status line should appear below countdown
  - Edit and Delete buttons should respond immediately
  - Open DevTools Performance → record → click Edit button → verify interaction duration < 200ms

- [ ] **Step 7: Commit**

  ```bash
  git add components/contracts/ContractDetailClient.tsx
  git commit -m "perf: isolate countdown timer into memoized component to stop 1Hz full re-renders"
  ```

---

## Task 2: Convert `ContractIntelligencePanel` polling to `setTimeout` chain

**Root cause:** `setInterval(poll, 3000)` on the intelligence panel fires every 3 seconds regardless of whether the previous poll has completed. If the `/api/analyse` endpoint is slow, polls can overlap AND the setInterval callback competes with user clicks even while an await is pending.

**Fix:** Replace with a `setTimeout` chain — each poll schedules the next only after the current one resolves, and the chain naturally yields between iterations.

**Files:**
- Modify: `components/contracts/ContractIntelligencePanel.tsx`

- [ ] **Step 1: Replace the `useEffect` polling logic**

  Find the `useEffect` at line 216. Replace the entire body of the effect with a `setTimeout` chain:

  ```tsx
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const deadline = Date.now() + 60_000;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/analyse?contract_id=${contractId}`);
        if (res.status === 401) {
          if (!cancelled) setStatus("error");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.findings !== null) {
            if (!cancelled) {
              const sorted = sortFindings(data.findings as Finding[]);
              setFindings(sorted);
              const hasWarnings = sorted.some((f) => f.type === "warning");
              setIsOpen(hasWarnings);
              setStatus(sorted.length > 0 ? "found" : "empty");
            }
            return; // done — no more polls
          }
        }
      } catch {
        if (!cancelled) setStatus("error");
        return;
      }

      // Schedule next poll if not timed out
      if (!cancelled && Date.now() < deadline) {
        timeoutId = setTimeout(poll, 3000);
      } else if (!cancelled) {
        setStatus("error");
      }
    }

    poll();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [contractId]);
  ```

  Remove the now-unused `useRef` import if `intervalId` ref was the only use.

- [ ] **Step 2: Verify polling still works**

  Navigate to `/dashboard/contracts/[id]` for a contract that hasn't been analysed yet (or temporarily comment out the `if (data.findings !== null)` early-return to simulate). Confirm panel shows "Analysing contract..." and eventually shows findings.

- [ ] **Step 3: Commit**

  ```bash
  git add components/contracts/ContractIntelligencePanel.tsx
  git commit -m "perf: replace setInterval with setTimeout chain in ContractIntelligencePanel"
  ```

---

## Task 3: Convert `ContractList` polling + memoize sort

**Root cause A:** `setInterval` fires every 3s. Even though the interval body returns early when there are no processing contracts, the callback is still queued and checked. With `setTimeout` chains the next iteration only schedules after the current Supabase round-trip completes, reducing main thread pressure.

**Root cause B:** `sortContracts(contracts)` and `computeMetrics(contracts)` run on every render of `ContractList`. They're called directly (lines 186-187), so a Supabase polling state update triggers a re-sort of the full list.

**Files:**
- Modify: `components/dashboard/contract-list.tsx`

- [ ] **Step 1: Memoize `sorted` and `metrics`**

  Add `useMemo` import (it's not currently imported). Replace lines 186-187:

  ```tsx
  // BEFORE
  const sorted = sortContracts(contracts);
  const { active, expiring, review, expired } = computeMetrics(contracts);
  ```

  ```tsx
  // AFTER
  const sorted = useMemo(() => sortContracts(contracts), [contracts]);
  const { active, expiring, review, expired } = useMemo(() => computeMetrics(contracts), [contracts]);
  ```

  Update import: `import { useEffect, useRef, useState, useMemo } from "react";`

- [ ] **Step 2: Replace `setInterval` with `setTimeout` chain**

  The polling `useEffect` starts at line 141. The `setInterval` is at line 150. Replace the entire second `useEffect` body with:

  ```tsx
  useEffect(() => {
    // Initialise start times for any processing contracts present at mount
    contractsRef.current
      .filter((c) => c.status === "processing")
      .forEach((c) => { if (!startTimes.current.has(c.id)) startTimes.current.set(c.id, Date.now()); });

    const supabase = createClient();
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;

      const current = contractsRef.current;
      const now = Date.now();

      // Track start times + timeouts for processing contracts
      current.filter((c) => c.status === "processing").forEach((c) => {
        if (!startTimes.current.has(c.id)) startTimes.current.set(c.id, Date.now());
        if ((now - (startTimes.current.get(c.id) ?? now)) >= TIMEOUT_MS) timedOut.current.add(c.id);
      });

      const pollIds = current
        .filter((c) => c.status === "processing" && !timedOut.current.has(c.id))
        .map((c) => c.id);

      if (pollIds.length > 0) {
        const { data } = await supabase
          .from("contracts")
          .select("id, status, extraction_status, extraction_confidence, expiry_date, renewal_date, party_a, party_b, updated_at, created_at, name, file_name, contract_extractions(confidence, confirmed_value, was_edited, field_name)")
          .in("id", pollIds);

        if (data && !cancelled) {
          setContracts((prev) => {
            const map = new Map(prev.map((c) => [c.id, c]));
            data.forEach((updated: any) => {
              const { contract_extractions, ...rest } = updated;
              map.set(updated.id, { ...map.get(updated.id)!, ...rest, unresolved_count: countUnresolved(contract_extractions) });
            });
            return Array.from(map.values());
          });
        }
      }

      // Always reschedule — a new upload could arrive at any time via the merge useEffect.
      // The fetch is guarded by pollIds.length > 0 above, so idle loops are cheap.
      if (!cancelled) {
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    // Start first poll after a short delay so initial render completes first
    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []); // empty deps — reads state via contractsRef
  ```

- [ ] **Step 3: Add `React.memo` to `ContractCard` with custom cardState comparator**

  In `components/dashboard/contract-card.tsx`, add `React` to the existing import at the top:

  ```tsx
  // BEFORE (line 1-2)
  // components/dashboard/contract-card.tsx
  "use client";
  import { useState } from "react";
  ```

  ```tsx
  // AFTER
  // components/dashboard/contract-card.tsx
  "use client";
  import React, { useState } from "react";
  ```

  Then wrap the exported component in `React.memo` with a custom comparator. The comparator avoids re-rendering cards whose `cardState` values haven't actually changed (even though the object reference is new):

  ```tsx
  function cardStateEqual(a: CardState, b: CardState): boolean {
    if (a.type !== b.type) return false;
    if (a.type === "confirmed" && b.type === "confirmed") {
      return a.urgency === b.urgency && a.expiryDate === b.expiryDate && a.daysLeft === b.daysLeft && a.partyA === b.partyA && a.partyB === b.partyB;
    }
    if (a.type === "review" && b.type === "review") return a.unresolvedCount === b.unresolvedCount;
    if (a.type === "manual" && b.type === "manual") return a.message === b.message;
    if (a.type === "expired" && b.type === "expired") return a.expiryDate === b.expiryDate;
    return true; // processing
  }
  ```

  Change the export:
  ```tsx
  // BEFORE
  export default function ContractCard({ id, name, cardState, onDelete }: ...) {
    // ...
  }
  ```

  ```tsx
  // AFTER: wrap the function with memo, keep name for DevTools
  const ContractCard = React.memo(
    function ContractCard({ id, name, cardState, onDelete }: ...) {
      // ... entire existing function body unchanged ...
    },
    (prev, next) =>
      prev.id === next.id &&
      prev.name === next.name &&
      cardStateEqual(prev.cardState, next.cardState) &&
      prev.onDelete === next.onDelete
  );

  export default ContractCard;
  ```

- [ ] **Step 4: Stabilize `onDelete` handler in `ContractList`**

  For `React.memo` on `ContractCard` to skip re-renders, `onDelete` must be a stable function reference per card. Currently it's an inline arrow function (new reference every render). Fix by caching handlers per contract id:

  Add a `deleteHandlers` ref in `ContractList` (after the `timedOut` ref on line 125):

  ```tsx
  const deleteHandlers = useRef(new Map<string, () => void>());
  ```

  Add a helper (before the JSX return):

  ```tsx
  function getDeleteHandler(id: string): () => void {
    if (!deleteHandlers.current.has(id)) {
      deleteHandlers.current.set(id, () => {
        setContracts((prev) => prev.filter((x) => x.id !== id));
      });
    }
    return deleteHandlers.current.get(id)!;
  }
  ```

  Update the `ContractCard` call in the map:
  ```tsx
  // BEFORE
  onDelete={() => setContracts((prev) => prev.filter((x) => x.id !== c.id))}

  // AFTER
  onDelete={getDeleteHandler(c.id)}
  ```

- [ ] **Step 5: Verify polling and delete still work**

  Upload a PDF and verify the card transitions from "Extracting…" → "Review & confirm" within ~90 seconds. The manual entry fallback should also still appear after the timeout. Delete a contract and confirm it disappears from the list.

- [ ] **Step 6: Commit**

  ```bash
  git add components/dashboard/contract-list.tsx components/dashboard/contract-card.tsx
  git commit -m "perf: setTimeout chain + memoized sort + memoized ContractCard in dashboard"
  ```

---

## Task 4: Parallelize server queries in `contracts/[id]/page.tsx`

**Root cause:** `contracts` and `alerts` are fetched sequentially. Both are needed for the page but `alerts` only requires `contractId` (from URL params) — it can run in parallel with `contracts`.

**Files:**
- Modify: `app/(dashboard)/dashboard/contracts/[id]/page.tsx`

- [ ] **Step 1: Parallelize the two data queries**

  Current code (lines 22-43) fetches `contract` then `alertsRaw` sequentially. Replace with:

  ```tsx
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [contractRes, alertsRaw] = await Promise.all([
    supabase
      .from("contracts")
      .select(
        "id, name, party_a, party_b, category, effective_date, expiry_date, renewal_date, auto_renew, notice_period_days, notice_period_text, contract_value, extraction_confidence"
      )
      .eq("id", contractId)
      .eq("user_id", user.id)
      .single(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("alerts")
      .select("*")
      .eq("contract_id", contractId)
      .order("scheduled_for", { ascending: true }),
  ]);

  const { data: contract, error } = contractRes;
  if (error || !contract) notFound();
  ```

  Keep the existing `alerts` mapping logic unchanged below.

- [ ] **Step 2: Verify the contract detail page loads correctly**

  Navigate to `/dashboard/contracts/[id]`. All sections (parties, countdown, dates grid, alert status, intelligence panel) should render as before.

- [ ] **Step 3: Commit**

  ```bash
  git add app/\(dashboard\)/dashboard/contracts/\[id\]/page.tsx
  git commit -m "perf: parallelize contracts + alerts queries in contract detail page"
  ```

---

## Task 5: Parallelize server queries in `review/[id]/page.tsx`

**Root cause:** After fetching the `contract`, the page fetches `extractions` and generates the `signedUrl` sequentially. These two are independent and can run in parallel, cutting SSR latency.

**Files:**
- Modify: `app/(dashboard)/dashboard/review/[id]/page.tsx`

- [ ] **Step 1: Identify the sequential block to replace**

  Lines 50–66 in the current file are:
  ```tsx
  // Fetch all extractions — exclude metadata row
  const { data: extractions } = await supabase
    .from("contract_extractions")
    .select("field_name, extracted_value, confirmed_value, confidence, was_edited")
    .eq("contract_id", contractId)
    .neq("field_name", "confidence");

  // Generate 600s signed URL for PDF iframe
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  let pdfUrl: string | null = null;
  if (contract.file_path) {
    const { data: signed } = await adminClient.storage
      .from("contracts")
      .createSignedUrl(contract.file_path, 600);
    pdfUrl = signed?.signedUrl ?? null;
  }
  ```

- [ ] **Step 2: Replace the entire block (lines 50–66) with `Promise.all`**

  Delete lines 50–66 completely and replace with:

  ```tsx
  // Fetch extractions and generate signed URL in parallel
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [extractionsRes, signedRes] = await Promise.all([
    supabase
      .from("contract_extractions")
      .select("field_name, extracted_value, confirmed_value, confidence, was_edited")
      .eq("contract_id", contractId)
      .neq("field_name", "confidence"),
    contract.file_path
      ? adminClient.storage.from("contracts").createSignedUrl(contract.file_path, 600)
      : Promise.resolve(null),
  ]);

  const extractions = extractionsRes.data;
  const pdfUrl = signedRes && "data" in signedRes ? (signedRes.data?.signedUrl ?? null) : null;
  ```

  The `return` line at the end of the function (`return <ReviewClient ... pdfUrl={pdfUrl} ... />`) remains unchanged.

- [ ] **Step 3: Verify the review page loads correctly**

  Navigate to `/dashboard/review/[id]`. PDF should appear on the left, fields on the right. Confirm button should work.

- [ ] **Step 4: Commit**

  ```bash
  git add app/\(dashboard\)/dashboard/review/\[id\]/page.tsx
  git commit -m "perf: parallelize extractions + signed URL fetch in review page"
  ```

---

## Task 6: Memoize `FieldRow` + stabilize `resolve` callback

**Root cause:** In `FieldPanel`, any field edit calls `setResolutions(prev => ({ ...prev, [fn]: ... }))` which updates the entire `resolutions` record, causing all 9 `FieldRow` components to re-render. Since `FieldRow` has no memoization, this is O(n) work per keystroke where n=9.

Additionally, the `resolve` function is re-created on every `FieldPanel` render, which prevents memoization from working even if added to `FieldRow`.

**Files:**
- Modify: `components/review/field-row.tsx` — wrap in `React.memo`
- Modify: `components/review/field-panel.tsx` — `useCallback` on `resolve`

- [ ] **Step 1: Wrap `FieldRow` in `React.memo`**

  In `components/review/field-row.tsx`, the file has `import { useState } from "react"` at the top. Change it to include `React`:

  ```tsx
  // BEFORE (line ~4)
  import { useState } from "react";

  // AFTER
  import React, { useState } from "react";
  ```

  Then change the export:

  ```tsx
  // BEFORE
  export default function FieldRow({ ... }: Props) {
    // ...
  }
  ```

  ```tsx
  // AFTER
  const FieldRow = React.memo(function FieldRow({ ... }: Props) {
    // ... entire existing function body unchanged ...
  });

  export default FieldRow;
  ```

- [ ] **Step 2: Stabilize `resolve` in `FieldPanel` with `useCallback` + `useTransition`**

  In `components/review/field-panel.tsx`, update imports:

  ```tsx
  // BEFORE
  import { useState, useRef, useEffect } from "react";

  // AFTER
  import { useState, useRef, useEffect, useCallback, useTransition } from "react";
  ```

  Replace the `resolve` function (line 63):

  ```tsx
  // BEFORE
  function resolve(fn: FieldName, value: string | null) {
    setResolutions((p) => ({ ...p, [fn]: { value, isResolved: true } }));
  }
  ```

  ```tsx
  // AFTER
  const [, startTransition] = useTransition();

  const resolve = useCallback((fn: FieldName, value: string | null) => {
    // Mark the resolutions state update as non-urgent so the browser can paint
    // the visual feedback of the click (e.g. button press) before processing re-renders
    startTransition(() => {
      setResolutions((p) => ({ ...p, [fn]: { value, isResolved: true } }));
    });
  }, [startTransition]);
  ```

  **Note:** `useTransition` must be declared before `resolve` — place both declarations together immediately after the `resolutions` state declaration (around line 62).

- [ ] **Step 3: Verify review page still works**

  Navigate to a review page with amber/red fields. Edit a field (type in the input, click Save). Confirm that:
  - Only the edited field visually updates (not the whole panel flashing)
  - "Confirm & activate alerts" button still works
  - Date order warnings still appear when relevant

- [ ] **Step 4: Commit**

  ```bash
  git add components/review/field-row.tsx components/review/field-panel.tsx
  git commit -m "perf: memoize FieldRow and stabilize resolve callback to reduce review page re-renders"
  ```

---

## Task 7: Lazy-load PDF iframe in ReviewClient

**Root cause:** The PDF iframe loads eagerly and the browser may block the main thread while rendering the PDF plugin/viewer. Since users interact with the fields panel (right side), the PDF (left side) doesn't need to be ready before interactions work.

**Files:**
- Modify: `components/review/review-client.tsx`

- [ ] **Step 1: Add `loading="lazy"` to the PDF iframe**

  Find line 143:
  ```tsx
  ? <iframe src={pdfUrl} className="w-full h-full" title="Contract PDF" />
  ```

  Replace with:
  ```tsx
  ? <iframe src={pdfUrl} className="w-full h-full" title="Contract PDF" loading="lazy" />
  ```

- [ ] **Step 2: Verify PDF still loads**

  Navigate to a review page with a PDF. The PDF should still load (loading="lazy" only defers it until the iframe is near the viewport — since it's full height, it will load almost immediately but after the main thread is free).

- [ ] **Step 3: Commit**

  ```bash
  git add components/review/review-client.tsx
  git commit -m "perf: add loading=lazy to PDF iframe in ReviewClient"
  ```

---

## Task 8: Investigate and fix blog INP (3,224ms)

**Current state:** `app/(marketing)/blog/page.tsx` is a Server Component with no `'use client'`. The only client code is `<RevealObserver />` which sets up an IntersectionObserver and schedules hero stagger timeouts via `setTimeout`.

**Hypothesis:** The 3224ms field data INP likely reflects mobile CrUX data where clicking a post link triggers a Next.js soft navigation + the new route's hydration competing with the click response. The `RevealObserver` timeouts (which fire during page load) may overlap with user interactions if users click quickly.

**Files:**
- Modify: `components/marketing/reveal-observer.tsx`

- [ ] **Step 1: Wrap IntersectionObserver callback to yield via `requestIdleCallback`**

  The current observer immediately calls `entry.target.classList.add("in")` for each intersecting element. If many elements intersect at once (e.g., the user scrolls fast), this blocks the main thread. Batch the class additions:

  ```tsx
  "use client";

  import { useEffect } from "react";

  export default function RevealObserver() {
    useEffect(() => {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches;

      if (prefersReducedMotion) {
        document.querySelectorAll(".reveal").forEach((el) => {
          el.classList.add("in");
        });
        document.querySelectorAll("[data-hero-stagger]").forEach((el) => {
          (el as HTMLElement).style.opacity = "1";
          (el as HTMLElement).style.transform = "none";
        });
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((e) => e.isIntersecting);
          if (visible.length === 0) return;
          // Yield to user interactions before applying class changes
          const schedule = typeof requestIdleCallback !== "undefined"
            ? requestIdleCallback
            : (cb: () => void) => setTimeout(cb, 0);
          schedule(() => {
            visible.forEach((entry) => {
              entry.target.classList.add("in");
              observer.unobserve(entry.target);
            });
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
      );

      document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

      // Hero stagger — use requestIdleCallback to avoid competing with interactions
      document.querySelectorAll("[data-hero-stagger]").forEach((el) => {
        const delay = parseInt((el as HTMLElement).dataset.heroStagger || "0", 10);
        setTimeout(() => {
          const schedule = typeof requestIdleCallback !== "undefined"
            ? requestIdleCallback
            : (cb: () => void) => cb();
          schedule(() => {
            (el as HTMLElement).style.opacity = "1";
            (el as HTMLElement).style.transform = "translateY(0) scale(1)";
          });
        }, delay);
      });

      return () => observer.disconnect();
    }, []);

    return null;
  }
  ```

- [ ] **Step 2: Verify blog page scroll animations still work**

  Navigate to `/blog`. Scroll down — post cards should still fade/scale in as they enter the viewport. Hero elements should still stagger in. No visual regressions.

- [ ] **Step 3: Commit**

  ```bash
  git add components/marketing/reveal-observer.tsx
  git commit -m "perf: use requestIdleCallback in RevealObserver to yield during scroll/click interactions"
  ```

---

## Verification

After all tasks are complete, verify each route:

### Lab test (immediate feedback)

On each page, open DevTools Console and run the PerformanceObserver snippet from the top of this document. Then:

- `/dashboard` — click on a contract card; expect < 200ms logged
- `/dashboard/contracts/[id]` — click Edit, Delete, copy buttons; expect < 200ms
- `/dashboard/review/[id]` — click a field to expand, type in it, click Save; expect < 200ms
- `/blog` — click a post link; expect < 200ms

### Lighthouse

```bash
npx lighthouse https://getrenewl.com/dashboard --view
```

(Requires auth cookie — use Chrome extension or DevTools throttling instead for auth pages.)

### Field data

CrUX updates every 28 days. After deploying, check PageSpeed Insights in ~4 weeks to confirm field INP improvements.

---

## Expected Outcomes

| Route | Before | Expected After |
|-------|--------|----------------|
| `/dashboard/review/[id]` | 6,184ms | < 200ms |
| `/dashboard/contracts/[id]` | 568ms | < 200ms |
| `/dashboard` | 440ms | < 200ms |
| `/blog` | 3,224ms | < 200ms |
| `/login` | 232ms | < 200ms (secondary benefit) |
