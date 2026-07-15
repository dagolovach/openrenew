## Status

**Last verified:** 2026-03-24
**Build status:** Completed

Manual contract entry is live. Users without a PDF can add contracts through the review screen in manual mode (`isManual` prop, neutral styling, all fields pre-expanded).

---

# Manual Contract Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to add contracts without a PDF by routing them through the existing review screen in a pre-expanded, neutral-styled "manual entry" mode.

**Architecture:** A new server-component route (`/dashboard/review/new`) creates a stub contract row + 8 empty extraction rows in Supabase and redirects to the existing review route with `?manual=1`. The review page and its child components (`ReviewClient`, `FieldPanel`, `FieldRow`) accept an `isManual` boolean prop that switches layout (no PDF panel, full-width centered), styling (neutral instead of confidence-coloured), and behavior (always-enabled confirm, autofocused name, name validation). No new API routes are needed.

**Tech Stack:** Next.js 14 App Router (server + client components), Supabase (`@supabase/ssr` session client), React `useRef` for autofocus, inline styles (matches existing codebase pattern).

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `components/dashboard/upload-zone.tsx` | Add "Add manually" link below upload zone |
| Create | `app/(dashboard)/dashboard/review/new/page.tsx` | Server component: dedup check, insert stub contract + 8 extractions, redirect |
| Modify | `app/(dashboard)/dashboard/review/[id]/page.tsx` | Accept `manual` search param, pass `isManual` to `ReviewClient` |
| Modify | `components/review/review-client.tsx` | Manual layout (no PDF, full-width), manual header, suppress delete button |
| Modify | `components/review/field-panel.tsx` | Accept `isManual`: bypass confirm gate, autofocus name, name validation |
| Modify | `components/review/field-row.tsx` | Accept `isManual`: neutral theme, all fields pre-expanded, hide "Looks good" |

---

## Task 1: Add "Add manually" link to UploadZone

**Files:**
- Modify: `components/dashboard/upload-zone.tsx`

- [ ] **Step 1: Add the link**

In `upload-zone.tsx`, inside the `<>` fragment that renders when `state.status !== "uploading"`, add a third element after the error paragraph:

```tsx
<p style={{ fontSize: "13px", color: "#6B7280", marginTop: "12px" }}>
  Don&apos;t have a PDF?{" "}
  <a
    href="/dashboard/review/new?manual=1"
    onClick={(e) => e.stopPropagation()}
    style={{ color: "#10B981", textDecoration: "none" }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")}
    onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")}
  >
    Add contract manually →
  </a>
</p>
```

Note: use `href` (not `<Link>`) to avoid `onClick` fighting with the zone's `onClick` handler that opens the file picker. The `e.stopPropagation()` prevents the zone click from triggering when the link is clicked.

- [ ] **Step 2: Verify in browser**

Run `npm run dev`. Open `/dashboard`. Confirm:
- Link text renders below "or click to browse · PDF only · max 20MB"
- Clicking the link navigates to `/dashboard/review/new?manual=1` (will 404 until Task 2)
- Clicking anywhere else in the upload zone still opens the file picker (stopPropagation works)

- [ ] **Step 3: Commit**

```bash
git add components/dashboard/upload-zone.tsx
git commit -m "feat: add 'Add contract manually' link to upload zone"
```

---

## Task 2: Create `/dashboard/review/new` server route

**Files:**
- Create: `app/(dashboard)/dashboard/review/new/page.tsx`

- [ ] **Step 1: Create the file**

