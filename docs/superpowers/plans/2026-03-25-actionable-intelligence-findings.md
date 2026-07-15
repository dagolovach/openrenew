# Actionable Intelligence Findings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform each AI finding in the Contract Intelligence panel into an actionable item — auto_renewal/termination findings get "Draft cancellation notice", notice_period gets "Set reminder", price_escalation/payment_terms get "Draft renegotiation email", and legal categories keep the existing copy-to-clipboard.

**Architecture:** A new Python endpoint `/draft-action-email` generates professional email drafts using Claude Haiku. A new Next.js route `POST /api/finding-action` handles both `draft_email` (proxies to Python) and `set_reminder` (inserts a `notice_deadline` alert row). The `ContractIntelligencePanel` gains a `contractContext` prop so it has contract data to populate prompts and compute the notice window badge. UI state for draft loading/display/error lives in `FindingRow`.

**Tech Stack:** FastAPI + Pydantic (Python), Next.js App Router + Zod (TypeScript), Supabase sessionClient (alert insert), Claude Haiku via Anthropic SDK (email drafting)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `python-service/main.py` | Modify | Add `DraftEmailRequest` model, `draft_with_claude()` helper, `/draft-action-email` route |
| `app/api/finding-action/route.ts` | Create | Auth, Zod validation, `draft_email` (proxy to Python) and `set_reminder` (alert insert) |
| `components/contracts/ContractIntelligencePanel.tsx` | Modify | Add `ContractContext` type, `contractContext` prop, `FindingActions` component, email draft panel UI, notice window badge, reminder confirmation state |
| `components/contracts/ContractDetailClient.tsx` | Modify | Pass `contractContext` to `ContractIntelligencePanel` |

---

## Task 1: Python `/draft-action-email` endpoint

**Files:**
- Modify: `python-service/main.py`

- [ ] **Step 1: Add `DraftEmailRequest` Pydantic model after the `AnalyseRequest` model (around line 190)**

```python
class DraftEmailRequest(BaseModel):
    action_type: str  # 'cancellation_notice' or 'renegotiation'
    contract_name: str
    party_a: Optional[str] = None
    party_b: Optional[str] = None
    expiry_date: Optional[str] = None
    renewal_date: Optional[str] = None
    notice_period_days: Optional[int] = None
    contract_value: Optional[str] = None
    category: Optional[str] = None
    finding_title: str
    finding_explanation: str
    finding_action: Optional[str] = None
```

- [ ] **Step 2: Add `draft_with_claude()` helper after `analyse_with_claude()` (before the FastAPI app setup)**

```python
def draft_with_claude(req: DraftEmailRequest) -> dict:
    """Generate a professional email draft based on finding context."""
    if req.action_type == "cancellation_notice":
        email_type = "cancellation / non-renewal notice"
        objective = "clearly communicate that the customer does not intend to renew or continue this contract, and request written confirmation of cancellation"
    else:  # renegotiation
        email_type = "renegotiation request"
        objective = "open a professional dialogue to renegotiate the terms highlighted in the finding"

    relevant_date = req.renewal_date or req.expiry_date

    prompt = f"""You are helping a customer draft a professional {email_type} email to their vendor/provider.

Contract details:
- Contract name: {req.contract_name}
- Vendor / Party A: {req.party_a or 'the vendor'}
- Customer / Party B: {req.party_b or 'the customer'}
- Category: {req.category or 'service contract'}
- Contract value: {req.contract_value or 'not stated'}
- Key date: {relevant_date or 'not specified'}
- Notice period: {f"{req.notice_period_days} days" if req.notice_period_days else "not stated"}

Finding that triggered this email:
- Issue: {req.finding_title}
- Detail: {req.finding_explanation}
- Suggested action: {req.finding_action or 'not specified'}

Write a professional {email_type} email. The email should:
- Be from the customer ({req.party_b or 'Customer'}) to the vendor ({req.party_a or 'Vendor'})
- Objective: {objective}
- Reference the specific issue from the finding above
- Mention relevant dates where applicable
- Be firm but professional in tone
- Be 3-5 paragraphs, no bullet points
- NOT pretend to be legal advice

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

- [ ] **Step 3: Add `/draft-action-email` route at the end of `main.py` (after the `/analyse` route)**

```python
@app.post("/draft-action-email")
async def draft_action_email(req: DraftEmailRequest, _: None = Depends(verify_auth)):
    print(f"[draft-action-email] action_type={req.action_type} contract={req.contract_name[:40]}", flush=True)
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(draft_with_claude, req),
            timeout=CLAUDE_TIMEOUT,
        )
    except asyncio.TimeoutError:
        raise ExtractionError(504, "claude_timeout", f"Claude API exceeded {CLAUDE_TIMEOUT}s")
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(503, "draft_failed", str(e))
    return result
