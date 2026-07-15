---
name: Landing page pain section rewrite
description: Replace two generic AI-generated incident boxes with a real founder story (r/msp $6k Microsoft anecdote), styled as a quoted block with a green left-border accent.
type: project
---

## Problem

The current "The problem" section on the landing page contains two `[ERR]` incident boxes with fabricated dollar amounts ($8,400 and $12,000) and generic copy ("Charged for software your team stopped using", "Negotiation window came and went"). This reads as AI-generated filler to the MSP/sysadmin audience and undermines trust in the product.

## Solution

Replace both incident boxes with a single founder story block using the real r/msp anecdote that inspired Renewl: someone missing Microsoft's renewal window by 12 hours, resulting in $6,000 in locked licenses.

## Design

### Section structure (before → after)

**Before:**
```
<div class="pain-header"> [tag + h2] </div>
<p class="pain-intro"> [...] </p>
<div class="incident-grid">
  <div class="incident"> $8,400 box </div>
  <div class="incident incident-amber"> $12,000 box </div>
</div>
```

**After:**
```
<div class="pain-header"> [tag + h2] </div>
<div style="border-left: 3px solid #10B981; padding-left: 24px; ...">
  [founder story paragraphs]
  <p><strong>I built Renewl to fix that.</strong></p>
  <p>— Dmitry, founder</p>
</div>
```

### Copy

**Section tag:** "The problem" (unchanged)

**H2:** "Most contract surprises are just deadlines nobody tracked" (unchanged)

**No pain-intro paragraph** — the story replaces it entirely.

**Quoted block (left green border, `#10B981`, 3px):**

> I'm a developer. I didn't lose money on a renewal — I read a post on r/msp about someone who missed Microsoft's renewal window by 12 hours. Three escalation tickets. $6,000 in licenses locked in for another year on software the team had stopped using. Microsoft didn't move. The window was 7 days, buried in the contract. Nobody on the team knew it existed.
>
> I kept reading. Same story, different vendors, a dozen times across r/msp and r/sysadmin. The problem isn't complexity — it's that notice windows are invisible until they're already closed.
>
> **I built Renewl to fix that.**
> — Dmitry, founder

### Visual treatment

- Left border: `3px solid #10B981`, `paddingLeft: 24px`
- Body text: `color: #9CA3AF`, `fontSize: 16px`, `lineHeight: 1.75`, Inter font
- Final bold line: `color: #F9FAFB`, `fontWeight: 700` — only bold text in the block
- Byline: `color: #6B7280`, `fontSize: 13px`, JetBrains Mono
- Remove `incident-grid`, both `.incident` divs, and `.pain-intro` paragraph entirely

### Founder note at bottom

The existing bottom founder note (`"I'm a developer. I noticed this problem kept coming up..."`) becomes redundant since the story now leads the pain section. Remove it entirely to avoid repetition.

### What stays untouched

- Outer `<section className="pain reveal" data-reveal="scale">` wrapper — keep as-is
- `pain-header` div including ghost "01", "The problem" tag, and h2 — keep as-is
- Everything after this section (HOW IT WORKS, PRICING, FINAL CTA, FOOTER) — unchanged

## Constraints

- Inline styles only (no Tailwind) — per Decision 004
- Use `var(--font-inter)` and `var(--font-jetbrains)` — per Decision 017
- No new components needed; this is JSX in `app/(marketing)/page.tsx`
