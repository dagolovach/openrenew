# Contract Detail Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5 stacked equal-weight cards with a hero header band + two-column body that surfaces the notice deadline and Intelligence panel above the fold.

**Architecture:** Single-file rewrite of `ContractDetailClient.tsx`. Remove the live-clock countdown and its performance-isolation workaround (`CountdownDisplay`/`useCountdown`). Replace with a static `{N} days` hero number. Restructure JSX into a full-width urgency-tinted hero band (name → parties+countdown → badges+notice pill → progress bar) and a `1fr 280px` two-column body (date grid left, Intelligence panel right). All styling stays inline — no Tailwind, no CSS modules.

**Tech Stack:** Next.js App Router, React, inline styles, `lib/utils.ts` helpers (`isExpired`, `daysUntil`, `activeExpiryDate`), existing `ProgressBar` and `ContractIntelligencePanel` components (unchanged).

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `components/contracts/ContractDetailClient.tsx` | **Rewrite** | All JSX restructured; dead code removed; two new helpers added |
| `components/contracts/ProgressBar.tsx` | None | Moved inside hero band — no code changes |
| `components/contracts/ContractIntelligencePanel.tsx` | None | Moved to right column — no code changes |
| `components/contracts/AlertStatusRow.tsx` | None | No longer rendered here; file kept |

---

## Task 1: Remove dead code

Remove everything that powered the live seconds clock. This has no user-visible effect yet — the page will temporarily lose its countdown display until Task 2 adds the replacement.

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Delete `useCountdown` hook and its type**

  Remove lines 80–104 (the `Countdown` type and `useCountdown` function):

  ```typescript
  // DELETE everything from:
  type Countdown = { days: number; hours: number; minutes: number; seconds: number } | null;
  // through:
  function useCountdown(expiryDate: string | null): Countdown { ... }
  ```

- [ ] **Step 2: Delete `pad` helper**

  Remove:
  ```typescript
  function pad(n: number): string {
    return String(n).padStart(2, "0");
  }
  ```

- [ ] **Step 3: Delete `CountdownDisplay` component**

  Remove the entire `const CountdownDisplay = React.memo(...)` block (lines 111–186).

- [ ] **Step 4: Remove `alertStatusLine` useMemo**

  In `ContractDetailClient`, remove the `alertStatusLine` useMemo block (lines 214–241). Also remove `sentCount` (it was only used by the expired-state alert count display, which will be simplified in Task 2):

  ```typescript
  // DELETE:
  const sentCount = alerts.filter((a) => a.status === "sent").length;
  // DELETE:
  const alertStatusLine = useMemo((): React.ReactNode => { ... }, [alerts]);
  ```

- [ ] **Step 5: Remove `AlertStatusRow` import and React import cleanup**

  Remove:
  ```typescript
  import AlertStatusRow, { AlertRow } from "./AlertStatusRow";
  ```

  The `AlertRow` type is still used for the `alerts` prop. Keep the type import but switch to type-only:
  ```typescript
  import type { AlertRow } from "./AlertStatusRow";
  ```

  Also update the React import — `useMemo` is no longer needed:
  ```typescript
  // Before:
  import React, { useEffect, useState, useMemo } from "react";
  // After:
  import React, { useState } from "react";
  ```

- [ ] **Step 6: Verify the file compiles**

  ```bash
  cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit
  ```

  Expected: no errors (some JSX referencing the removed components will error — fix by temporarily commenting out the countdown/alert sections in the return JSX if needed, or proceed directly to Task 2).

- [ ] **Step 7: Commit**

  ```bash
  git add components/contracts/ContractDetailClient.tsx
  git commit -m "refactor: remove live countdown clock and AlertStatusRow from detail page"
  ```

---

## Task 2: Add `heroBandColors` and `noticeDeadlineDaysLeft` helpers

These replace the old `urgencyColor` function and add the data needed for the notice pill.

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Delete `urgencyColor`**

  Remove the existing `urgencyColor` function (lines 51–57). It will be superseded by `heroBandColors`.