```

- [ ] **Step 4: Manual smoke test (requires running Python service locally)**

```bash
# Start service: cd python-service && uvicorn main:app --reload --port 8000
curl -X POST http://localhost:8000/draft-action-email \
  -H "Authorization: Bearer <EXTRACTION_SERVICE_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "action_type": "cancellation_notice",
    "contract_name": "Acme SaaS Agreement",
    "party_a": "Acme Corp",
    "party_b": "CustomerCo",
    "expiry_date": "2026-06-30",
    "notice_period_days": 30,
    "contract_value": "$12,000/year",
    "category": "saas",
    "finding_title": "Auto-renewal in 60 days",
    "finding_explanation": "Contract auto-renews unless cancelled 30 days before expiry.",
    "finding_action": "Send cancellation notice before 31 May 2026"
  }'
```

Expected: JSON response with `subject`, `body`, `disclaimer` fields (no error).

- [ ] **Step 5: Commit**

```bash
git add python-service/main.py
git commit -m "feat: add /draft-action-email endpoint to Python service"
```

---

## Task 2: `POST /api/finding-action` Next.js route

**Files:**
- Create: `app/api/finding-action/route.ts`

- [ ] **Step 1: Create `app/api/finding-action/route.ts` with auth + Zod schema**

```typescript
// app/api/finding-action/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const findingSchema = z.object({
  category: z.string(),
  title: z.string(),
  explanation: z.string(),
  action: z.string().nullable(),
});

const contractContextSchema = z.object({
  name: z.string(),
  party_a: z.string().nullable(),
  party_b: z.string().nullable(),
  expiry_date: z.string().nullable(),
  renewal_date: z.string().nullable(),
  auto_renew: z.boolean().nullable(),
  notice_period_days: z.number().nullable(),
  contract_value: z.string().nullable(),
  category: z.string(),
});

