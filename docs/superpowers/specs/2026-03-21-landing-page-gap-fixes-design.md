# Landing Page Gap Fixes — Design Spec

**Date:** 2026-03-21
**File:** `marketing/index.html`
**Approach:** Surgical (Option B) — CSS enhancements + minimal HTML additions. No structural changes to any section.

---

## Background

The landing page was audited against the `frontend-design` skill. Four gaps were identified where the page fell short of the skill's standards. All fixes are additive — no sections are moved or restructured.

---

## Gap 1: Spatial Composition

**Problem:** Every section uses symmetric 2- or 3-column grids with no asymmetry, overlap, or grid-breaking elements.

**Fix — CSS only:**

- **Pain section:** Add a `::before` pseudo-element containing a large ghosted numeral ("01") positioned absolutely behind the `h2`, bleeding to the left edge. Creates layered depth without moving any elements.
- **Features grid:** Apply a vertical stagger — odd feature rows get `padding-top: 10px`, even rows `padding-top: 0`. Creates a brick-like offset within the existing 2-column grid.
- **Pricing pro card:** Apply `transform: translateY(-10px)` so the recommended tier "lifts" above the free tier, breaking flat alignment.

**Fix — minimal HTML:**

- **Steps:** Wrap each step number in a `<div class="step-num-wrap">`. Apply `margin-left: -24px` to overflow the left gutter and break the column edge. Adjust the connecting line pseudo-element accordingly.

---

## Gap 2: Hover States

**Problem:** Hover effects exist only on buttons. Content elements (incident cards, feature items, step numbers, pricing cards) have no interactivity.

**Fix — CSS only:**

- **Incident cards (`.incident:hover`):** Left border transitions from `rgba(224,72,72,0.3)` → `var(--danger)`. Background receives `rgba(224,72,72,0.04)` tint. `.incident-amt` gains a subtle `text-shadow` glow. Transition: `200ms ease`.
- **Step numbers (`.step:hover .step-num`):** Background fills with `var(--accent-dim)`. Border brightens to `var(--accent)`. `.step-title` slides `translateX(3px)`. Transition: `200ms ease`.
- **Pricing plans (`.plan:hover`):** `translateY(-4px)` lift with `box-shadow: 0 12px 40px rgba(0,0,0,0.4)`. Pro plan hover also adds accent border glow via `box-shadow` with accent color at low opacity.

**Fix — minimal HTML:**

- **Feature items:** Add `class="feat-icon-wrap"` wrapper around the icon square. On `.feat:hover .feat-icon-wrap`: border animates to accent, icon scales `1.08`. On `.feat:hover .feat-content`: `translateX(4px)`. Transition: `200ms ease`.

---

## Gap 3: Background Depth

**Problem:** Atmospheric background treatment (grain, grid texture, radial gradients) exists only in the hero. All other sections are flat dark surfaces.

**Fix — CSS only (all via `::before` pseudo-elements with `pointer-events: none`):**

- **Pain section:** Radial gradient centered behind incident grid: `radial-gradient(ellipse 60% 50% at 50% 80%, rgba(224,72,72,0.06), transparent)`. Applied via `.pain::before`.
- **How It Works section:** Faint diagonal stripe: `repeating-linear-gradient(135deg, var(--border) 0px, var(--border) 1px, transparent 1px, transparent 48px)` at `opacity: 0.08`.
- **Pricing section:** Same dot-grid pattern as hero but at `opacity: 0.12` and `background-size: 48px 48px`.
- **Final CTA section:** Radial glow behind email form: `radial-gradient(ellipse 50% 80% at 50% 50%, rgba(0,201,160,0.06), transparent)`.

All pseudo-elements use `position: absolute; inset: 0; pointer-events: none; z-index: 0` and their parent sections get `position: relative`.

---

## Gap 4: Scroll Reveal Animations

**Problem:** All `.reveal` elements use the same `translateY(26px) + opacity` with generic `ease`. Feels predictable.

**Fix — CSS + minimal HTML + minor JS:**

- **Easing:** Switch all reveal transitions from `ease` to `cubic-bezier(0.16, 1, 0.3, 1)` — snappier with character.
- **Section headers (h2 blocks):** Reveal with `scale(0.97) + opacity` instead of `translateY` — zoom-in feel for large text.
- **Directional reveals:** Add `data-reveal="left"` and `data-reveal="right"` attributes to alternate incident cards and feature items. Extend IntersectionObserver JS (~8 lines) to read the attribute and set initial transform accordingly (`translateX(-20px)` / `translateX(20px)`).
- **Incident amounts:** Use `translateX(-16px)` leftward slide — numbers appear to load in from the left margin.

**HTML changes:** ~15 `data-reveal` attribute additions. No structural changes.
**JS changes:** ~8 lines added to the existing IntersectionObserver callback.

---

## Constraints

- No section is moved or restructured
- No new external dependencies
- All changes are contained within `marketing/index.html`
- Mobile responsive behaviour is preserved (pseudo-element backgrounds have no impact on layout)
- Total HTML additions: ~20 lines across the file
- Total new CSS: ~80–100 lines added in a clearly delimited block
- Total new JS: ~10 lines

---

## Success Criteria

- Incident cards, feature items, step numbers, and pricing plans all have visible hover responses
- At least 3 sections beyond the hero have atmospheric background treatment
- Step number elements break the left column edge
- Pricing pro card is visually elevated above the free card
- Scroll reveals use varied directions and snappier easing
