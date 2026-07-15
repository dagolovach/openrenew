# Hero Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the data-dense hero card on the landing page with a minimal, truthful product preview — a headline card matching the contract detail page, a live h:m:s ticker, and two ghost UI hints — while stripping the old card copy and CSS.

**Architecture:** A new `"use client"` component (`hero-card.tsx`) handles all date math and the `setInterval` ticker, following the same `mounted` hydration guard as the existing `CountdownTimer`. The server page (`page.tsx`) swaps the inline card JSX for `<HeroCard />` and gets three copy edits. The old card CSS block in `marketing.css` is deleted; one new `@keyframes pulse` is added for the tracking dot.

**Tech Stack:** Next.js 15 App Router, React `useState`/`useEffect`, inline styles (no Tailwind), `marketing.css` for shared keyframes.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `app/(marketing)/marketing.css` | Add `@keyframes pulse`; remove defunct card CSS (lines 492–689, except `.card-wrap`) |
| Create | `components/marketing/hero-card.tsx` | `"use client"` — date logic, ticker, all four visual elements |
| Modify | `app/(marketing)/page.tsx` | Copy edits (hero-tag, subhead, trust line); swap card JSX → `<HeroCard />` |

---

## Task 1: Add `@keyframes pulse` to `marketing.css`

**Files:**
- Modify: `app/(marketing)/marketing.css` (insert after line ~136, in the Keyframes block)

The pulsing tracking dot in Element B uses `animation: pulse 2s ease-in-out infinite`. This keyframe must exist in the CSS file before the component that references it is rendered.

- [ ] **Step 1: Insert the keyframe**

Open `app/(marketing)/marketing.css`. Find the `@keyframes errorPulseAmber` block near line 133. Insert the new keyframe immediately after it:

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

The keyframes section should now end with:
```css
@keyframes errorPulseAmber {
  0%, 100% { border-left-color: #F59E0B; }
  50% { border-left-color: #FBBF24; }
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

- [ ] **Step 2: Verify no syntax error**

```bash
cd /Users/dmitrygolovach/code/renewl && npx next build 2>&1 | tail -5
```

Expected: build succeeds (exit 0). If it fails, the CSS edit broke something — check the keyframe was inserted cleanly.

- [ ] **Step 3: Commit**

```bash
git add app/\(marketing\)/marketing.css
git commit -m "feat: add @keyframes pulse for hero tracking dot"
```

---

## Task 2: Create `hero-card.tsx`

**Files:**
- Create: `components/marketing/hero-card.tsx`

This is a `"use client"` component. It owns all four visual elements of the new hero card. Dates are computed inside `useEffect` to avoid SSR/hydration mismatch — the component renders skeleton state on the server and fills in real values after mount.

- [ ] **Step 1: Create the file**

Create `components/marketing/hero-card.tsx` with this exact content:

```tsx
"use client";

import { useState, useEffect } from "react";

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDisplayDate(d: Date): string {
  return d
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase(); // e.g. "20 APR 2026"
}

