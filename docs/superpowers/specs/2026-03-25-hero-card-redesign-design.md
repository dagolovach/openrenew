# Hero Card Redesign — Design Spec

**Date:** 2026-03-25
**Status:** Approved

---

## Goal

Replace the data-dense hero card mockup on the landing page with a truthful, minimal preview of the actual contract detail page. One live-ticking client component creates urgency; two ghost UI hints communicate product depth without cluttering the hero.

---

## Scope

Three files change:

1. `components/marketing/hero-card.tsx` — new `"use client"` component (replaces inline card JSX)
2. `app/(marketing)/page.tsx` — copy changes + swap card JSX for `<HeroCard />`
3. `app/(marketing)/marketing.css` — add `@keyframes pulse`, remove unused card CSS classes

`components/marketing/countdown-timer.tsx` becomes unused (but is not deleted — it's a separate concern).

---

## Copy Changes (`page.tsx`)

| Element | Before | After |
|---------|--------|-------|
| Hero tag label | `<div className="hero-tag">Contract intelligence</div>` | **Removed** |
| Subhead | "Upload your contracts once. Renewl extracts the key dates and alerts you at 60, 30, and 7 days before anything expires or auto-renews." | "Upload a contract. Get alerted before it auto-renews." |
| Trust line | "No credit card · Magic link or Google login · Takes 60 seconds" | "No credit card · Takes 60 seconds" |

---

## New Component: `HeroCard`

**File:** `components/marketing/hero-card.tsx`
**Directive:** `"use client"`

### Date logic

```
expiryDate   = new Date() + 26 days   // always urgent red zone
noticeDate   = expiryDate - 30 days   // ≈ today → feels critical
```

Both dates are computed inside the component at runtime. The `mounted` flag (matching the existing `CountdownTimer` pattern) hides date strings and the ticker until after hydration to prevent SSR mismatch.

### Structure — three stacked elements (A, B, C)

#### Element A: Headline card

Mirrors the contract detail page Zone 1 card.

```
border-left: 3px solid #EF4444          ← urgency stripe
border: 1px solid rgba(255,255,255,0.06) (other three sides)
border-radius: 0 6px 6px 0
background: #111827
padding: 24px
```

Interior layout:

```
┌─────────────────────────────────────────────────┐
│▌  [name: 17px/600/Inter/#F9FAFB]    [42px days] │
│▌  [parties: 13px/#6B7280]           [EXPIRES…]  │
│▌                                                 │
│▌  [⚡ notice badge]                              │
└─────────────────────────────────────────────────┘
```

- **Contract name**: 17px, weight 600, #F9FAFB, Inter, left
- **Parties**: 13px, #6B7280, Inter. Format: `Salesforce Inc. ↔ Acme Corp`
- **Days number**: 42px, weight 700, JetBrains Mono, #EF4444, right-aligned
- **"days" label**: 16px, weight 500, JetBrains Mono, #EF4444, next to number
- **Expires date**: 10px, JetBrains Mono, #6B7280, uppercase, letter-spacing 0.06em. Format: `EXPIRES {DD MMM YYYY}`. Hidden until mounted.
- **Notice badge**: inline-flex, `⚡ Notice by {date} · {N}d left`. Background `rgba(245,158,11,0.10)`, border `1px solid rgba(245,158,11,0.25)`, border-radius 4px, padding `5px 10px`, JetBrains Mono, 11px, #F59E0B, weight 600. Date hidden until mounted.

**Hardcoded sample data:**
- Name: `Salesforce Enterprise License`
- Party A: `Salesforce Inc.`
- Party B: `Acme Corp`

#### Element B: Live ticker

Attached directly below Element A (no gap, `border-top: none`, `border-radius: 0 0 6px 6px`).

```
background: rgba(239,68,68,0.04)
border: 1px solid rgba(239,68,68,0.12)
border-top: none
padding: 14px 24px
display: flex; justify-content: space-between; align-items: center
```

Left side: pulsing green dot (6×6px, #10B981, `animation: pulse 2s ease-in-out infinite`) + "TRACKING" label (JetBrains Mono, 10px, #10B981, uppercase, letter-spacing 0.1em).

Right side: `HH:MM:SS` display counting down to expiry. Digits in JetBrains Mono, 13px, weight 700, #9CA3AF. Unit labels (h/m/s) in 10px, #4B5563. Colon separators in 11px, #374151. All hidden until mounted (opacity: 0 → 1).

Ticker logic: `setInterval(() => tick(), 1000)`. Cleared on unmount.

#### Element C: Ghost UI hints

Two static elements below the ticker, `margin-top: 8px`, non-interactive (cursor: default).

**Collapsed details row:**
```
padding: 10px 24px
"▸ Contract details" — chevron 11px #4B5563, text 13px #6B7280 Inter
```

**Contract Intelligence teaser:**
```
background: rgba(255,255,255,0.02)
border: 1px solid rgba(255,255,255,0.06)
border-radius: 6px
padding: 14px 24px
```
- Top row: `CONTRACT INTELLIGENCE` (JetBrains Mono, 11px, #10B981, uppercase, weight 700) + `▸ SHOW` right-aligned (10px, #4B5563)
- Below: `Powered by Claude · For informational purposes only · Not legal advice` (JetBrains Mono, 11px, #4B5563, italic)

---

## CSS Changes (`marketing.css`)

### Add

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}
```

### Remove (unused after card replacement)

All classes under the `CONTRACT CARD` section comment:
`.card-wrap`, `.card`, `.card::before/after`, `.card-scanline`, `.card-hero`, `.card-stripe`, `.card-row-1`, `.card-row-2`, `.card-row-3`, `.card-contract-name`, `.card-badge-sm`, `.card-badge-confirmed`, `.card-badge-saas`, `.card-badge-autorenew`, `.card-countdown-block`, `.card-days`, `.card-expires-sub`, `.card-parties`, `.card-notice-pill`, `.card-fact-strip`, `.fact-item`, `.fact-lbl`, `.fact-val`, `.fact-val-green`, `.prog-track`, `.prog-fill`, `.prog-labels`

The `.card-scanline` class is used in `countdown-timer.tsx` — remove from that component at the same time.

---

## Stagger Animation

The `data-hero-stagger="500"` wrapper div in `page.tsx` is preserved. `<HeroCard />` sits inside it, inheriting the existing entrance animation wired by `RevealObserver`. No changes to `RevealObserver` or the stagger system.

---

## Mobile

Below 768px: card stacks below headline and CTA, full-width. The existing `.hero-inner` grid already collapses to single-column on mobile — no new responsive CSS needed.

---

## Static Build Preservation

`page.tsx` remains a server component with no data fetching. Adding a `"use client"` component inside does not change the `○` static output. The `mounted` pattern ensures no hydration mismatch from dynamic dates.

---

## What is explicitly NOT in the hero card

- Effective date, notice period number, contract value, confidence score
- Progress bar / timeline
- Multiple badges (one only: notice deadline)
- Full d/h/m/s countdown (days in headline card; h:m:s in ticker only)
- Category labels (SAAS, etc.)
- CONFIRMED badge

---

## Verification Checklist

- [ ] Hero card has 3px left red stripe (#EF4444)
- [ ] Contract name left, days number (42px, red) right
- [ ] Parties line in muted text below name
- [ ] ONE badge: notice deadline ⚡ with amber styling
- [ ] Live ticker below card, ticking every second (h:m:s)
- [ ] Pulsing green dot + "TRACKING" label
- [ ] Ghost "▸ Contract details" row below ticker (non-interactive)
- [ ] Ghost "CONTRACT INTELLIGENCE" panel below (non-interactive)
- [ ] AI disclaimer visible in ghost panel
- [ ] Expiry date = today + 26 days (calculated at runtime)
- [ ] Notice deadline = expiry − 30 days
- [ ] Subhead: "Upload a contract. Get alerted before it auto-renews."
- [ ] No "CONTRACT INTELLIGENCE" label above the headline
- [ ] Trust line: "No credit card · Takes 60 seconds"
- [ ] Mobile: card stacks below headline, full-width
- [ ] Landing page builds as static (○)
- [ ] No Tailwind — all inline styles in HeroCard
- [ ] Dates/ticker hidden until mounted (no hydration mismatch)
- [ ] Old card CSS classes removed from marketing.css