- [ ] **Step 2: Add `heroBandColors` helper**

  Add after `categoryLabel`:

  ```typescript
  type BandColors = {
    stripe: string;
    bgTint: string;
    border: string;
    countdownColor: string;
  };

  function heroBandColors(contract: Contract, expired: boolean): BandColors {
    if (expired) {
      return {
        stripe: "#374151",
        bgTint: "rgba(255,255,255,0.03)",
        border: "rgba(255,255,255,0.08)",
        countdownColor: "#6B7280",
      };
    }
    const expiry = activeExpiryDate(contract);
    if (!expiry) {
      return {
        stripe: "#10B981",
        bgTint: "rgba(16,185,129,0.05)",
        border: "rgba(16,185,129,0.15)",
        countdownColor: "#10B981",
      };
    }
    const days = daysUntil(expiry);
    if (days <= 30) {
      return {
        stripe: "#EF4444",
        bgTint: "rgba(239,68,68,0.05)",
        border: "rgba(239,68,68,0.18)",
        countdownColor: "#EF4444",
      };
    }
    if (days <= 60) {
      return {
        stripe: "#F59E0B",
        bgTint: "rgba(245,158,11,0.05)",
        border: "rgba(245,158,11,0.18)",
        countdownColor: "#F59E0B",
      };
    }
    return {
      stripe: "#10B981",
      bgTint: "rgba(16,185,129,0.05)",
      border: "rgba(16,185,129,0.15)",
      countdownColor: "#10B981",
    };
  }
  ```

- [ ] **Step 3: Add `noticeDeadlineDaysLeft` helper**

  Add directly after `noticeDeadlineDate`:

  ```typescript
  function noticeDeadlineDaysLeft(contract: Contract): number | null {
    const target = contract.renewal_date ?? contract.expiry_date;
    if (!target || !contract.notice_period_days) return null;
    const d = new Date(target);
    d.setDate(d.getDate() - contract.notice_period_days);
    return daysUntil(d.toISOString());
  }
  ```

  > Note: Uses `renewal_date ?? expiry_date` — same source as `noticeDeadlineDate`, consistent with the date grid row.

- [ ] **Step 4: Verify types compile**

  ```bash
  npx tsc --noEmit
  ```

  Expected: no new errors from the helpers.

- [ ] **Step 5: Commit**

  ```bash
  git add components/contracts/ContractDetailClient.tsx
  git commit -m "refactor: add heroBandColors and noticeDeadlineDaysLeft helpers"
  ```

---

## Task 3: Build the hero header band

Replace the old header row, parties card, and countdown card with the unified hero band.

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Compute band colors and days remaining at the top of the component**

  At the top of the `ContractDetailClient` function body (after existing state declarations), add:

  ```typescript
  const bandColors = heroBandColors(contract, contractExpired);
  const expiryDate = activeExpiryDate(contract);
  const daysLeft = expiryDate ? daysUntil(expiryDate) : null;

  // Notice pill data
  const noticeDateStr = noticeDeadlineDate(contract);
  const noticeDaysLeft = noticeDeadlineDaysLeft(contract);
  const noticePillText = (() => {
    if (!noticeDateStr || noticeDaysLeft === null) return null;
    if (noticeDaysLeft < 0) return `⚡ Notice deadline: ${noticeDateStr} · ${Math.abs(noticeDaysLeft)} days ago`;
    if (noticeDaysLeft === 0) return `⚡ Notice deadline: ${noticeDateStr} · today`;
    return `⚡ Notice deadline: ${noticeDateStr} · in ${noticeDaysLeft} days`;
  })();
  ```