export default function HeroCard() {
  const [mounted, setMounted] = useState(false);
  const [ticker, setTicker] = useState({ h: "00", m: "00", s: "00" });
  const [dates, setDates] = useState({
    expiryDisplay: "",
    noticeDisplay: "",
    noticeDaysLeft: 0,
  });

  useEffect(() => {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 26);

    const notice = new Date(expiry);
    notice.setDate(notice.getDate() - 30);

    const noticeDaysLeft = Math.round(
      (notice.getTime() - Date.now()) / 86400000
    );

    setDates({
      expiryDisplay: formatDisplayDate(expiry),
      noticeDisplay: formatDisplayDate(notice),
      noticeDaysLeft,
    });
    setMounted(true);

    function tick() {
      const now = new Date();
      const diff = Math.max(0, expiry.getTime() - now.getTime());
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTicker({ h: padTwo(h), m: padTwo(m), s: padTwo(s) });
    }

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const fadeIn: React.CSSProperties = {
    opacity: mounted ? 1 : 0,
    transition: "opacity 0.3s ease",
  };

  return (
    <div>
      {/* ── Element A: Headline card ── */}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          borderLeft: "3px solid #EF4444",
          borderRadius: "0 6px 6px 0",
          background: "#111827",
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          {/* Left: name + parties + notice badge */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "17px",
                fontWeight: 600,
                color: "#F9FAFB",
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                lineHeight: 1.3,
              }}
            >
              Salesforce Enterprise License
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#6B7280",
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                marginTop: "4px",
              }}
            >
              Salesforce Inc. ↔ Acme Corp
            </div>
            {/* Notice badge */}
            <div
              style={{
                marginTop: "12px",
                display: "inline-flex",
                alignItems: "center",
                background: "rgba(245,158,11,0.10)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: "4px",
                padding: "5px 10px",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "11px",
                color: "#F59E0B",
                fontWeight: 600,
              }}
            >
              ⚡ Notice by&nbsp;
              <span style={fadeIn}>
                {mounted
                  ? `${dates.noticeDisplay} · ${dates.noticeDaysLeft}d left`
                  : "—"}
              </span>
            </div>
          </div>

          {/* Right: days number + expires date */}
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "4px",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  fontSize: "42px",
                  fontWeight: 700,
                  color: "#EF4444",
                  fontFamily: "var(--font-jetbrains), monospace",
                  lineHeight: 1,
                }}
              >
                26
              </span>
              <span
                style={{
                  fontSize: "16px",
                  fontWeight: 500,
                  color: "#EF4444",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                days
              </span>
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "#6B7280",
                fontFamily: "var(--font-jetbrains), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginTop: "4px",
                ...fadeIn,
              }}
            >
              {mounted ? `EXPIRES ${dates.expiryDisplay}` : "EXPIRES —"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Element B: Live ticker ── */}
      <div
        style={{
          background: "rgba(239,68,68,0.04)",
          border: "1px solid rgba(239,68,68,0.12)",
          borderTop: "none",
          borderRadius: "0 0 6px 6px",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Pulsing dot + TRACKING label */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#10B981",
              flexShrink: 0,
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#10B981",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Tracking
          </span>
        </div>

        {/* h:m:s ticker */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "2px",
            ...fadeIn,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: "#9CA3AF",
            }}
          >
            {ticker.h}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
            }}
          >
            h
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              color: "#374151",
              margin: "0 2px",
            }}
          >
            :
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: "#9CA3AF",
            }}
          >
            {ticker.m}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
            }}
          >
            m
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              color: "#374151",
              margin: "0 2px",
            }}
          >
            :
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: "#9CA3AF",
            }}
          >
            {ticker.s}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
            }}
          >
            s
          </span>
        </div>
      </div>

      {/* ── Element C: Ghost UI hints ── */}
      <div style={{ marginTop: "8px" }}>
        {/* Collapsed details row */}
        <div
          style={{
            padding: "10px 24px",
            cursor: "default",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "11px", color: "#4B5563" }}>▸</span>
          <span
            style={{
              fontSize: "13px",
              color: "#6B7280",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
            }}
          >
            Contract details
          </span>
        </div>

        {/* Contract Intelligence teaser */}
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "6px",
            padding: "14px 24px",
            cursor: "default",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "11px",
                color: "#10B981",
                textTransform: "uppercase",
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              Contract Intelligence
            </span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "10px",
                color: "#4B5563",
              }}
            >
              ▸ SHOW
            </span>
          </div>
          <div
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              color: "#4B5563",
              fontStyle: "italic",
              marginTop: "6px",
            }}
          >
            Powered by Claude · For informational purposes only · Not legal
            advice
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/dmitrygolovach/code/renewl && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors. If there are errors in the new file, fix them before proceeding.

- [ ] **Step 3: Commit**

```bash
git add components/marketing/hero-card.tsx
git commit -m "feat: add HeroCard client component with ticker and ghost UI hints"
```

---

## Task 3: Update `page.tsx` — copy edits + swap card

**Files:**
- Modify: `app/(marketing)/page.tsx`

Three copy changes plus replacing the inline card JSX with `<HeroCard />`. The stagger wrapper div (`className="card-wrap"`, `data-hero-stagger="500"`) is preserved exactly.

- [ ] **Step 1: Add the HeroCard import**

In `app/(marketing)/page.tsx`, after the existing import lines at the top, add:

```tsx
import HeroCard from "@/components/marketing/hero-card";
```

- [ ] **Step 2: Remove the hero-tag label**

Find and delete this element (lines ~60–61):

```tsx
<div className="hero-tag" data-hero-stagger="0" style={{ opacity: 0, transform: 'translateY(12px)', transition: 'opacity 0.6s ease, transform 0.6s ease' }}>Contract intelligence</div>
```

Remove the entire line. Nothing replaces it.

- [ ] **Step 3: Shorten the subhead**

Find the `<p className="hero-sub" ...>` element (lines ~62–66) and replace its content:

Old:
```tsx
<p className="hero-sub" data-hero-stagger="300" style={{ opacity: 0, transform: 'translateY(12px)', transition: 'opacity 0.6s ease, transform 0.6s ease' }}>
  Upload your contracts once. Renewl extracts the key dates and
  alerts you at 60, 30, and 7 days before anything expires or
  auto-renews.
</p>
```

New:
```tsx
<p className="hero-sub" data-hero-stagger="300" style={{ opacity: 0, transform: 'translateY(12px)', transition: 'opacity 0.6s ease, transform 0.6s ease' }}>
  Upload a contract. Get alerted before it auto-renews.
</p>
```

- [ ] **Step 4: Trim the trust line**

Find the trust line paragraph (line ~71):

Old:
```tsx
<p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
  No credit card · Magic link or Google login · Takes 60 seconds
</p>
```

New:
```tsx
<p style={{ fontSize: '13px', color: '#6B7280', margin: 0 }}>
  No credit card · Takes 60 seconds
</p>
```

- [ ] **Step 5: Replace the inline card JSX with `<HeroCard />`**

Find the right-hand column of the hero section — the `card-wrap` div and everything inside it (lines ~77–143):

Old:
```tsx
{/* Right: live contract card */}
<div className="card-wrap" data-hero-stagger="500" style={{ opacity: 0, transform: 'translateY(12px) scale(0.98)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}>
  <div className="card">
    <div className="card-scanline"></div>

    {/* ── Hero band ── */}
    <div className="card-hero">
      <div className="card-stripe"></div>

      {/* Row 1: Name + badges */}
      <div className="card-row-1">
        <div className="card-contract-name">Salesforce Enterprise License</div>
        <div style={{ display: "flex", gap: "5px", flexShrink: 0, marginLeft: "8px" }}>
          <span className="card-badge-sm card-badge-confirmed">CONFIRMED</span>
          <span className="card-badge-sm card-badge-saas">SaaS</span>
        </div>
      </div>

      {/* Row 2: Parties + Countdown */}
      <div className="card-row-2">
        <div className="card-parties">Salesforce Inc. ↔ Acme Corp</div>
        <div className="card-countdown-block">
          <div className="card-days">340 days</div>
          <div className="card-expires-sub">Expires 28 Feb 2027</div>
        </div>
      </div>

      {/* Row 3: Auto-renew badge + notice pill */}
      <div className="card-row-3">
        <span className="card-badge-sm card-badge-autorenew">Auto-Renews</span>
        <span className="card-notice-pill">⚡ Notice deadline: 30 Dec 2026 · in 280 days</span>
      </div>

      {/* Progress bar */}
      <div className="prog-track" style={{ marginBottom: "5px" }}>
        <div className="prog-fill" style={{ width: "54%", background: "#10B981" }}></div>
      </div>
      <div className="prog-labels">
        <span>START · 28 FEB 2025</span>
        <span>EXPIRY · 28 FEB 2027</span>
      </div>
    </div>

    {/* ── Fact strip ── */}
    <div className="card-fact-strip">
      <div className="fact-item">
        <span className="fact-lbl">EFFECTIVE DATE</span>
        <span className="fact-val">28 Feb 2025</span>
      </div>
      <div className="fact-item">
        <span className="fact-lbl">EXPIRY DATE</span>
        <span className="fact-val fact-val-green">28 Feb 2027</span>
      </div>
      <div className="fact-item">
        <span className="fact-lbl">NOTICE PERIOD</span>
        <span className="fact-val">60 days</span>
      </div>
      <div className="fact-item">
        <span className="fact-lbl">CONTRACT VALUE</span>
        <span className="fact-val">$48,000 / yr</span>
      </div>
      <div className="fact-item" style={{ borderRight: "none" }}>
        <span className="fact-lbl">CONFIDENCE</span>
        <span className="fact-val fact-val-green">97.4%</span>
      </div>
    </div>
  </div>
</div>
```

New (keep the wrapper div intact, replace the inner `.card` with `<HeroCard />`):
```tsx
{/* Right: live contract card */}
<div className="card-wrap" data-hero-stagger="500" style={{ opacity: 0, transform: 'translateY(12px) scale(0.98)', transition: 'opacity 0.7s ease, transform 0.7s ease' }}>
  <HeroCard />
</div>
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/dmitrygolovach/code/renewl && npx next build 2>&1 | tail -10
```

Expected: build succeeds and the landing page (`/`) shows as `○` (static). If the build fails, check for a missing import or a JSX syntax error from the removal.

- [ ] **Step 7: Commit**