```tsx
// app/(dashboard)/dashboard/review/new/page.tsx
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const MANUAL_FIELDS = [
  "counterparty_name",
  "effective_date",
  "expiry_date",
  "renewal_date",
  "auto_renew",
  "notice_period_days",
  "notice_period_text",
  "contract_value",
] as const;

export default async function ReviewNewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Dedup: reuse a stub created in the last 5 minutes
  const { data: existing } = await supabase
    .from("contracts")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "review")
    .eq("extraction_status", "manual")
    .eq("name", "New Contract")
    .gt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
    .limit(1)
    .maybeSingle();

  if (existing) {
    redirect(`/dashboard/review/${existing.id}?manual=1`);
  }

  // Insert stub contract
  const { data: contract, error } = await supabase
    .from("contracts")
    .insert({
      user_id: user.id,
      name: "New Contract",
      category: "other",
      status: "review",
      extraction_status: "manual",
    })
    .select("id")
    .single();

  if (error || !contract) {
    // If insert fails (e.g. RLS misconfiguration), redirect to dashboard
    redirect("/dashboard");
  }

  // Insert 8 empty extraction rows (contract_extractions has no user_id column — RLS enforces ownership via contract_id)
  const extractionRows = MANUAL_FIELDS.map((field_name) => ({
    contract_id: contract.id,
    field_name,
    extracted_value: null,
    confirmed_value: null,
    confidence: null,
    was_edited: false,
  }));

  await supabase.from("contract_extractions").insert(extractionRows);

  redirect(`/dashboard/review/${contract.id}?manual=1`);
}
```

- [ ] **Step 2: Verify in browser**

Navigate to `/dashboard/review/new?manual=1`. Confirm:
- You are redirected to `/dashboard/review/<uuid>?manual=1`
- The review page loads (may look odd until Task 3 changes are applied)
- In Supabase Studio → `contracts` table: a row with `name='New Contract'`, `extraction_status='manual'`, `status='review'` exists
- In `contract_extractions` table: 8 rows for that contract ID, all with `extracted_value=null`, `confidence=null`

Refresh `/dashboard/review/new?manual=1` a second time. Confirm you land on the SAME contract (dedup logic worked — same UUID in URL).

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/dashboard/review/new/page.tsx"
git commit -m "feat: add /dashboard/review/new stub contract creator with dedup"
```

---

## Task 3: Pass `isManual` through the review server component

**Files:**
- Modify: `app/(dashboard)/dashboard/review/[id]/page.tsx`

- [ ] **Step 1: Update the type and props**

Change the `Params` type to include `manual` in searchParams, and pass `isManual` to `ReviewClient`:

```tsx
// Change the type:
type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reopen?: string; manual?: string }>;
};

// Inside the function, destructure manual:
const { reopen, manual } = await searchParams;
const isManual = manual === "1";
```

Update the return statement:

```tsx
return <ReviewClient contract={contract} extractions={extractions ?? []} pdfUrl={pdfUrl} isManual={isManual} />;
```

Note: when `isManual` is true, `pdfUrl` will be `null` (no `file_path` on the stub), so the PDF URL logic is harmless as-is.

- [ ] **Step 2: Verify**

Do NOT commit yet — `ReviewClient` doesn't accept `isManual` until Task 4. Committing here would leave TypeScript in a broken state. Both files are committed together in Task 4, Step 4.

---

## Task 4: Manual mode layout and header in ReviewClient

**Files:**
- Modify: `components/review/review-client.tsx`

- [ ] **Step 1: Add `isManual` to the component signature and Contract type**

The `Contract` type needs `extraction_status` to check if it's manual. The `file_name` is also used in the heading — manual contracts won't have one:

```tsx
// Update the Contract type:
type Contract = {
  id: string; name: string; file_name: string | null; category: string;
  status: string; extraction_confidence: number | null; extraction_status: string | null;
};