- [ ] **Step 2: Replace the old header row, parties card, and countdown card JSX**

  Delete sections `{/* ── 1. Header Row */}`, `{/* ── 2. Parties Row */}`, and `{/* ── 3. Critical Dates & Countdown Section */}` from the return JSX.

  Replace with the hero band:

  ```tsx
  {/* ── HERO HEADER BAND ─────────────────────────────────────────── */}
  <div
    style={{
      position: "relative",
      background: bandColors.bgTint,
      border: `1px solid ${bandColors.border}`,
      borderRadius: "6px",
      padding: "20px 24px 16px",
      marginBottom: "16px",
      overflow: "hidden",
    }}
  >
    {/* Full-height urgency stripe */}
    <div style={{
      position: "absolute",
      left: 0, top: 0, bottom: 0,
      width: "3px",
      background: bandColors.stripe,
      borderRadius: "3px 0 0 3px",
    }} />

    {/* ── Row 1: Name + Edit/Delete ── */}
    <div
      className="hero-row-1"
      style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: "14px",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontSize: "22px",
          fontWeight: 700,
          color: "#F9FAFB",
          margin: 0,
          letterSpacing: "0.01em",
          lineHeight: 1.1,
        }}
      >
        {formatContractName(contract.name)}
      </h1>

      {/* Action buttons */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0, marginLeft: "16px" }}>
        <Link
          href={`/dashboard/review/${contract.id}?reopen=1`}
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#6B7280",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "4px",
            padding: "6px 12px",
            textDecoration: "none",
            transition: "color 150ms ease, border-color 150ms ease",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "#E5E7EB";
            el.style.borderColor = "rgba(255,255,255,0.25)";
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLAnchorElement;
            el.style.color = "#6B7280";
            el.style.borderColor = "rgba(255,255,255,0.12)";
          }}
        >
          Edit
        </Link>
        {!deleteConfirm ? (
          <button
            onClick={() => setDeleteConfirm(true)}
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#6B7280",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "4px",
              padding: "6px 12px",
              background: "transparent",
              cursor: "pointer",
              transition: "color 150ms ease, border-color 150ms ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.color = "#EF4444";
              el.style.borderColor = "rgba(239,68,68,0.4)";
            }}
            onMouseLeave={(e) => {
              const el = e.currentTarget as HTMLButtonElement;
              el.style.color = "#6B7280";
              el.style.borderColor = "rgba(255,255,255,0.12)";
            }}
          >
            Delete
          </button>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "11px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#0A0F1E",
                background: "#EF4444",
                border: "1px solid #EF4444",
                borderRadius: "4px",
                padding: "6px 12px",
                cursor: deleting ? "not-allowed" : "pointer",
                opacity: deleting ? 0.6 : 1,
                whiteSpace: "nowrap",
              }}
            >
              {deleting ? "Deleting…" : "Confirm"}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "11px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#6B7280",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "4px",
                padding: "6px 12px",
                background: "transparent",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>

    {/* ── Row 2: Parties (left) + Countdown (right) ── */}
    <div
      className="hero-row-2"
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        marginBottom: "14px",
      }}
    >
      {/* Parties */}
      {(contract.party_a || contract.party_b) && (
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#6B7280",
          }}
        >
          {contract.party_a && (
            <span style={{ color: "#9CA3AF" }}>{contract.party_a}</span>
          )}
          {contract.party_a && contract.party_b && (
            <span style={{ color: "#374151", margin: "0 8px" }}>↔</span>
          )}
          {contract.party_b && (
            <span style={{ color: "#9CA3AF" }}>{contract.party_b}</span>
          )}
        </div>
      )}

      {/* Countdown number */}
      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: "24px" }}>
        {contractExpired ? (
          <>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "36px",
                fontWeight: 700,
                color: "#6B7280",
                letterSpacing: "0.04em",
                lineHeight: 1,
              }}
            >
              EXPIRED
            </div>
            {contract.expiry_date && (
              <div
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "13px",
                  color: "#4B5563",
                  marginTop: "5px",
                }}
              >
                {formatDate(contract.expiry_date)}
              </div>
            )}
          </>
        ) : expiryDate ? (
          <>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "52px",
                fontWeight: 700,
                color: bandColors.countdownColor,
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {daysLeft} days
            </div>
            <div
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "13px",
                color: "#9CA3AF",
                marginTop: "5px",
              }}
            >
              Expires {formatDate(expiryDate)}
            </div>
          </>
        ) : (
          <div
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "20px",
              fontWeight: 700,
              color: "#10B981",
              letterSpacing: "0.04em",
            }}
          >
            CONTRACT ACTIVE
          </div>
        )}
      </div>
    </div>

    {/* ── Row 3: Badges + notice deadline pill ── */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        flexWrap: "wrap",
        marginBottom: "14px",
      }}
    >
      {contractExpired ? (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#6B7280",
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: "3px",
            padding: "3px 8px",
          }}
        >
          EXPIRED
        </span>
      ) : (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#10B981",
            border: "1px solid rgba(16,185,129,0.3)",
            borderRadius: "3px",
            padding: "3px 8px",
          }}
        >
          CONFIRMED
        </span>
      )}

      {contract.category && (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#9CA3AF",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "3px",
            padding: "3px 8px",
          }}
        >
          {categoryLabel(contract.category)}
        </span>
      )}

      {contract.auto_renew && (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#F59E0B",
            border: "1px solid rgba(245,158,11,0.35)",
            borderRadius: "3px",
            padding: "3px 8px",
          }}
        >
          Auto-Renews
        </span>
      )}

      {noticePillText && (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            color: "#EF4444",
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "4px",
            padding: "4px 10px",
            whiteSpace: "nowrap",
          }}
        >
          {noticePillText}
        </span>
      )}
    </div>

    {/* ── Progress bar (floor of the band) ── */}
    {contract.effective_date && contract.expiry_date && (
      <ProgressBar
        effectiveDate={contract.effective_date}
        expiryDate={contract.expiry_date}
        expired={contractExpired}
      />
    )}
  </div>
  {/* ── END HERO BAND ────────────────────────────────────────────── */}
  ```

