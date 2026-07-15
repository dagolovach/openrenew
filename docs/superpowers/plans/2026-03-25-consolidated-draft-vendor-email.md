# Consolidated "Draft vendor email" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-finding draft buttons in the Contract Intelligence panel with a single "Draft vendor email →" panel-level button that sends all vendor-actionable findings to Claude and returns one combined email draft.

**Architecture:** Three files change in sequence — Python service first (new multi-finding model + tone inference), then the Next.js API route (simplified schema, remove set_reminder), then the React panel (remove FindingActions, update FindingRow, add two-state panel with draft view). No new files created.

**Tech Stack:** Python FastAPI + Pydantic (python-service), Next.js 16 Route Handler + Zod (app/api), React 18 + inline styles only, no Tailwind (components)

---

## File map

| File | Change |
|---|---|
| `python-service/main.py` | Replace `DraftEmailRequest` + `draft_with_claude()` — multi-finding, tone inference |
| `app/api/finding-action/route.ts` | Full rewrite — simplified Zod schema, findings array, remove `handleSetReminder` |
| `components/contracts/ContractIntelligencePanel.tsx` | Remove `FindingActions`; update `FindingRow`; fix `noticeWindowBadge` text; add panel-level draft state + "Draft vendor email →" button + draft view |

---

## Task 1: Python service — multi-finding DraftEmailRequest + tone inference

**Files:**
- Modify: `python-service/main.py:192-204` (DraftEmailRequest model)
- Modify: `python-service/main.py:260-326` (draft_with_claude function)

The existing `DraftEmailRequest` takes a single finding and an explicit `action_type` literal. Replace it with a model that takes a list of findings and derives tone automatically.

- [ ] **Step 1: Replace `DraftEmailRequest` and add `FindingItem` model**

Find the existing `DraftEmailRequest` class (line 192) and replace it. Add `FindingItem` immediately before it:

```python
class FindingItem(BaseModel):
    category: str
    title: str
    explanation: str
    action: Optional[str] = None


class DraftEmailRequest(BaseModel):
    contract_name: str
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    expiry_date: Optional[str] = None
    renewal_date: Optional[str] = None
    notice_period_days: Optional[int] = None
    contract_value: Optional[str] = None
    category: Optional[str] = None
    notice_window_closed: bool = False
    findings: list[FindingItem]
```

Note: `action_type` is gone — tone is now derived from the findings list inside `draft_with_claude`.

- [ ] **Step 2: Replace `draft_with_claude()`**

Find the existing `draft_with_claude` function (line 260) and replace it entirely:

```python
_EXIT_CATEGORIES = {"termination", "auto_renewal"}
_TERMS_CATEGORIES = {"price_escalation", "payment_terms", "notice_period"}


def draft_with_claude(req: DraftEmailRequest) -> dict:
    """Generate a professional email draft covering all vendor-actionable findings."""
    categories = {f.category for f in req.findings}

    # Tone inference: all exit → cancellation; all terms → renegotiation; mix → evaluating
    is_all_exit = categories.issubset(_EXIT_CATEGORIES)
    is_all_terms = categories.issubset(_TERMS_CATEGORIES)

    if is_all_exit:
        objective = (
            "clearly communicate that the customer does not intend to renew or continue "
            "this contract, and request written confirmation of cancellation"
        )
    elif is_all_terms:
        objective = (
            "open a professional dialogue to renegotiate the terms highlighted below "
            "before the contract renews"
        )
    else:
        objective = (
            "communicate that the customer is evaluating whether to continue and needs "
            "to discuss the following issues before making a decision"
        )

    notice_modifier = ""
    if req.notice_window_closed:
        notice_modifier = (
            "\nIMPORTANT: The formal notice window has already passed. "
            "The email should acknowledge this and focus on discussing options and "
            "next steps rather than meeting a deadline."
        )

    findings_text = "\n".join(
        f"- {f.title}: {f.explanation}"
        + (f" (Recommended action: {f.action})" if f.action else "")
        for f in req.findings
    )

    relevant_date = req.renewal_date or req.expiry_date

    prompt = f"""You are helping a customer draft a professional email to their vendor/provider.

Contract details:
- Contract name: {req.contract_name}
- Vendor / Party A: {req.party_a or 'the vendor'}
- Customer / Party B: {req.party_b or 'the customer'}
- Category: {req.category or 'service contract'}
- Contract value: {req.contract_value or 'not stated'}
- Key date: {relevant_date or 'not specified'}
- Notice period: {f"{req.notice_period_days} days" if req.notice_period_days else "not stated"}{notice_modifier}

Issues identified in this contract:
{findings_text}

Write a professional email from the customer to the vendor that:
- Objective: {objective}
- Addresses all the issues listed above
- Mentions relevant dates where applicable
- Is firm but professional in tone
- Is 3-5 paragraphs, no bullet points
- Does NOT pretend to be legal advice

Return ONLY a JSON object with two fields:
- "subject": the email subject line
- "body": the full email body text (plain text, use \\n for newlines)

Output ONLY the JSON object. No other text."""

    client = anthropic.Anthropic()
    response = client.messages.create(
        model=ANALYSIS_MODEL,
        max_tokens=1024,
        messages=[{"role": "user", "content": prompt}],
    )
    try:
        content = response.content[0].text.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        if not isinstance(result, dict) or "subject" not in result or "body" not in result:
            raise ValueError("Missing subject or body fields")
        return {
            "subject": str(result["subject"]),
            "body": str(result["body"]),
            "disclaimer": "For informational purposes only. Not legal advice.",
        }
    except (AttributeError, IndexError, TypeError, json.JSONDecodeError, ValueError) as e:
        raise ExtractionError(
            status_code=503,
            error="draft_failed",
            detail=f"Claude did not return valid JSON: {e}",
        )
```