// Update function signature:
export default function ReviewClient({ contract, extractions, pdfUrl, isManual }: {
  contract: Contract; extractions: ExtractionRow[]; pdfUrl: string | null; isManual: boolean;
}) {
```

- [ ] **Step 2: Replace the layout with manual-aware rendering**

Replace the entire `return (...)` block:

```tsx
return (
  <>
    {isManual ? (
      /* Manual entry: no PDF panel, single centered column */
      <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "0 16px" }}>
        <div style={{ width: "100%", maxWidth: "680px", padding: "24px 0" }}>
          <ManualHeader />
          <ErrorBanner error={error} />
          <FieldPanel
            name={contract.name || "New Contract"}
            category={contract.category}
            extractions={extractions}
            onConfirm={handleConfirm}
            isConfirming={confirming}
            isManual={true}
          />
        </div>
      </div>
    ) : (
      /* Normal mode: 50/50 or 60/40 split with PDF */
      <div className="flex flex-col md:flex-row h-screen overflow-hidden">
        <div className={`hidden md:block ${pdfClass} h-full border-r border-slate-200 flex-shrink-0`}>
          {pdfUrl
            ? <iframe src={pdfUrl} className="w-full h-full" title="Contract PDF" />
            : <div className="flex items-center justify-center h-full text-sm text-slate-400">PDF unavailable</div>
          }
        </div>
        <div className={`${fieldsClass} h-full overflow-y-auto`}>
          <div className="p-5">
            <NormalHeader />
            <ConfirmedBanner />
            <ErrorBanner error={error} />
            {isReadOnly ? <ReadOnlyFields /> : (
              <FieldPanel
                name={contract.name || contract.file_name || "Untitled"}
                category={contract.category}
                extractions={extractions}
                onConfirm={handleConfirm}
                isConfirming={confirming}
                isManual={false}
              />
            )}
          </div>
        </div>
      </div>
    )}
    {showDeleteDialog && (
      <DeleteContractDialog
        contractId={contract.id}
        contractName={contract.name || contract.file_name || "Untitled"}
        onClose={() => setShowDeleteDialog(false)}
        onDeleted={() => router.push("/dashboard")}
      />
    )}
  </>
);
```

Rather than introducing separate sub-components for header/banner/fields (which would require refactoring the whole file), keep the existing structure but extract the conditional rendering inline. Here is the **complete replacement** for `review-client.tsx`:

```tsx
// components/review/review-client.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FieldPanel from "./field-panel";
import DeleteContractDialog from "@/components/dashboard/delete-contract-dialog";

type Contract = {
  id: string; name: string; file_name: string | null; category: string;
  status: string; extraction_confidence: number | null; extraction_status: string | null;
};
type ExtractionRow = {
  field_name: string; extracted_value: string | null; confirmed_value: string | null;
  confidence: number | null; was_edited: boolean;
};

