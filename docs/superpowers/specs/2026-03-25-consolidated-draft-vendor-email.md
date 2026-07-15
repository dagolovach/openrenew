# Consolidated "Draft vendor email" — Design Spec

## Goal

Replace the per-finding draft buttons in the Contract Intelligence panel with a single "Draft vendor email →" button that sends all vendor-actionable findings to Claude and produces one combined email draft. Legal/info findings keep a copy-to-clipboard button as their only action.

---

## Design decisions (locked)

| Decision | Choice |
|---|---|
| Button placement | Single button at the panel footer, right-aligned, below the findings list |
| Output placement | Replaces the findings list (two-state panel) |
| Per-finding actions | Copy button only on legal/info findings; vendor-actionable findings have no individual button |
| Email tone | Claude infers from the mix of findings (see Tone inference below) |

---

## Finding category classification

### Vendor-actionable (no individual button — feed the draft)

`auto_renewal`, `price_escalation`, `notice_period`, `termination`, `payment_terms`

These are findings about commercial terms the user can negotiate or act on by contacting the vendor. They have no individual action buttons. They are collected and sent to Claude when the user clicks "Draft vendor email →".

### Legal/info (copy button only)

`liability`, `ip_ownership`, `data_privacy`, `exclusivity`, `governing_law`

Any category not in the vendor-actionable list falls here. These findings recommend involving legal counsel — a vendor email is not the right action. Each shows a small "Copy recommendation" button that copies `finding.action` to the clipboard.

If a panel has only legal/info findings and no vendor-actionable findings, the "Draft vendor email →" button is hidden entirely.

---

## Notice window badge

Displayed inline below the explanation text on `notice_period` and `auto_renewal` findings. Uses `contractContext.noticePeriodDays` and `contractContext.expiryDate`.

**Deadline date calculation:**
`deadlineDate = expiryDate minus noticePeriodDays`

**daysUntilDeadline = deadlineDate - today**

**States:**

| Condition | Display | Colour |
|---|---|---|
| `daysUntilDeadline > 0` | "Notice window closes in N days — act by [date]" | Amber `#F59E0B` |
| `daysUntilDeadline <= 0` | "Notice window closed [N] days ago" | Red `#EF4444` |

The closed case ("Notice window closed N days ago") must be passed to the tone inference logic so Claude can adjust the email framing from "let's discuss before the deadline" to "we've missed the window, here's how to proceed."

Badge style: JetBrains Mono, 11px, colour-only (no background or border-radius pill — plain coloured text inline below the finding explanation). The existing `noticeWindowBadge()` helper uses plain text with no box style; keep that approach.

---

## Panel state machine

The panel has one top-level `panelState`:

```
"findings"   → initial state — findings list + "Draft vendor email →" button
"drafting"   → loading state — findings hidden, pulsing dot + "Drafting…"
"draft_done" → draft view — subject, body, "Copy email" button, disclaimer
"draft_error"→ error state — error message + "← Back to findings" link (no retry button)
```

State transitions:
- `findings` → `drafting` on button click
- `drafting` → `draft_done` on success
- `drafting` → `draft_error` on failure
- `draft_done` → `findings` on "← Back to findings"
- `draft_error` → `findings` on "← Back to findings"

No re-fetch when returning to findings — findings are already in component state.

---

## "Draft vendor email →" button

- Placement: panel footer, right-aligned, separated from findings by a `1px solid rgba(255,255,255,0.06)` divider
- Only rendered when there is at least one vendor-actionable finding
- Label: `Draft vendor email →`
- Style: JetBrains Mono, 12px, `#10B981`, border `1px solid rgba(16,185,129,0.3)`, border-radius 3px, padding `5px 12px`, transparent background
- Disabled (opacity 0.5, cursor default) when `panelState === "drafting"`

---

## Draft view layout

Replaces the findings list entirely when `panelState === "draft_done"`.

### Header (same as findings view header, modified)
- Left: `CONTRACT INTELLIGENCE` label (unchanged)
- Right: `← Back to findings` link — 12px, `#6B7280`, cursor pointer — sets `panelState` back to `"findings"`

### Subject section
- Label: `SUBJECT` in uppercase mono, `#4B5563`, 10px
- Value: subject line text, 13px, `#F9FAFB`
- Separated by `1px solid rgba(255,255,255,0.06)` below

### Body section
- Label: `BODY` in uppercase mono, `#4B5563`, 10px
- Body text: JetBrains Mono, 12px, `#9CA3AF`, line-height 1.6, preserves newlines (use `white-space: pre-wrap`)
- Separated by `1px solid rgba(255,255,255,0.06)` below

### Copy email button
- Right-aligned row below the body section
- Label: `Copy email` (changes to `✓ Copied` for 1.5s after click, then resets)
- Copies `Subject: {subject}\n\n{body}` to clipboard
- Same style as "Draft vendor email →" button

### Disclaimer footer
- Same as findings view: `Powered by Claude · For informational purposes only · Not legal advice`
- JetBrains Mono, 10px, `#4B5563`, italic
- **Must be present in draft view** — the user may send this text verbatim

