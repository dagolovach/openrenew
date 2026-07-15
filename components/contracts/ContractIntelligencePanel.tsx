// components/contracts/ContractIntelligencePanel.tsx
"use client";

import { useCallback, useEffect, useRef, useState, startTransition } from "react";
import { Analytics } from "@/lib/analytics";

export type Finding = {
  type: "warning" | "positive" | "info";
  category: string;
  title: string;
  explanation: string;
  action: string | null;
  severity: "high" | "medium" | "low" | null;
};

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

// Sort: warnings (high → medium → low), then positives, then info
const TYPE_RANK = { warning: 0, positive: 1, info: 2 } as const;
const SEV_RANK = { high: 0, medium: 1, low: 2 } as const;

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const ta = TYPE_RANK[a.type] ?? 3;
    const tb = TYPE_RANK[b.type] ?? 3;
    if (ta !== tb) return ta - tb;
    const sa = a.severity ? (SEV_RANK[a.severity] ?? 3) : 3;
    const sb = b.severity ? (SEV_RANK[b.severity] ?? 3) : 3;
    return sa - sb;
  });
}

const ICON_MAP = {
  warning: { icon: "⚠", color: "#F59E0B" },
  positive: { icon: "✓", color: "#10B981" },
  info: { icon: "ℹ", color: "#6B7280" },
} as const;

// Categories handled by the consolidated draft button — no per-finding action buttons
const VENDOR_ACTIONABLE = new Set([
  "auto_renewal",
  "price_escalation",
  "notice_period",
  "termination",
  "payment_terms",
]);

type PanelDraftState =
  | { mode: "findings" }
  | { mode: "drafting" }
  | { mode: "draft_done"; subject: string; body: string }
  | { mode: "draft_error"; message: string };

function noticeWindowBadge(ctx: ContractContext | undefined): React.ReactNode {
  if (!ctx?.noticePeriodDays || !ctx.expiryDate) return null;

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

  if (daysLeft <= 0) {
    return (
      <span style={{ color: "#EF4444", fontSize: "11px", fontFamily: "var(--font-jetbrains), monospace" }}>
        {daysLeft < 0 ? `Notice window closed ${Math.abs(daysLeft)} days ago` : "Notice window closed today"}
      </span>
    );
  }

  return (
    <span style={{ color: "#F59E0B", fontSize: "11px", fontFamily: "var(--font-jetbrains), monospace" }}>
      Notice window closes in {daysLeft} days — act by {deadlineLabel}
    </span>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      onClick={handleCopy}
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "11px",
        color: "#10B981",
        border: "1px solid rgba(16,185,129,0.3)",
        borderRadius: "3px",
        padding: "2px 8px",
        background: "transparent",
        cursor: "pointer",
        letterSpacing: "0.02em",
      }}
    >
      {copied ? "✓ Copied" : "Copy recommendation"}
    </button>
  );
}

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

function Disclaimer() {
  return (
    <div
      style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "11px",
        color: "#4B5563",
        fontStyle: "italic",
        padding: "14px 20px 16px",
        borderTop: "1px solid rgba(255,255,255,0.04)",
        letterSpacing: "0.02em",
      }}
    >
      For informational purposes only · Not legal advice
    </div>
  );
}

function PanelShell({
  children,
  header,
}: {
  children: React.ReactNode;
  header: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "4px",
        overflow: "hidden",
      }}
    >
      <style>{`@keyframes pulse { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }`}</style>
      {header}
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "0 20px" }} />
      {children}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: "11px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#10B981",
};

const toggleStyle: React.CSSProperties = {
  fontFamily: "var(--font-jetbrains), monospace",
  fontSize: "11px",
  color: "#4B5563",
  letterSpacing: "0.08em",
  cursor: "pointer",
};

const headerBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "16px 20px",
};

export default function ContractIntelligencePanel({
  contractId,
  contractContext,
}: {
  contractId: string;
  contractContext?: ContractContext;
}) {
  const [status, setStatus] = useState<"loading" | "found" | "empty" | "error">("loading");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [panelDraft, setPanelDraft] = useState<PanelDraftState>({ mode: "findings" });
  const [copyEmailDone, setCopyEmailDone] = useState(false);
  const copyEmailTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const analysisViewedFired = useRef(false);

  useEffect(() => {
    return () => {
      if (copyEmailTimeoutRef.current) clearTimeout(copyEmailTimeoutRef.current);
    };
  }, []);

  const handleDraftEmail = useCallback(async function handleDraftEmail() {
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
  }, [contractId, contractContext, findings]);

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
              startTransition(() => {
                const sorted = sortFindings(data.findings as Finding[]);
                setFindings(sorted);
                const hasWarnings = sorted.some((f) => f.type === "warning");
                setIsOpen(hasWarnings);
                if (sorted.length > 0) {
                  setStatus("found");
                  if (!analysisViewedFired.current) {
                    analysisViewedFired.current = true;
                    Analytics.analysisViewed(contractId);
                  }
                } else {
                  setStatus("empty");
                }
              });
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

  // ── Loading state ─────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <PanelShell
        header={
          <div style={headerBaseStyle}>
            <span style={labelStyle}>Analysis</span>
          </div>
        }
      >
        <div
          style={{
            padding: "20px",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#4B5563",
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: "#10B981",
              flexShrink: 0,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          />
          Analysing contract...
        </div>
        <Disclaimer />
      </PanelShell>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <PanelShell
        header={
          <div style={headerBaseStyle}>
            <span style={labelStyle}>Analysis</span>
          </div>
        }
      >
        <div
          style={{
            padding: "20px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#4B5563",
          }}
        >
          Analysis unavailable. Try refreshing the page.
        </div>
        <Disclaimer />
      </PanelShell>
    );
  }

  // ── Empty state (no findings) ─────────────────────────────────────────────
  if (status === "empty") {
    return (
      <PanelShell
        header={
          <div style={headerBaseStyle}>
            <span style={labelStyle}>Analysis</span>
          </div>
        }
      >
        <div
          style={{
            padding: "20px",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "#4B5563",
          }}
        >
          No significant risk flags detected. Standard terms throughout.
        </div>
        <Disclaimer />
      </PanelShell>
    );
  }

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
        <span style={labelStyle}>Analysis</span>
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
      <span style={labelStyle}>Analysis</span>
      {panelDraft.mode !== "drafting" && backLink}
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
                      if (copyEmailTimeoutRef.current) clearTimeout(copyEmailTimeoutRef.current);
                      copyEmailTimeoutRef.current = setTimeout(() => setCopyEmailDone(false), 1500);
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
              {findings.map((finding) => (
                <FindingRow
                  key={`${finding.category}-${finding.title}`}
                  finding={finding}
                  contractContext={contractContext}
                />
            ))}
            </div>
          )}
        </>
      )}

      {/* Draft vendor email button — visible in findings and drafting modes */}
      {isOpen && hasVendorFindings && (panelDraft.mode === "findings" || panelDraft.mode === "drafting") && (
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={panelDraft.mode === "findings" ? handleDraftEmail : undefined}
            disabled={panelDraft.mode === "drafting"}
            style={{
              ...actionButtonBase,
              ...(panelDraft.mode === "drafting" ? { opacity: 0.5 } : {}),
            }}
          >
            Draft vendor email →
          </button>
        </div>
      )}

      <Disclaimer />
    </PanelShell>
  );
}