export default function ReviewClient({ contract, extractions, pdfUrl, isManual }: {
  contract: Contract; extractions: ExtractionRow[]; pdfUrl: string | null; isManual: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const isReadOnly = contract.status === "confirmed";

  const lowConf = (contract.extraction_confidence ?? 1) < 0.7;
  const pdfClass    = lowConf ? "md:w-3/5" : "md:w-1/2";
  const fieldsClass = lowConf ? "md:w-2/5" : "md:w-1/2";

  async function handleConfirm(payload: { name: string; category: string; fields: Record<string, string | null> }) {
    setConfirming(true); setError(null);
    try {
      const res = await fetch("/api/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_id: contract.id, ...payload }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({}))).error ?? "Confirm failed");
        return;
      }
      router.push("/dashboard");
    } finally {
      setConfirming(false);
    }
  }

  if (isManual) {
    return (
      <>
        <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "0 16px" }}>
          <div style={{ width: "100%", maxWidth: "680px", padding: "24px 0" }}>
            {/* Manual header: back link + "Manual entry" label, no delete button */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <Link href="/dashboard" style={{ fontSize: "12px", color: "#6B7280", textDecoration: "none" }}>
                ← Back to dashboard
              </Link>
              <span style={{ fontSize: "12px", color: "#4B5563" }}>Manual entry</span>
            </div>

            {error && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#FCA5A5" }}>{error}</div>
            )}

            <FieldPanel
              name={contract.name || "New Contract"}
              category={contract.category}
              extractions={extractions}
              onConfirm={handleConfirm}
              isConfirming={confirming}
              isManual={true}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden">
        {/* PDF panel — desktop only */}
        <div className={`hidden md:block ${pdfClass} h-full border-r border-slate-200 flex-shrink-0`}>
          {pdfUrl
            ? <iframe src={pdfUrl} className="w-full h-full" title="Contract PDF" />
            : <div className="flex items-center justify-center h-full text-sm text-slate-400">PDF unavailable</div>
          }
        </div>

        {/* Fields panel */}
        <div className={`${fieldsClass} h-full overflow-y-auto`}>
          <div className="p-5">
            <Link href="/dashboard" style={{ fontSize: "12px", color: "#6B7280", textDecoration: "none", display: "inline-block", marginBottom: "16px" }}>← Back to contracts</Link>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <h1 style={{ fontSize: "17px", fontWeight: 600, color: "#F9FAFB", margin: 0 }}>{contract.name || contract.file_name || "Untitled"}</h1>
              <button
                onClick={() => setShowDeleteDialog(true)}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors"
              >
                Delete
              </button>
            </div>

            {isReadOnly && (
              <div style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: "8px", padding: "12px 16px", marginBottom: "20px", fontSize: "13px", color: "#6EE7B7" }}>
                <strong style={{ color: "#A7F3D0" }}>This contract has been confirmed.</strong> Alerts are active.{" "}
                <Link href={`/dashboard/review/${contract.id}?reopen=1`} style={{ color: "#6EE7B7", textDecoration: "underline" }}>
                  Edit contract
                </Link>
                {" · "}
                <Link href="/dashboard" style={{ color: "#6EE7B7", textDecoration: "underline" }}>Back to contracts</Link>
              </div>
            )}

            {error && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#FCA5A5" }}>{error}</div>
            )}

            {isReadOnly ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {extractions.map((e) => (
                  <div key={e.field_name} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "10px 14px", background: "rgba(255,255,255,0.03)" }}>
                    <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#4B5563", marginBottom: "4px" }}>{e.field_name.replace(/_/g, " ")}</div>
                    <div style={{ fontSize: "13px", color: e.confirmed_value ? "#F9FAFB" : "#374151" }}>{e.confirmed_value ?? <span style={{ fontStyle: "italic" }}>Not set</span>}</div>
                  </div>
                ))}
              </div>
            ) : (
              <FieldPanel
                name={contract.name || contract.file_name || "Untitled"}
                category={contract.category}
                extractions={extractions}
                onConfirm={handleConfirm}
                isConfirming={confirming}
                isManual={false}
              />
            )}
          </div>
        </div>
      </div>
      {showDeleteDialog && (
        <DeleteContractDialog
          contractId={contract.id}
          contractName={contract.name || contract.file_name || "Untitled"}
          onClose={() => setShowDeleteDialog(false)}
          onDeleted={() => router.push("/dashboard")}
        />
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify in browser**

Navigate to a manual contract URL (e.g. `/dashboard/review/<uuid>?manual=1`). Confirm:
- No PDF panel — single centered column (max 680px)
- Header shows "← Back to dashboard" (left) and "Manual entry" (right, muted)
- No Delete button in manual mode
- Normal review of a PDF contract is unchanged (visit any existing `/dashboard/review/<uuid>` without `?manual=1`)

- [ ] **Step 4: Commit**

Commit both the page (Task 3) and the client component together to keep TypeScript valid:

```bash
git add "app/(dashboard)/dashboard/review/[id]/page.tsx" components/review/review-client.tsx
git commit -m "feat: manual mode layout and header in ReviewClient"
```

---

## Task 5: Neutral theme and pre-expanded fields in FieldRow

**Files:**
- Modify: `components/review/field-row.tsx`

- [ ] **Step 1: Add `isManual` prop and neutral theme**

Replace the `THEME` constant and update the component:

```tsx
// Add "neutral" to THEME
const THEME = {
  blue:    { border: "#3B82F6", bg: "rgba(59,130,246,0.08)",  label: "#93C5FD" },
  green:   { border: "#10B981", bg: "rgba(16,185,129,0.08)",  label: "#6EE7B7" },
  amber:   { border: "#F59E0B", bg: "rgba(245,158,11,0.08)",  label: "#FCD34D" },
  red:     { border: "#EF4444", bg: "rgba(239,68,68,0.08)",   label: "#FCA5A5" },
  neutral: { border: "rgba(255,255,255,0.12)", bg: "rgba(255,255,255,0.03)", label: "#6B7280" },
};

// Update Props type:
type Props = {
  fieldName: FieldName;
  label: string;
  extractedValue: string | null;
  confidence: number;
  wasEdited: boolean;
  confirmedValue: string | null;
  resolution: Resolution;
  onResolve: (value: string | null) => void;
  isManual: boolean;
};
```

Update the component body — change the two lines that determine `color` and `preExpanded`:

```tsx
// Replace:
//   const color = resolution.isResolved ? "blue" : colorState(confidence, wasEdited, confirmedValue);
//   const preExpanded = (color === "amber" || color === "red") && !resolution.isResolved;

// With:
const color = isManual
  ? "neutral"
  : (resolution.isResolved ? "blue" : colorState(confidence, wasEdited, confirmedValue));
const preExpanded = isManual ? true : (color === "amber" || color === "red") && !resolution.isResolved;
```

The confidence badge is already conditional on `confidence > 0`, so null/0 values won't render it in manual mode. The "Looks good" button is already conditional on `extractedValue !== null`, so it won't appear for manual entries.

The full updated export:

```tsx
export default function FieldRow({ fieldName, label, extractedValue, confidence, wasEdited, confirmedValue, resolution, onResolve, isManual }: Props) {
  const color = isManual
    ? "neutral"
    : (resolution.isResolved ? "blue" : colorState(confidence, wasEdited, confirmedValue));
  const preExpanded = isManual ? true : ((color === "amber" || color === "red") && !resolution.isResolved);
  const [editing, setEditing] = useState(preExpanded);
  const [draft, setDraft] = useState<string>(resolution.value ?? "");

  const displayVal = resolution.isResolved ? resolution.value : (color === "blue" ? confirmedValue : extractedValue);
  const t = THEME[color];

  return (
    <div style={{
      border: `1px solid ${t.border}`,
      borderRadius: "8px",
      padding: "12px",
      background: t.bg,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div style={{
          fontSize: "10px",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: t.label,
        }}>
          {label}
        </div>
        {!wasEdited && confirmedValue === null && confidence > 0 && (
          <div style={{
            fontSize: "10px",
            color: confidence >= 0.9 ? "#6EE7B7" : confidence >= 0.7 ? "#FCD34D" : "#FCA5A5",
            fontFamily: "var(--font-jetbrains), monospace",
            letterSpacing: "0.02em",
          }}>
            {confidence >= 0.9 ? "✓" : "~"} {Math.round(confidence * 100)}%
          </div>
        )}
      </div>

      {!editing ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          {fieldName === "auto_renew" && displayVal !== null ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              fontSize: "12px", fontWeight: 600,
              color: displayVal === "true" ? "#10B981" : "#9CA3AF",
              background: displayVal === "true" ? "rgba(16,185,129,0.12)" : "rgba(156,163,175,0.1)",
              border: `1px solid ${displayVal === "true" ? "rgba(16,185,129,0.3)" : "rgba(156,163,175,0.2)"}`,
              borderRadius: "20px", padding: "3px 10px",
            }}>
              <span style={{ fontSize: "8px" }}>●</span>
              {displayVal === "true" ? "Yes — auto-renews" : "No — manual renewal"}
            </span>
          ) : (
            <span style={{ fontSize: "13px", color: displayVal ? "#F9FAFB" : "#4B5563", fontStyle: displayVal ? "normal" : "italic" }}>
              {displayVal ?? "Not found in contract"}
            </span>
          )}
          <button
            onClick={() => { setDraft(displayVal ?? ""); setEditing(true); }}
            style={{ fontSize: "13px", color: "#9CA3AF", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", cursor: "pointer", padding: "2px 6px", flexShrink: 0, lineHeight: 1.4 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F9FAFB")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9CA3AF")}
          >
            ✎
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
          {fieldName === "auto_renew" ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">— select —</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Enter value…"
              style={inputStyle}
            />
          )}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              onClick={() => { onResolve(draft.trim() || null); setEditing(false); }}
              style={{ fontSize: "12px", background: "#1F2937", color: "#F9FAFB", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", padding: "5px 12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Save
            </button>
            {extractedValue !== null && !resolution.isResolved && (
              <button
                onClick={() => { onResolve(extractedValue); setEditing(false); }}
                style={{ fontSize: "12px", background: "rgba(16,185,129,0.15)", color: "#10B981", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "6px", padding: "5px 12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                Looks good ✓
              </button>
            )}
            <button
              onClick={() => { onResolve(null); setEditing(false); }}
              style={{ fontSize: "12px", background: "none", color: "#6B7280", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
            >
              Not applicable
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ fontSize: "12px", background: "none", color: "#4B5563", border: "none", cursor: "pointer", padding: "5px 4px", fontFamily: "inherit" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify in browser**

Open a manual contract's review page. Confirm:
- All 8 fields are expanded in edit mode by default
- Fields have neutral styling (no red/amber/green borders — subtle grey border instead)
- No confidence percentage badges are shown
- No "Looks good ✓" button appears (extracted values are all null)
- "Save" and "Not applicable" buttons are present
- "Cancel" button is present (closes the field back to collapsed view)

Open an existing PDF contract's review page. Confirm:
- Confidence-coloured borders are unchanged
- "Looks good ✓" button appears on fields with extracted values
- Pre-expansion behaviour for amber/red fields is unchanged

- [ ] **Step 3: Commit**

```bash
git add components/review/field-row.tsx
git commit -m "feat: neutral theme and pre-expanded fields for manual mode in FieldRow"
```

---

## Task 6: FieldPanel manual mode — bypass confirm gate, autofocus, validation

**Files:**
- Modify: `components/review/field-panel.tsx`

- [ ] **Step 1: Add `isManual` prop, `useRef` for name autofocus, and skip `formatName` in manual mode**

Add `useRef` import and update Props:

```tsx
import { useState, useRef, useEffect } from "react";

// Update Props:
type Props = {
  name: string; category: string;
  extractions: ExtractionRow[];
  onConfirm: (p: { name: string; category: string; fields: Record<string, string | null> }) => void;
  isConfirming: boolean;
  isManual: boolean;
};
```

Update the `useState` initializer for `name` to skip `formatName` in manual mode (otherwise `formatName` would title-case a user-typed name on re-render):

```tsx
// Replace:
//   const [name, setName] = useState(() => formatName(initName));
// With:
const [name, setName] = useState(() => isManual ? initName : formatName(initName));
```

- [ ] **Step 2: Add nameRef, nameError state, autofocus effect, and updated confirm logic**

Inside the component, after the existing state declarations, add:

```tsx
const nameRef = useRef<HTMLInputElement>(null);
const [nameError, setNameError] = useState<string | null>(null);

// Autofocus name field in manual mode
useEffect(() => {
  if (isManual) nameRef.current?.focus();
}, [isManual]);
```

Replace `handleConfirm` with a version that validates the name:

```tsx
function handleConfirm() {
  // Name validation (manual mode only)
  if (isManual && (!name.trim() || name.trim() === "New Contract")) {
    setNameError("Please give this contract a name");
    nameRef.current?.focus();
    return;
  }
  setNameError(null);

  const fields: Record<string, string | null> = {};
  for (const { name: fn } of FIELD_ORDER) {
    const row = extractions.find((e) => e.field_name === fn);
    const wasResolvedInDb = !!(row?.was_edited || row?.confirmed_value !== null);
    if (resolutions[fn].isResolved) {
      fields[fn] = resolutions[fn].value;
    } else if (wasResolvedInDb) {
      fields[fn] = row!.confirmed_value;
    } else {
      fields[fn] = row?.extracted_value ?? null;
    }
  }
  onConfirm({ name, category, fields });
}
```

- [ ] **Step 3: Update the confirm button disabled condition**

```tsx
// Replace:
//   disabled={unresolvedAmberRed.length > 0 || isConfirming}
// With:
disabled={(isManual ? false : unresolvedAmberRed.length > 0) || isConfirming}
```

Similarly update the button's cursor and background color logic and the helper text below the button. The full confirm button block:

```tsx
<button
  onClick={handleConfirm}
  disabled={(isManual ? false : unresolvedAmberRed.length > 0) || isConfirming}
  title={!isManual && unresolvedAmberRed.length > 0 ? "Resolve highlighted fields first" : undefined}
  style={{
    width: "100%",
    background: (!isManual && unresolvedAmberRed.length > 0) || isConfirming ? "rgba(16,185,129,0.3)" : "#10B981",
    color: (!isManual && unresolvedAmberRed.length > 0) || isConfirming ? "#6B7280" : "#0A0F1E",
    border: "none",
    borderRadius: "8px",
    padding: "12px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: (!isManual && unresolvedAmberRed.length > 0) || isConfirming ? "not-allowed" : "pointer",
    transition: "background 150ms ease",
    fontFamily: "inherit",
  }}
>
  {isConfirming ? "Confirming…" : "Confirm & activate alerts"}
</button>
{!isManual && unresolvedAmberRed.length > 0 && (
  <p style={{ fontSize: "11px", textAlign: "center", color: "#4B5563", marginTop: "6px" }}>Resolve highlighted fields first</p>
)}
```

- [ ] **Step 4: Add `ref` and `nameError` display to the name input**

Update the name input to attach the ref, clear the error on change, and show the error message:

```tsx
<div style={{ display: "flex", flexDirection: "column" }}>
  <label style={labelStyle}>Contract name</label>
  <input
    ref={nameRef}
    type="text"
    value={name}
    onChange={(e) => { setName(e.target.value); setNameError(null); }}
    style={{
      ...inputStyle,
      ...(nameError ? { borderColor: "#EF4444" } : {}),
    }}
  />
  {nameError && (
    <p style={{ fontSize: "11px", color: "#EF4444", marginTop: "4px" }}>{nameError}</p>
  )}
</div>
```

- [ ] **Step 5: Pass `isManual` down to each `FieldRow`**

In the `FIELD_ORDER.map(...)` call, add `isManual` to `<FieldRow>`:

```tsx
<FieldRow key={fn} fieldName={fn} label={label}
  extractedValue={row?.extracted_value ?? null}
  confidence={row?.confidence ?? 0}
  wasEdited={row?.was_edited ?? false}
  confirmedValue={row?.confirmed_value ?? null}
  resolution={resolutions[fn]}
  onResolve={(v) => resolve(fn, v)}
  isManual={isManual}
/>
```

- [ ] **Step 6: Verify in browser**

Open a manual contract's review page. Confirm:
- Contract name field is focused on page load
- "Confirm & activate alerts" button is fully green and enabled immediately
- Clicking "Confirm & activate alerts" with name = "New Contract" (unchanged) shows: `"Please give this contract a name"` in red below the name field, name field gets focus
- Clicking "Confirm & activate alerts" with an empty name shows the same error
- Typing a name clears the error
- Filling in some fields and clicking confirm with a valid name calls `/api/confirm`, redirects to `/dashboard`
- In Supabase Studio: contract `status = 'confirmed'`, `name` updated, `alerts` rows generated

Open an existing PDF contract. Confirm:
- Confirm button is still gated on amber/red fields being resolved
- No regression in confidence coloring or field behaviour

- [ ] **Step 7: Commit**

```bash
git add components/review/field-panel.tsx
git commit -m "feat: manual mode confirm gate bypass, autofocus, and name validation in FieldPanel"
```

---

## Task 7: End-to-end smoke test

No automated test framework exists in this codebase. Verify the full user journey manually.

- [ ] **Step 1: Full happy path**

1. Go to `/dashboard`
2. Click "Add contract manually →" in the upload zone
3. Confirm redirect to `/dashboard/review/<uuid>?manual=1`
4. Verify: no PDF panel, "Manual entry" label in header, all fields pre-expanded with neutral styling
5. Change contract name from "New Contract" to "Acme SaaS Agreement"
6. Fill in expiry date: `2027-06-30`
7. Click "Not applicable" on `auto_renew`
8. Click "Confirm & activate alerts"
9. Confirm redirect to `/dashboard`
10. Confirm the new contract card appears on the dashboard with name "Acme SaaS Agreement"

- [ ] **Step 2: Dedup path**

1. Go to `/dashboard/review/new?manual=1`
2. Note the UUID in the URL
3. Press browser back, then go to `/dashboard/review/new?manual=1` again
4. Confirm the UUID is the same (dedup redirect fired)

- [ ] **Step 3: Name validation path**

1. Go to `/dashboard/review/new?manual=1`
2. Leave name as "New Contract"
3. Click "Confirm & activate alerts"
4. Confirm error message appears: "Please give this contract a name"
5. Confirm name field is focused

- [ ] **Step 4: Normal PDF review regression check**

1. Upload a PDF contract
2. Open its review page (no `?manual=1`)
3. Confirm PDF panel visible, confidence badges present, "Looks good ✓" appears on extracted fields
4. Confirm + activate — verify no regression

- [ ] **Step 5: Final commit (if any cleanup needed)**

If any minor cleanup was done during smoke testing, commit with specific file names (do not use `git add -p` — it requires interactive input):

```bash
git add components/dashboard/upload-zone.tsx components/review/review-client.tsx components/review/field-panel.tsx components/review/field-row.tsx
git commit -m "chore: manual entry smoke test cleanup"
```