```bash
git add app/\(marketing\)/page.tsx
git commit -m "feat: swap hero card for HeroCard component, update copy"
```

---

## Task 4: Remove defunct card CSS from `marketing.css`

**Files:**
- Modify: `app/(marketing)/marketing.css`

Delete the entire `CONTRACT CARD` section comment block (lines ~491–689). The `.card-wrap` rule is the only one to preserve — it drives the `heroCardEntrance` animation on the stagger wrapper div that remains in `page.tsx`.

- [ ] **Step 1: Delete the card CSS block**

In `app/(marketing)/marketing.css`, find the section that starts with:

```css
/* ═══════════════════════════════════════════
   CONTRACT CARD
═══════════════════════════════════════════ */
.marketing-root .card-wrap {
  animation: heroCardEntrance 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
}
```

And ends just before:

```css
/* ═══════════════════════════════════════════
   PAIN SECTION
```

Delete everything between (and including) the section comment and the closing `.fact-val-green` rule — **except** the `.card-wrap` rule. The result should be:

```css
/* ═══════════════════════════════════════════
   CONTRACT CARD
═══════════════════════════════════════════ */
.marketing-root .card-wrap {
  animation: heroCardEntrance 0.6s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
}

/* ═══════════════════════════════════════════
   PAIN SECTION
```

Rules deleted (verify none of these class names appear anywhere in the codebase after this change):

```
.card, .card::before, .card::after
.card-scanline
.card-hero
.card-stripe
.card-row-1, .card-row-2, .card-row-3
.card-contract-name
.card-badge-sm, .card-badge-confirmed, .card-badge-saas, .card-badge-autorenew
.card-countdown-block
.card-days
.card-expires-sub
.card-parties
.card-notice-pill
.prog-track, .prog-fill, .prog-labels
.card-fact-strip
.fact-item, .fact-lbl, .fact-val, .fact-val-green
```

- [ ] **Step 2: Confirm no remaining usages of deleted classes**

```bash
cd /Users/dmitrygolovach/code/renewl && grep -r "card-hero\|card-stripe\|card-row-\|card-badge-sm\|card-fact-strip\|fact-item\|prog-track\|prog-fill" --include="*.tsx" --include="*.ts" --include="*.jsx" .
```

Expected: no output. If any hits appear, those files still reference the deleted classes and need updating.

- [ ] **Step 3: Build to confirm no broken styles**

```bash
cd /Users/dmitrygolovach/code/renewl && npx next build 2>&1 | tail -10
```

Expected: build succeeds. CSS deletion can't fail a build, but this confirms nothing else broke.

- [ ] **Step 4: Commit**

```bash
git add app/\(marketing\)/marketing.css
git commit -m "chore: remove defunct hero card CSS classes"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full build + static output check**

```bash
cd /Users/dmitrygolovach/code/renewl && npx next build 2>&1 | grep -E "○|●|λ|Route"
```

Expected: the landing page `/` shows as `○` (static). Example output line:
```
○ /                            (static)
```

If it shows `λ` (server) or `●` (SSG with data), something unintentionally added server-side data fetching.

- [ ] **Step 2: Visual spot check against the verification checklist**

Start the dev server and open the landing page:

```bash
cd /Users/dmitrygolovach/code/renewl && npm run dev
```

Verify each item:

```
✓ 3px left red stripe (#EF4444) on headline card
✓ Contract name left (17px, weight 600), days number right (42px, red)
✓ "Salesforce Inc. ↔ Acme Corp" in muted text below name
✓ ONE badge: "⚡ Notice by {date} · {N}d left" in amber
✓ Expiry date shows as "EXPIRES {DD MMM YYYY}" (calculated, not hardcoded)
✓ Ticker below card: shows HH:MM:SS, updates every second
✓ Pulsing green dot + "TRACKING" label
✓ "▸ Contract details" row below ticker (non-interactive)
✓ "CONTRACT INTELLIGENCE" ghost panel with AI disclaimer
✓ Subhead: "Upload a contract. Get alerted before it auto-renews."
✓ No "Contract intelligence" tag above headline
✓ Trust line: "No credit card · Takes 60 seconds"
✓ Dates and ticker are hidden on initial paint, fade in after hydration
✓ Mobile (<768px): card stacks below headline, full-width
```

- [ ] **Step 3: Confirm no Tailwind classes in HeroCard**

```bash
grep -n "className" /Users/dmitrygolovach/code/renewl/components/marketing/hero-card.tsx
```

Expected: no output (the component uses only `style={{...}}`, zero `className` props).