- [ ] **Step 3: Start dev server and verify hero band visually**

  ```bash
  npm run dev
  ```

  Open a confirmed contract at `http://localhost:3000/dashboard/contracts/{id}`.

  Check:
  - Left stripe is visible and runs the full height of the band
  - "N days" renders at 52px in urgency color
  - "Expires {date}" renders at 13px, `#9CA3AF`, no uppercase
  - Notice deadline pill appears (red) when contract has `notice_period_days`
  - Edit / Delete buttons work (Delete confirm flow still functional)
  - Expired contracts show "EXPIRED" label and gray band
  - Contracts without expiry date show "CONTRACT ACTIVE"

- [ ] **Step 4: Commit**

  ```bash
  git add components/contracts/ContractDetailClient.tsx
  git commit -m "feat: hero header band with urgency stripe, compact countdown, notice pill"
  ```

---

## Task 4: Build the two-column body

Replace the old date grid card and intelligence panel with the new layout. The `sectionCardStyle` constant and its usages are removed.

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Remove `sectionCardStyle` constant and old section card JSX**

  Delete the `sectionCardStyle` constant (around line 277–283). Then delete the three remaining old sections from the JSX:
  - `{/* ── 4. Alert Status Row */}` — entirely removed
  - The old date grid / countdown section — replaced in Task 3
  - `{/* ── 5. AI Contract Intelligence Panel */}` — moved to right column in this task

- [ ] **Step 2: Remove `labelStyle` and `valueStyle` constants**

  These were used by the old date grid. Delete:
  ```typescript
  const labelStyle: React.CSSProperties = { ... };
  const valueStyle: React.CSSProperties = { ... };
  ```

  Inline the styles in the new date grid (below).

- [ ] **Step 3: Rebuild `dateItems` for the new grid**

  Keep the existing `dateItems` array logic (lines 286–311) — it already handles missing fields correctly by only pushing items that have values. No changes needed here.

- [ ] **Step 4: Add the two-column body JSX after the hero band**

  ```tsx
  {/* ── TWO-COLUMN BODY ─────────────────────────────────────────── */}
  <div
    className="body-cols"
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 280px",
      gap: "12px",
      alignItems: "start",
    }}
  >
    {/* ── LEFT: Contract Details panel ── */}
    <div>
      {dateItems.length > 0 && (
        <div
          style={{
            background: "#111827",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "6px",
            overflow: "hidden",
          }}
        >
          {/* Panel header */}
          <div
            style={{
              padding: "12px 16px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "#4B5563",
              }}
            >
              Contract Details
            </span>
          </div>

          {/* Date grid */}
          <div style={{ padding: "14px 16px" }}>
            <div
              className="date-grid-responsive"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "14px 20px",
              }}
            >
              {dateItems.map(({ label, value, color }) => (
                <div key={label}>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "10px",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "#4B5563",
                      marginBottom: "4px",
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "14px",
                      color: color ?? "#E5E7EB",
                    }}
                  >
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Panel footer: auto-renew badge + confidence */}
          <div
            style={{
              padding: "10px 16px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              display: "flex",
              alignItems: "center",
              gap: "14px",
            }}
          >
            {contract.auto_renew ? (
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#F59E0B",
                  border: "1px solid rgba(245,158,11,0.35)",
                  borderRadius: "3px",
                  padding: "3px 8px",
                }}
              >
                Auto-Renews
              </span>
            ) : (
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "10px",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#4B5563",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "3px",
                  padding: "3px 8px",
                }}
              >
                No Auto-Renew
              </span>
            )}
            {contract.extraction_confidence != null && (
              <span
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "10px",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  color: "#10B981",
                }}
              >
                {(contract.extraction_confidence * 100).toFixed(1)}% Confidence
              </span>
            )}
          </div>
        </div>
      )}
    </div>

    {/* ── RIGHT: Intelligence panel (pinned sidebar) ── */}
    <div>
      <ContractIntelligencePanel
        contractId={contract.id}
        contractContext={{
          name: contract.name,
          partyA: contract.party_a,
          partyB: contract.party_b,
          expiryDate: contract.expiry_date,
          renewalDate: contract.renewal_date,
          autoRenew: contract.auto_renew,
          noticePeriodDays: contract.notice_period_days,
          contractValue: contract.contract_value,
          category: contract.category ?? "other",
        }}
      />
    </div>
  </div>
  {/* ── END TWO-COLUMN BODY ───────────────────────────────────── */}
  ```