const bodySchema = z.object({
  action_type: z.enum(["draft_email", "set_reminder"]),
  contract_id: z.string().uuid(),
  finding: findingSchema,
  contract_context: contractContextSchema,
});
```

- [ ] **Step 2: Add `draft_email` handler — proxy to Python service**

Note: `handleDraftEmail` receives `sessionClient` and `userId` so it can verify contract ownership before proxying to Python. This prevents a malicious client from passing another user's contract context in the request body (since context comes from the client payload, not a DB query, RLS cannot protect it here).

```typescript
async function handleDraftEmail(
  sessionClient: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contractId: string,
  finding: z.infer<typeof findingSchema>,
  context: z.infer<typeof contractContextSchema>
) {
  // Verify the authenticated user owns this contract
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contractId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const secret = process.env.EXTRACTION_SERVICE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Service not configured" }, { status: 500 });
  }

  const actionType =
    finding.category === "price_escalation" || finding.category === "payment_terms"
      ? "renegotiation"
      : "cancellation_notice";

  const payload = {
    action_type: actionType,
    contract_name: context.name,
    party_a: context.party_a,
    party_b: context.party_b,
    expiry_date: context.expiry_date,
    renewal_date: context.renewal_date,
    notice_period_days: context.notice_period_days,
    contract_value: context.contract_value,
    category: context.category,
    finding_title: finding.title,
    finding_explanation: finding.explanation,
    finding_action: finding.action,
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

- [ ] **Step 3: Add `set_reminder` handler — insert alert row**

**Important:** The notice deadline is always computed from `expiry_date` (not `renewal_date`), matching the `buildAlerts()` logic in `lib/alerts.ts` lines 69–70. Using `renewal_date` would produce a different `target_date` from the one `buildAlerts()` already generated at confirmation, defeating the unique constraint and creating a duplicate stale row.

```typescript
async function handleSetReminder(
  sessionClient: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  contractId: string,
  context: z.infer<typeof contractContextSchema>
) {
  const { notice_period_days, expiry_date } = context;

  if (!notice_period_days) {
    return NextResponse.json(
      { error: "No notice period data — cannot set reminder" },
      { status: 400 }
    );
  }

  // Must use expiry_date only — matches lib/alerts.ts buildAlerts() which never uses renewal_date
  // for notice_deadline calculation. Using renewal_date would diverge target_date from existing rows.
  if (!expiry_date) {
    return NextResponse.json(
      { error: "No expiry date — cannot set reminder" },
      { status: 400 }
    );
  }

  // Verify contract ownership (defence in depth alongside RLS)
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contractId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Calculate dates matching buildAlerts logic in lib/alerts.ts
  const deadlineDate = new Date(expiry_date + "T00:00:00Z");
  deadlineDate.setUTCDate(deadlineDate.getUTCDate() - notice_period_days);
  const deadlineISO = deadlineDate.toISOString().slice(0, 10);

  const scheduledDate = new Date(deadlineISO + "T00:00:00Z");
  scheduledDate.setUTCDate(scheduledDate.getUTCDate() - 7);
  const scheduledISO = scheduledDate.toISOString().slice(0, 10);

  // Reject if the notice window has already passed — no point inserting a past-dated pending alert
  // that the cron will never pick up (cron queries scheduled_for <= TODAY).
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (new Date(scheduledISO + "T00:00:00Z") <= today) {
    return NextResponse.json(
      { error: "Notice window has already passed — reminder cannot be set" },
      { status: 400 }
    );
  }

  const alertRow = {
    contract_id: contractId,
    user_id: userId,
    alert_type: "notice_deadline" as const,
    scheduled_for: scheduledISO,
    target_date: deadlineISO,
    status: "pending" as const,
  };

  const { error } = await sessionClient
    .from("alerts")
    .upsert(alertRow, { onConflict: "contract_id,alert_type,target_date", ignoreDuplicates: true });

  if (error) {
    console.error("[finding-action] Alert insert failed:", error);
    return NextResponse.json({ error: "Failed to set reminder" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Add the POST handler that wires it together**

```typescript
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

  const { action_type, contract_id, finding, contract_context } = parsed.data;

  if (action_type === "draft_email") {
    return handleDraftEmail(sessionClient, user.id, contract_id, finding, contract_context);
  }

  if (action_type === "set_reminder") {
    return handleSetReminder(sessionClient, user.id, contract_id, contract_context);
  }

  return NextResponse.json({ error: "Unknown action_type" }, { status: 400 });
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /Users/dmitrygolovach/code/renewl && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no TypeScript errors in `app/api/finding-action/route.ts`.

- [ ] **Step 6: Commit**

```bash
git add app/api/finding-action/route.ts
git commit -m "feat: add POST /api/finding-action route"
```

---

## Task 3: Update `ContractIntelligencePanel.tsx`

**Files:**
- Modify: `components/contracts/ContractIntelligencePanel.tsx`

This task has many steps. Work through them in order. **Important:** Update `CopyAction` (Step 3) before writing `FindingActions` (Step 4) — the `secondary` prop must exist before the code that uses it compiles.

- [ ] **Step 1: Add `ContractContext` type at the top of the file (after the `Finding` type)**

```typescript
export type ContractContext = {
  name: string;
  partyA: string | null;
  partyB: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  autoRenew: boolean | null;
  noticePeriodDays: number | null;
  contractValue: string | null;
  category: string;
};
```

- [ ] **Step 2: Add the `noticeWindowBadge()` helper function (below `ICON_MAP`, before `CopyAction`)**

**Important:** Use only `expiryDate` (not `renewalDate ?? expiryDate`) to match `handleSetReminder` and `lib/alerts.ts`. Both the badge and the reminder button must compute from the same date so the badge accurately reflects whether the reminder can still be set.

```typescript
function noticeWindowBadge(ctx: ContractContext | undefined): React.ReactNode {
  if (!ctx?.noticePeriodDays || !ctx.expiryDate) return null;

  // Compute from expiryDate only — must match lib/alerts.ts buildAlerts() and handleSetReminder
  const deadlineDate = new Date(ctx.expiryDate + "T00:00:00Z");
  deadlineDate.setUTCDate(deadlineDate.getUTCDate() - ctx.noticePeriodDays);

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysLeft = Math.ceil(
    (deadlineDate.getTime() - today.getTime()) / 86400000
  );

  const deadlineLabel = deadlineDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // daysLeft === 0 means today IS the deadline — window is effectively closed (can't set reminder)
  if (daysLeft <= 0) {
    return (
      <span style={{ color: "#EF4444", fontSize: "11px", fontFamily: "var(--font-jetbrains), monospace" }}>
        ⚠ Notice window closed {daysLeft < 0 ? `${Math.abs(daysLeft)} days ago` : "today"}
      </span>
    );
  }

  return (
    <span style={{ color: "#F59E0B", fontSize: "11px", fontFamily: "var(--font-jetbrains), monospace" }}>
      Notice deadline in {daysLeft} days ({deadlineLabel})
    </span>
  );
}
```

- [ ] **Step 3: Update `CopyAction` to accept an optional `secondary` prop** (dimmer styling when used alongside a primary button)

Change the `CopyAction` signature and color:

```typescript
function CopyAction({ text, secondary = false }: { text: string; secondary?: boolean }) {
  // ... existing state ...
  return (
    <span
      onClick={handleCopy}
      // ... existing handlers ...
      style={{
        // ... existing styles ...
        color: secondary ? "#4B5563" : "#10B981",
        // ... rest of styles ...
      }}
    >
```

Only two lines change: the destructuring signature and the `color` value. All other `CopyAction` code stays the same.

- [ ] **Step 4: Add the `FindingActions` component (after `CopyAction`, before `FindingRow`)**

This component renders context-appropriate action buttons:

```typescript
type DraftState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; subject: string; body: string }
  | { status: "error"; message: string };

type ReminderState = "idle" | "loading" | "done" | "error";

function FindingActions({
  finding,
  contractId,
  contractContext,
}: {
  finding: Finding;
  contractId: string;
  contractContext: ContractContext | undefined;
}) {
  const [draftState, setDraftState] = useState<DraftState>({ status: "idle" });
  const [reminderState, setReminderState] = useState<ReminderState>("idle");
  const [copyEmailDone, setCopyEmailDone] = useState(false);

  const category = finding.category;

  // Determine primary action
  // Note: `termination` findings can describe the user's right to terminate (not just vendor's),
  // so "Draft cancellation notice" is the intended action per product spec.
  const showDraftCancellation =
    category === "auto_renewal" || category === "termination";
  const showDraftRenegotiation =
    category === "price_escalation" || category === "payment_terms";
  const showSetReminder = category === "notice_period";
  const showCopyOnly = !showDraftCancellation && !showDraftRenegotiation && !showSetReminder;

  async function handleDraftEmail() {
    if (!contractContext) return;
    setDraftState({ status: "loading" });
    try {
      const res = await fetch("/api/finding-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: "draft_email",
          contract_id: contractId,
          finding: {
            category: finding.category,
            title: finding.title,
            explanation: finding.explanation,
            action: finding.action,
          },
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
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setDraftState({ status: "error", message: err.error ?? "Draft generation failed" });
        return;
      }
      const data = await res.json();
      setDraftState({ status: "done", subject: data.subject, body: data.body });
    } catch {
      setDraftState({ status: "error", message: "Network error — please try again" });
    }
  }

  async function handleSetReminder() {
    if (!contractContext) return;
    setReminderState("loading");
    try {
      const res = await fetch("/api/finding-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: "set_reminder",
          contract_id: contractId,
          finding: {
            category: finding.category,
            title: finding.title,
            explanation: finding.explanation,
            action: finding.action,
          },
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
          },
        }),
      });
      if (!res.ok) {
        setReminderState("error");
        return;
      }
      setReminderState("done");
    } catch {
      setReminderState("error");
    }
  }

  function handleCopyEmail() {
    if (draftState.status !== "done") return;
    const text = `Subject: ${draftState.subject}\n\n${draftState.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopyEmailDone(true);
      setTimeout(() => setCopyEmailDone(false), 1500);
    });
  }

  const actionButtonBase: React.CSSProperties = {
    fontFamily: "var(--font-jetbrains), monospace",
    fontSize: "12px",
    letterSpacing: "0.04em",
    border: "1px solid rgba(16,185,129,0.3)",
    borderRadius: "3px",
    padding: "4px 10px",
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

  return (
    <div style={{ marginTop: "8px" }}>
      {/* Primary action row */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>

        {/* Draft email button */}
        {(showDraftCancellation || showDraftRenegotiation) && (
          <button
            onClick={handleDraftEmail}
            disabled={draftState.status === "loading"}
            style={{
              ...actionButtonBase,
              opacity: draftState.status === "loading" ? 0.7 : 1,
              cursor: draftState.status === "loading" ? "default" : "pointer",
            }}
          >
            {draftState.status === "loading" && loadingDot}
            {showDraftCancellation ? "Draft cancellation notice" : "Draft renegotiation email"}
          </button>
        )}

        {/* Set reminder button */}
        {showSetReminder && (
          <button
            onClick={handleSetReminder}
            disabled={reminderState === "loading" || reminderState === "done"}
            style={{
              ...actionButtonBase,
              ...(reminderState === "done"
                ? { color: "#10B981", borderColor: "rgba(16,185,129,0.4)", opacity: 1 }
                : {}),
              opacity: reminderState === "loading" ? 0.7 : 1,
              cursor:
                reminderState === "loading" || reminderState === "done" ? "default" : "pointer",
            }}
          >
            {reminderState === "loading" && loadingDot}
            {reminderState === "done" ? "✓ Reminder set" : "Set reminder"}
          </button>
        )}

        {/* Reminder error */}
        {reminderState === "error" && (
          <span style={{ fontSize: "11px", color: "#EF4444", fontFamily: "var(--font-jetbrains), monospace" }}>
            Failed to set reminder
          </span>
        )}

        {/* Secondary copy action — for all findings that have an action text */}
        {finding.action && (
          <CopyAction text={finding.action} secondary={!showCopyOnly} />
        )}
      </div>

      {/* Draft error */}
      {draftState.status === "error" && (
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#EF4444", fontFamily: "var(--font-jetbrains), monospace" }}>
          {draftState.message}
          <button
            onClick={() => setDraftState({ status: "idle" })}
            style={{ marginLeft: "8px", color: "#4B5563", background: "none", border: "none", cursor: "pointer", fontSize: "11px" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Email draft panel */}
      {draftState.status === "done" && (
        <div
          style={{
            marginTop: "10px",
            background: "rgba(16, 185, 129, 0.04)",
            border: "1px solid rgba(16, 185, 129, 0.15)",
            borderRadius: "4px",
            padding: "14px 16px",
          }}
        >
          {/* Subject line */}
          <div style={{ marginBottom: "10px" }}>
            <div style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              letterSpacing: "0.1em",
              color: "#4B5563",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}>
              Subject
            </div>
            <div style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              color: "#F9FAFB",
            }}>
              {draftState.subject}
            </div>
          </div>

          {/* Email body */}
          <div style={{ marginBottom: "12px" }}>
            <div style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              letterSpacing: "0.1em",
              color: "#4B5563",
              textTransform: "uppercase",
              marginBottom: "4px",
            }}>
              Body
            </div>
            <pre style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "12px",
              color: "#9CA3AF",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              lineHeight: 1.6,
            }}>
              {draftState.body}
            </pre>
          </div>

          {/* Copy button + disclaimer */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <button
              onClick={handleCopyEmail}
              style={{
                ...actionButtonBase,
                fontSize: "11px",
                padding: "3px 10px",
              }}
            >
              {copyEmailDone ? "✓ Copied" : "Copy email"}
            </button>
            <span style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
              fontStyle: "italic",
            }}>
              For informational purposes only. Not legal advice.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Update `FindingRow` to accept `contractId` and `contractContext`, use `FindingActions` for action rendering, and show the notice window badge**