### Draft error state
When `panelState === "draft_error"`:
- Show error message: 12px, `#EF4444`, JetBrains Mono
- Show `← Back to findings` link (same as draft_done header)
- No retry button — back link returns to findings where they can try again

---

## Tone inference logic (Python service)

Implemented in `python-service/main.py` in the `/draft-action-email` endpoint.

Claude receives all vendor-actionable findings and the contract context. The prompt instructs Claude to apply this tone logic:

**Cancellation notice tone** — when all findings are exit-related:
- All categories in `{termination, auto_renewal}`
- Frame: formal notice of intent not to renew, reference notice period and deadline

**Renegotiation tone** — when all findings are terms-related:
- All categories in `{price_escalation, payment_terms, notice_period}`
- Frame: request to review and renegotiate specific clauses before renewal

**Mixed tone (default)** — when findings span both groups:
- Frame: "we are evaluating whether to continue and need to discuss the following before making a decision"
- Covers both exit and terms concerns without committing to either

**Notice window closed modifier** — applies on top of any tone:
- When `noticeWindowClosed: true` is passed in the request
- Add framing: "we are aware the formal notice window has passed, and we would like to discuss our options"
- Adjust from deadline-urgent to remediation-oriented language

---

## API changes

### `app/api/finding-action/route.ts`

**Remove:** `handleSetReminder` and its `set_reminder` branch — this function is still present in the current codebase (`app/api/finding-action/route.ts`) and must be deleted. Also simplify the Zod `action_type` enum (currently `["draft_email", "set_reminder"]`) — the route now accepts only one request shape so `action_type` can be dropped entirely.

**Update `handleDraftEmail`:**
- Accept `findings: Finding[]` (array) instead of a single `finding`
- Accept `notice_window_closed: boolean` in `contract_context`
- Forward all findings to Python `/draft-action-email`
- Remove the `action_type: "draft_email"` wrapper — the route only does one thing now; simplify body schema

**Updated Zod schema:**

```typescript
const bodySchema = z.object({
  contract_id: z.string().uuid(),
  findings: z.array(z.object({
    category: z.string(),
    title: z.string(),
    explanation: z.string(),
    action: z.string().nullable(),
  })).min(1),
  contract_context: z.object({
    name: z.string(),
    party_a: z.string().nullable(),
    party_b: z.string().nullable(),
    expiry_date: z.string().nullable(),
    renewal_date: z.string().nullable(),
    auto_renew: z.boolean().nullable(),
    notice_period_days: z.number().nullable(),
    contract_value: z.string().nullable(),
    category: z.string(),
    notice_window_closed: z.boolean(),
  }),
});
```

Contract ownership check remains: verify `contract_id` belongs to the authenticated user before calling Python.

### `python-service/main.py`

**Update `DraftEmailRequest` Pydantic model:**
- `findings: list[FindingItem]` (new nested model) instead of single finding fields
- `notice_window_closed: bool = False` in contract context

**Update `/draft-action-email`:**
- Derive tone category from findings list (see Tone inference above)
- Build a prompt that lists all findings and applies the correct tone
- Return `{subject, body, disclaimer}` — same response shape

---

## What is changing in `noticeWindowBadge()`

The existing helper renders open-case text as "Notice deadline in N days (date)" — this must be updated to match the agreed wording. Both text strings must change:

- Open case (`daysUntilDeadline > 0`): `"Notice window closes in N days — act by [date]"` — amber `#F59E0B`
- Closed today (`daysUntilDeadline === 0`): `"Notice window closed today"` — red `#EF4444`
- Closed past (`daysUntilDeadline < 0`): `"Notice window closed N days ago"` — red `#EF4444`

"Closed today" is a special case — "closed 0 days ago" is technically correct but reads awkwardly. Keep it as a distinct string.

The `daysLeft <= 0` check for "closed" may already exist; verify and add if missing.

## `noticeWindowClosed` derivation

`noticeWindowClosed` is a boolean derived at the point the "Draft vendor email →" button is clicked, not stored in state. Compute it inline before calling the API:

```typescript
const deadlineDate = contractContext.expiryDate && contractContext.noticePeriodDays
  ? new Date(new Date(contractContext.expiryDate + "T00:00:00Z").getTime()
      - contractContext.noticePeriodDays * 86400000)
  : null;
const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const noticeWindowClosed = deadlineDate !== null && deadlineDate <= today;
```

This keeps the same midnight-UTC normalisation used everywhere else in the codebase (`lib/utils.ts`). `noticeWindowClosed` is then included in the `contract_context` object sent to `/api/finding-action`.

## What is NOT changing

- The panel header and finding row rendering — same as current
- The disclaimer text and position in the findings view
- `ContractContext` type — no new fields added to the type; `noticeWindowClosed` is derived at call-time (see above)
- `FindingRow` rendering — same icons, severity, explanation text
- The `ContractIntelligencePanel` props — `contractId` and `contractContext` unchanged

---

## Out of scope

- Editing the draft inline before copying (user edits in their email client)
- Sending the email from Renewl
- Per-finding draft after this change (removed entirely)
- Slack draft (separate feature)