- [ ] **Step 3: Update the endpoint log line**

The `/draft-action-email` endpoint handler (line 478) logs `req.action_type` which no longer exists. Update that log line:

```python
# old:
print(f"[draft-action-email] action_type={req.action_type} contract={req.contract_name[:40]}", flush=True)
# new:
print(f"[draft-action-email] findings={len(req.findings)} contract={req.contract_name[:40]}", flush=True)
```

- [ ] **Step 4: Verify no remaining `req.action_type` references and Python parses cleanly**

```bash
grep -n "req\.action_type" python-service/main.py
```

Expected: no output. If any lines appear, fix them before continuing.

```bash
cd python-service && python -c "import main; print('OK')"
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add python-service/main.py
git commit -m "feat: multi-finding DraftEmailRequest with tone inference"
```

---

## Task 2: Next.js API route — simplified schema, remove set_reminder

**Files:**
- Modify: `app/api/finding-action/route.ts` (full rewrite)

The current route has `action_type: z.enum(["draft_email", "set_reminder"])`, a single `finding` object, and a `handleSetReminder` function. Replace the whole file with a simplified version: findings array, no action_type enum, no set_reminder.

- [ ] **Step 1: Rewrite `app/api/finding-action/route.ts`**

Replace the entire file with:

```typescript
// app/api/finding-action/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  contract_id: z.string().uuid(),
  findings: z
    .array(
      z.object({
        category: z.string(),
        title: z.string(),
        explanation: z.string(),
        action: z.string().nullable(),
      })
    )
    .min(1),
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

export async function POST(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { contract_id, findings, contract_context } = parsed.data;

  // Verify the authenticated user owns this contract (defence in depth alongside RLS)
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contract_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const secret = process.env.EXTRACTION_SERVICE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Service not configured" }, { status: 500 });
  }

  const payload = {
    contract_name: contract_context.name,
    party_a: contract_context.party_a,
    party_b: contract_context.party_b,
    expiry_date: contract_context.expiry_date,
    renewal_date: contract_context.renewal_date,
    notice_period_days: contract_context.notice_period_days,
    contract_value: contract_context.contract_value,
    category: contract_context.category,
    notice_window_closed: contract_context.notice_window_closed,
    findings: findings.map((f) => ({
      category: f.category,
      title: f.title,
      explanation: f.explanation,
      action: f.action,
    })),
  };

  try {
    const res = await fetch(`${pythonUrl}/draft-action-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[finding-action] Python draft failed:", res.status, err);
      return NextResponse.json({ error: "Draft generation failed" }, { status: 502 });
    }

    const draft = await res.json();
    return NextResponse.json(draft);
  } catch (e) {
    console.error("[finding-action] Python service unreachable:", e);
    return NextResponse.json({ error: "Draft generation failed" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output (zero errors). Fix any errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add app/api/finding-action/route.ts
git commit -m "feat: simplify finding-action route — findings array, remove set_reminder"
```

---

## Task 3: ContractIntelligencePanel — full panel refactor

**Files:**
- Modify: `components/contracts/ContractIntelligencePanel.tsx` (substantial changes throughout)

This is the largest task. Make all changes in the order below to avoid TypeScript errors mid-edit.

### Changes overview
1. Add `VENDOR_ACTIONABLE` constant (set of category strings with no per-finding buttons)
2. Fix `noticeWindowBadge()` open-case text
3. Remove `DraftState` type (draft state moves to panel level)
4. Remove `FindingActions` component entirely
5. Update `FindingRow` — copy button only for non-vendor-actionable findings
6. Add panel-level state + `handleDraftEmail` inside `ContractIntelligencePanel`
7. Add "Draft vendor email →" footer button (findings view)
8. Add draft content views (drafting / draft_done / draft_error)

---

- [ ] **Step 1: Add `VENDOR_ACTIONABLE` constant**

Add this immediately after the `ICON_MAP` constant (after line 46 in the current file):

```typescript
// Categories handled by the consolidated draft button — no per-finding action buttons
const VENDOR_ACTIONABLE = new Set([
  "auto_renewal",
  "price_escalation",
  "notice_period",
  "termination",
  "payment_terms",
]);
```

- [ ] **Step 2: Fix `noticeWindowBadge()` open-case text**

The current open-case return (line 76–80) reads `"Notice deadline in {daysLeft} days ({deadlineLabel})"`. Change it to match the agreed wording:

```typescript
  return (
    <span style={{ color: "#F59E0B", fontSize: "11px", fontFamily: "var(--font-jetbrains), monospace" }}>
      Notice window closes in {daysLeft} days — act by {deadlineLabel}
    </span>
  );
```

The closed-case text currently reads `⚠ Notice window closed today` / `⚠ Notice window closed N days ago` — the `⚠` prefix is not in the spec. Remove it. The corrected closed-case return should be:

```typescript
  if (daysLeft <= 0) {
    return (
      <span style={{ color: "#EF4444", fontSize: "11px", fontFamily: "var(--font-jetbrains), monospace" }}>
        {daysLeft < 0 ? `Notice window closed ${Math.abs(daysLeft)} days ago` : "Notice window closed today"}
      </span>
    );
  }
```

- [ ] **Step 3: Remove `DraftState` type and `FindingActions` component**

Delete these blocks entirely (lines 150–378 in the current file):
- `type DraftState = ...` (lines 150–154)
- The entire `function FindingActions(...)` component including its closing brace (lines 156–378)

After deletion, `CopyAction` should be immediately followed by `FindingRow`.

- [ ] **Step 4: Update `FindingRow` — copy-only for legal/info findings**

In `FindingRow`, remove the `<FindingActions .../>` call and replace the copy button logic:

Current `FindingRow` shows `noticeWindowBadge` and then `<FindingActions .../>`. Replace it so it only shows `CopyAction` when the finding is NOT vendor-actionable:

```typescript
function FindingRow({
  finding,
  contractContext,
}: {
  finding: Finding;
  contractContext: ContractContext | undefined;
}) {
  const { icon, color } = ICON_MAP[finding.type];
  const showBadge =
    finding.category === "notice_period" || finding.category === "auto_renewal";
  const showCopy = !VENDOR_ACTIONABLE.has(finding.category) && !!finding.action;

  return (
    <div
      style={{
        display: "flex",
        gap: "12px",
        padding: "14px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span style={{ color, fontSize: "14px", flexShrink: 0, marginTop: "1px", fontFamily: "var(--font-jetbrains), monospace" }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "14px",
            fontWeight: 700,
            color: "#F9FAFB",
            marginBottom: "4px",
            letterSpacing: "0.02em",
          }}
        >
          {finding.title}
        </div>
        <div
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#6B7280",
            lineHeight: 1.5,
            marginBottom: showBadge || showCopy ? "6px" : 0,
          }}
        >
          {finding.explanation}
        </div>
        {showBadge && (
          <div style={{ marginBottom: showCopy ? "6px" : 0 }}>
            {noticeWindowBadge(contractContext)}
          </div>
        )}
        {showCopy && <CopyAction text={finding.action!} />}
      </div>
    </div>
  );
}
```

Note: `contractId` is removed from `FindingRow` props — it's no longer needed since there's no per-finding API call.

- [ ] **Step 5: Update `FindingRow` call sites in `ContractIntelligencePanel`**

In the findings map at the bottom of `ContractIntelligencePanel`, remove `contractId` from `FindingRow`:

```tsx
{findings.map((finding, i) => (
  <FindingRow
    key={`${finding.category}-${i}`}
    finding={finding}
    contractContext={contractContext}
  />
))}
```

- [ ] **Step 6: Add panel-level state and `handleDraftEmail`**

Add `PanelDraftState` at **module scope** (immediately after `VENDOR_ACTIONABLE`, before `noticeWindowBadge`):

```typescript
type PanelDraftState =
  | { mode: "findings" }
  | { mode: "drafting" }
  | { mode: "draft_done"; subject: string; body: string }
  | { mode: "draft_error"; message: string };
```

Then inside `ContractIntelligencePanel` (after the existing `const [isOpen, setIsOpen] = useState(false);`), add:

```typescript
  const [panelDraft, setPanelDraft] = useState<PanelDraftState>({ mode: "findings" });
  const [copyEmailDone, setCopyEmailDone] = useState(false);

  async function handleDraftEmail() {
    if (!contractContext) return;

    const vendorFindings = findings.filter((f) => VENDOR_ACTIONABLE.has(f.category));
    if (vendorFindings.length === 0) return;

    // Derive noticeWindowClosed at call-time — same midnight-UTC logic as lib/utils.ts
    const deadlineDate =
      contractContext.expiryDate && contractContext.noticePeriodDays
        ? new Date(
            new Date(contractContext.expiryDate + "T00:00:00Z").getTime() -
              contractContext.noticePeriodDays * 86400000
          )
        : null;
    const todayUTC = new Date();
    todayUTC.setUTCHours(0, 0, 0, 0);
    const noticeWindowClosed = deadlineDate !== null && deadlineDate <= todayUTC;

    setPanelDraft({ mode: "drafting" });

    try {
      const res = await fetch("/api/finding-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: contractId,
          findings: vendorFindings.map((f) => ({
            category: f.category,
            title: f.title,
            explanation: f.explanation,
            action: f.action,
          })),
          contract_context: {
            name: contractContext.name,
            party_a: contractContext.partyA,
            party_b: contractContext.partyB,
            expiry_date: contractContext.expiryDate,
            renewal_date: contractContext.renewalDate,
            auto_renew: contractContext.autoRenew,
            notice_period_days: contractContext.noticePeriodDays,
            contract_value: contractContext.contractValue,
            category: contractContext.category,
            notice_window_closed: noticeWindowClosed,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setPanelDraft({ mode: "draft_error", message: err.error ?? "Draft generation failed" });
        return;
      }
      const data = await res.json();
      setPanelDraft({ mode: "draft_done", subject: data.subject, body: data.body });
    } catch {
      setPanelDraft({ mode: "draft_error", message: "Network error — please try again" });
    }
  }
```

- [ ] **Step 7: Replace the "findings" status render with the two-state panel**

This is the final and largest JSX change. Replace the entire `// ── Findings state` block (from `const hasWarnings = findings.some(...)` to the end of the component) with:

```typescript
  // ── Findings state ────────────────────────────────────────────────────────
  const hasWarnings = findings.some((f) => f.type === "warning");
  const hasVendorFindings = findings.some((f) => VENDOR_ACTIONABLE.has(f.category));
  const isDraftMode = panelDraft.mode !== "findings";

  const actionButtonBase: React.CSSProperties = {
    fontFamily: "var(--font-jetbrains), monospace",
    fontSize: "12px",
    letterSpacing: "0.04em",
    border: "1px solid rgba(16,185,129,0.3)",
    borderRadius: "3px",
    padding: "5px 12px",
    background: "transparent",
    color: "#10B981",
    cursor: "pointer",
    transition: "border-color 150ms ease, color 150ms ease",
  };

  const loadingDot = (
    <span
      style={{
        display: "inline-block",
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "#10B981",
        animation: "pulse 1.4s ease-in-out infinite",
        marginRight: "6px",
        verticalAlign: "middle",
      }}
    />
  );

  const backLink = (
    <span
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "12px",
        color: "#6B7280",
        cursor: "pointer",
        letterSpacing: "0.04em",
      }}
      onClick={() => {
        setPanelDraft({ mode: "findings" });
        setCopyEmailDone(false);
      }}
    >
      ← Back to findings
    </span>
  );

  const findingsHeader = (
    <div
      style={{ ...headerBaseStyle, cursor: "pointer" }}
      onClick={() => setIsOpen((o) => !o)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={labelStyle}>Contract Intelligence</span>
        {!hasWarnings && (
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              color: "#4B5563",
              letterSpacing: "0.06em",
            }}
          >
            No critical flags
          </span>
        )}
      </div>
      <span style={toggleStyle}>{isOpen ? "▾ HIDE" : "▸ SHOW"}</span>
    </div>
  );

  const draftHeader = (
    <div style={headerBaseStyle}>
      <span style={labelStyle}>Contract Intelligence</span>
      {backLink}
    </div>
  );

  return (
    <PanelShell header={isDraftMode ? draftHeader : findingsHeader}>
      {isDraftMode ? (
        <>
          {panelDraft.mode === "drafting" && (
            <div
              style={{
                padding: "24px 20px",
                display: "flex",
                alignItems: "center",
                gap: "10px",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "13px",
                color: "#4B5563",
              }}
            >
              {loadingDot}
              Drafting…
            </div>
          )}

          {panelDraft.mode === "draft_done" && (
            <div style={{ padding: "0 20px 4px" }}>
              {/* Subject */}
              <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "10px",
                    letterSpacing: "0.1em",
                    color: "#4B5563",
                    textTransform: "uppercase",
                    marginBottom: "6px",
                  }}
                >
                  Subject
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "13px",
                    color: "#F9FAFB",
                  }}
                >
                  {panelDraft.subject}
                </div>
              </div>

              {/* Body */}
              <div style={{ padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "10px",
                    letterSpacing: "0.1em",
                    color: "#4B5563",
                    textTransform: "uppercase",
                    marginBottom: "6px",
                  }}
                >
                  Body
                </div>
                <pre
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "12px",
                    color: "#9CA3AF",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    lineHeight: 1.6,
                  }}
                >
                  {panelDraft.body}
                </pre>
              </div>

              {/* Copy email button */}
              <div style={{ padding: "12px 0", display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={() => {
                    if (panelDraft.mode !== "draft_done") return;
                    const text = `Subject: ${panelDraft.subject}\n\n${panelDraft.body}`;
                    navigator.clipboard.writeText(text).then(() => {
                      setCopyEmailDone(true);
                      setTimeout(() => setCopyEmailDone(false), 1500);
                    });
                  }}
                  style={actionButtonBase}
                >
                  {copyEmailDone ? "✓ Copied" : "Copy email"}
                </button>
              </div>
            </div>
          )}

          {panelDraft.mode === "draft_error" && (
            <div
              style={{
                padding: "20px",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "12px",
                color: "#EF4444",
              }}
            >
              {panelDraft.message}
            </div>
          )}
        </>
      ) : (
        <>
          {isOpen && (
            <div style={{ padding: "0 20px 4px" }}>
              {findings.map((finding, i) => (
                <FindingRow
                  key={`${finding.category}-${i}`}
                  finding={finding}
                  contractContext={contractContext}
                />
              ))}
            </div>
          )}

          {/* Draft vendor email button — only when panel is open and vendor findings exist */}
          {isOpen && hasVendorFindings && (
            <div
              style={{
                padding: "10px 20px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                onClick={handleDraftEmail}
                disabled={panelDraft.mode === "drafting"}
                style={{
                  ...actionButtonBase,
                  opacity: panelDraft.mode === "drafting" ? 0.5 : 1,
                  cursor: panelDraft.mode === "drafting" ? "default" : "pointer",
                }}
              >
                Draft vendor email →
              </button>
            </div>
          )}
        </>
      )}
      <Disclaimer />
    </PanelShell>
  );
}
```

- [ ] **Step 8: Verify TypeScript is clean**

```bash
npx tsc --noEmit
```

Expected: no output. Fix any errors before committing. Common issues to watch for:
- `panelDraft.subject` / `panelDraft.body` accessed outside the `draft_done` mode guard (TypeScript will catch this — the inline `onClick` handler needs the mode check shown above)
- `contractId` still referenced in removed `FindingActions` code — make sure it's gone entirely

- [ ] **Step 9: Commit**

```bash
git add components/contracts/ContractIntelligencePanel.tsx
git commit -m "feat: two-state panel with consolidated Draft vendor email button"
```

---

## Final verification

- [ ] Run TypeScript check one last time across the whole project:

```bash
npx tsc --noEmit
```

- [ ] Verify Python service still imports cleanly:

```bash
cd python-service && python -c "import main; print('OK')"
```

- [ ] Manual smoke test (if Python service is running locally):
  1. Open a confirmed contract with at least one `auto_renewal` or `price_escalation` finding
  2. Expand the Contract Intelligence panel
  3. Confirm "Draft vendor email →" button appears at the bottom
  4. Click it — panel should show pulsing dot + "Drafting…"
  5. After response, panel should show draft view with subject + body + "Copy email" button
  6. Click "← Back to findings" — findings list should reappear without re-fetching
  7. For a contract with only `liability` findings: verify no "Draft vendor email →" button appears, only "Copy recommendation" per finding