Replace the existing `FindingRow` function:

```typescript
function FindingRow({
  finding,
  contractId,
  contractContext,
}: {
  finding: Finding;
  contractId: string;
  contractContext: ContractContext | undefined;
}) {
  const { icon, color } = ICON_MAP[finding.type];
  const showBadge =
    finding.category === "notice_period" || finding.category === "auto_renewal";

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
            marginBottom: showBadge || finding.action ? "6px" : 0,
          }}
        >
          {finding.explanation}
        </div>
        {showBadge && (
          <div style={{ marginBottom: "6px" }}>
            {noticeWindowBadge(contractContext)}
          </div>
        )}
        <FindingActions
          finding={finding}
          contractId={contractId}
          contractContext={contractContext}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Update the `ContractIntelligencePanel` component signature and prop threading**

Change the export signature from:
```typescript
export default function ContractIntelligencePanel({ contractId }: { contractId: string })
```
to:
```typescript
export default function ContractIntelligencePanel({
  contractId,
  contractContext,
}: {
  contractId: string;
  contractContext?: ContractContext;
})
```

In the findings render section (the `findings.map` call), update `FindingRow` to pass the new props:
```typescript
{findings.map((finding, i) => (
  <FindingRow
    key={`${finding.category}-${i}`}
    finding={finding}
    contractId={contractId}
    contractContext={contractContext}
  />
))}
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/dmitrygolovach/code/renewl && npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors in `ContractIntelligencePanel.tsx`.