- [ ] **Step 5: Update the `<style>` block for new responsive classes**

  Replace the existing `<style>` block (currently at line 321) with:

  ```tsx
  <style>{`
    @media (max-width: 768px) {
      .body-cols { grid-template-columns: 1fr !important; }
      .hero-row-2 { flex-direction: column !important; align-items: flex-start !important; }
      .hero-row-2 > div:last-child { text-align: left !important; margin-left: 0 !important; margin-top: 12px !important; }
      .date-grid-responsive { grid-template-columns: 1fr 1fr !important; }
    }
    @media (max-width: 480px) {
      .date-grid-responsive { grid-template-columns: 1fr !important; }
    }
  `}</style>
  ```

- [ ] **Step 6: Remove the `maxWidth: "900px"` wrapper div class if it referenced old className patterns**

  The outer wrapper stays:
  ```tsx
  <div style={{ maxWidth: "900px", margin: "0 auto" }}>
  ```
  No changes needed here.

- [ ] **Step 7: Check the full page renders without TypeScript errors**

  ```bash
  npx tsc --noEmit
  ```

  Expected: 0 errors.

- [ ] **Step 8: Visual check — two-column body**

  With dev server running, verify:
  - Intelligence panel renders to the right of the date grid, not below
  - Date grid shows correct number of cells (only fields with values)
  - Auto-renew badge and confidence appear in the panel footer
  - Contracts with no dates: left column is empty, intelligence panel still shows on right
  - Intelligence panel expand/collapse still works
  - "Draft cancellation notice" button still works

- [ ] **Step 9: Commit**

  ```bash
  git add components/contracts/ContractDetailClient.tsx
  git commit -m "feat: two-column body — date grid left, intelligence panel pinned right"
  ```

---

## Task 5: Clean up and verify all edge cases

Check that every contract state renders correctly.

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx` (minor fixes only)

- [ ] **Step 1: Test — contract with no expiry date**

  Find or create a contract with no `expiry_date`. Verify:
  - Hero band shows "CONTRACT ACTIVE" (no days number)
  - No progress bar (requires both dates)
  - No notice pill
  - Band uses green stripe + tint

- [ ] **Step 2: Test — expired contract**

  Find or create an expired contract. Verify:
  - Hero band shows "EXPIRED" label (36px, gray)
  - Expiry date shown below "EXPIRED" label in muted color
  - Band uses gray stripe + tint
  - Notice pill hidden
  - Progress bar full at 100% (gray fill)

- [ ] **Step 3: Test — contract with no parties**

  Verify:
  - Row 2 parties section is hidden (no `↔` with blank sides)
  - Countdown number still right-aligned

- [ ] **Step 4: Test — contract with no notice period**

  Verify:
  - Notice pill does not appear in row 3
  - No "NOTICE DEADLINE" row in date grid

- [ ] **Step 5: Test — mobile viewport**

  In browser DevTools, set viewport to 375px wide. Verify:
  - Hero row 2 stacks: parties on top, countdown below (left-aligned)
  - Body collapses to single column (intelligence panel below date grid)
  - Date grid shows 2 columns

- [ ] **Step 6: Remove unused imports**

  Scan the top of `ContractDetailClient.tsx` for any remaining unused imports and remove them. Common candidates: `useEffect` (removed with countdown hook), `type AlertRow` if no longer used.

  ```bash
  npx tsc --noEmit
  ```

  Fix any remaining errors.

- [ ] **Step 7: Final commit**

  ```bash
  git add components/contracts/ContractDetailClient.tsx
  git commit -m "refactor: clean up unused imports and verify edge case rendering"
  ```

---

## Done

The contract detail page now has:
- Hero header band with urgency stripe, compact `{N} days` countdown, notice deadline pill in the first 80px
- Two-column body with date grid on the left and Intelligence panel pinned on the right
- No live clock, no per-second re-renders, no `CountdownDisplay` isolation workaround
- All existing functionality preserved: delete flow, edit routing, intelligence panel polling and actions, progress bar