- [ ] **Step 8: Commit**

```bash
git add components/contracts/ContractIntelligencePanel.tsx
git commit -m "feat: actionable findings UI with email drafts and reminders"
```

---

## Task 4: Wire `contractContext` in `ContractDetailClient.tsx`

**Files:**
- Modify: `components/contracts/ContractDetailClient.tsx`

- [ ] **Step 1: Update the `ContractIntelligencePanel` import to include `ContractContext`**

```typescript
import ContractIntelligencePanel, { ContractContext } from "./ContractIntelligencePanel";
```

- [ ] **Step 2: Pass `contractContext` at the usage site (around line 792)**

Find this in `ContractDetailClient.tsx`:
```typescript
<ContractIntelligencePanel contractId={contract.id} />
```

Replace with:
```typescript
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
```

- [ ] **Step 3: Run full build**

```bash
cd /Users/dmitrygolovach/code/renewl && npm run build
```

Expected: Build completes with 0 TypeScript errors. Check that no errors mention `ContractContext`, `contractContext`, or `FindingActions`.

- [ ] **Step 4: Commit**

```bash
git add components/contracts/ContractDetailClient.tsx
git commit -m "feat: pass contractContext to ContractIntelligencePanel"
```

---

## Final Verification Checklist

After all tasks are committed:

- [ ] Navigate to a confirmed contract with AI findings
- [ ] Find an `auto_renewal` warning → click "Draft cancellation notice" → loading dot appears → email draft panel expands below the finding within 5-10 seconds
- [ ] Click "Copy email" → paste into a text editor → confirm subject + body are present
- [ ] Find a `notice_period` finding → click "Set reminder" → button changes to "✓ Reminder set"
- [ ] Check Supabase `alerts` table → a new `notice_deadline` row exists for that contract
- [ ] Notice window badge is visible on `auto_renewal` and `notice_period` findings showing either days remaining or "window closed"
- [ ] Disclaimer text "For informational purposes only. Not legal advice." is visible in every email draft panel
- [ ] `npm run build` passes with zero errors
