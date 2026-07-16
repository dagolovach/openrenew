// components/review/review-client.tsx
"use client";

import { useState, useEffect, useRef, startTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import FieldPanel from "./field-panel";
import { isExpired, formatExpiredDate } from "@/lib/utils";

type Contract = {
  id: string; name: string; file_name: string | null; category: string;
  status: string; extraction_confidence: number | null;
  expiry_date: string | null;
  renewal_date: string | null;
  parent_contract_id?: string | null;
};
type ExtractionRow = {
  field_name: string; extracted_value: string | null; confirmed_value: string | null;
  confidence: number | null; was_edited: boolean;
};

function ExpiredWarningBanner({ expiryDate, onDismiss }: { expiryDate: string; onDismiss: () => void }) {
  return (
    <div style={{
      background: "rgba(245, 158, 11, 0.08)",
      borderLeft: "3px solid #F59E0B",
      borderRadius: "6px",
      padding: "12px 16px",
      marginBottom: "16px",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "12px",
    }}>
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <span style={{ color: "#F59E0B", flexShrink: 0, fontSize: "14px" }}>⚠</span>
        <div style={{ fontSize: "13px", color: "#D1D5DB", lineHeight: 1.5 }}>
          This contract appears to have expired on{" "}
          <strong style={{ color: "#E5E7EB" }}>{formatExpiredDate(expiryDate)}</strong>.
          <br />
          No alerts will be generated. You can still save it for your records.
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "none", border: "none", cursor: "pointer",
          color: "#6B7280", fontSize: "16px", lineHeight: 1,
          padding: "2px 4px", flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

type FieldChange = {
  field: string;
  previous: string | null;
  current: string | null;
  severity: "high" | "medium" | "low";
};

type ClauseChange = {
  clause: string;
  previous: string | null;
  current: string | null;
};

type ComparisonData = {
  field_changes: FieldChange[];
  clause_changes: ClauseChange[];
  summary: string | null;
};

type ExtractionComparisonRow = {
  field: string;
  legacy: string | null;
  langgraph: string | null;
  changed: boolean;
};

type ExtractionComparisonData = {
  pipeline_version: string | null;
  extraction_engine: string | null;
  changed_count: number;
  total_count: number;
  rows: ExtractionComparisonRow[];
  created_at: string;
};

const FIELD_LABELS: Record<string, string> = {
  contract_value:       "Contract value",
  effective_date:       "Effective date",
  expiry_date:          "Expiry date",
  renewal_date:         "Renewal date",
  notice_period_days:   "Notice period (days)",
  notice_period_text:   "Notice period terms",
  auto_renew:           "Auto-renew",
  party_a:              "Party A",
  party_b:              "Party B",
  category:             "Category",
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ExtractionComparisonPanel({ contractId }: { contractId: string }) {
  const [data, setData] = useState<ExtractionComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    async function load() {
      try {
        const res = await fetch(`/api/extract-comparison?contract_id=${contractId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelledRef.current && body.comparison) {
          setData(body.comparison as ExtractionComparisonData);
          setExpanded((body.comparison.changed_count ?? 0) > 0);
        }
      } catch {}
      if (!cancelledRef.current) setLoading(false);
    }
    void load();
    return () => {
      cancelledRef.current = true;
    };
  }, [contractId]);

  if (loading || !data || data.total_count === 0) return null;

  return (
    <div style={{
      marginBottom: "20px",
      borderRadius: "8px",
      overflow: "hidden",
      border: "1px solid rgba(59,130,246,0.25)",
      borderLeft: "3px solid #3B82F6",
    }}>
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 14px",
          background: "rgba(59,130,246,0.08)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#E5E7EB" }}>
            Extraction quality: Legacy vs LangGraph
          </span>
          <span style={{
            fontSize: "11px",
            fontFamily: "var(--font-jetbrains), monospace",
            color: "#93C5FD",
            background: "rgba(59,130,246,0.16)",
            borderRadius: "4px",
            padding: "1px 6px",
          }}>
            {data.changed_count}/{data.total_count} changed
          </span>
        </div>
        <span style={{ fontSize: "11px", color: "#6B7280", flexShrink: 0 }}>
          {expanded ? "▲ Hide" : "▼ Show"}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "12px 14px", background: "rgba(59,130,246,0.03)" }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "1.1fr 1fr 1fr",
            gap: "10px",
            fontSize: "10px",
            color: "#64748B",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            marginBottom: "8px",
            fontWeight: 700,
          }}>
            <span>Field</span>
            <span>Before (Legacy)</span>
            <span>After (LangGraph)</span>
          </div>

          {data.rows.map((row) => (
            <div
              key={row.field}
              style={{
                display: "grid",
                gridTemplateColumns: "1.1fr 1fr 1fr",
                gap: "10px",
                padding: "7px 0",
                borderTop: "1px solid rgba(255,255,255,0.05)",
                background: row.changed ? "rgba(16,185,129,0.06)" : "transparent",
              }}
            >
              <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{fieldLabel(row.field)}</span>
              <span style={{ fontSize: "12px", color: "#64748B" }}>{row.legacy ?? "—"}</span>
              <span style={{ fontSize: "12px", color: row.changed ? "#6EE7B7" : "#E5E7EB" }}>
                {row.langgraph ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComparisonPanel({ contractId, aiEnabled }: { contractId: string; aiEnabled: boolean }) {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    // Without AI, don't trigger a new comparison — just check once for a
    // previously-computed one (e.g. from before the key was removed) and render it.
    if (aiEnabled) {
      fetch("/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contract_id: contractId }),
      }).catch(() => {});
    }

    let attempts = 0;
    async function poll() {
      if (cancelledRef.current) return;
      try {
        const res = await fetch(`/api/compare?contract_id=${contractId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.comparison) {
            if (!cancelledRef.current) {
              startTransition(() => {
                setComparison(data.comparison);
                setLoading(false);
                const hasChanges = data.comparison.field_changes.length > 0 || data.comparison.clause_changes.length > 0;
                if (hasChanges) setExpanded(true);
              });
            }
            return;
          }
        }
      } catch {}
      if (!aiEnabled) {
        if (!cancelledRef.current) setLoading(false);
        return;
      }
      attempts++;
      if (attempts < 20 && !cancelledRef.current) {
        setTimeout(poll, 3000);
      } else if (!cancelledRef.current) {
        setLoading(false);
      }
    }
    setTimeout(poll, aiEnabled ? 3000 : 0);

    return () => { cancelledRef.current = true; };
  }, [contractId, aiEnabled]);

  const SEVERITY_COLOR: Record<string, string> = {
    high:   "#FCA5A5",
    medium: "#FCD34D",
    low:    "#6EE7B7",
  };

  const totalChanges = comparison
    ? comparison.field_changes.length + comparison.clause_changes.length
    : 0;

  // Loading — compact pulsing banner above fields (skip entirely when AI is disabled;
  // there's no new comparison to wait for, only a possible stored one already handled above)
  if (loading && !comparison) {
    if (!aiEnabled) return null;
    return (
      <div style={{
        marginBottom: "20px",
        padding: "10px 14px",
        borderRadius: "6px",
        border: "1px solid rgba(245,158,11,0.2)",
        borderLeft: "3px solid rgba(245,158,11,0.5)",
        background: "rgba(245,158,11,0.04)",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}>
        <span className="pulse-dot" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#F59E0B", display: "inline-block", flexShrink: 0 }} />
        <span style={{ fontSize: "13px", color: "#9CA3AF" }}>Comparing with previous version…</span>
      </div>
    );
  }

  if (!loading && !comparison) return null;

  return (
    <div style={{
      marginBottom: "20px",
      borderRadius: "8px",
      overflow: "hidden",
      border: "1px solid rgba(245,158,11,0.2)",
      borderLeft: "3px solid #F59E0B",
    }}>
      {/* Clickable header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "11px 14px",
          background: "rgba(245,158,11,0.07)",
          border: "none",
          cursor: "pointer",
          textAlign: "left" as const,
          fontFamily: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "13px", fontWeight: 600, color: "#E5E7EB" }}>
            Changes from previous version
          </span>
          {totalChanges > 0 && (
            <span style={{
              fontSize: "11px",
              fontFamily: "var(--font-jetbrains), monospace",
              color: "#F59E0B",
              background: "rgba(245,158,11,0.15)",
              borderRadius: "4px",
              padding: "1px 6px",
            }}>
              {totalChanges} change{totalChanges !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span style={{ fontSize: "11px", color: "#6B7280", flexShrink: 0 }}>
          {expanded ? "▲ Hide" : "▼ Show"}
        </span>
      </button>

      {/* Expandable body */}
      {expanded && comparison && (
        <div style={{ padding: "14px 16px", background: "rgba(245,158,11,0.02)" }}>
          {comparison.summary && (
            <p style={{ fontSize: "13px", color: "#D1D5DB", marginTop: 0, marginBottom: "16px", lineHeight: 1.6 }}>
              {comparison.summary}
            </p>
          )}

          {comparison.field_changes.length > 0 && (
            <div style={{ marginBottom: comparison.clause_changes.length > 0 ? "16px" : "12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#4B5563", marginBottom: "8px" }}>
                Field changes
              </div>
              {comparison.field_changes.map((fc, i) => (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: "10px 1fr auto auto",
                  alignItems: "center",
                  gap: "10px",
                  padding: "7px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <span style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: SEVERITY_COLOR[fc.severity] ?? "#6B7280",
                    flexShrink: 0,
                    justifySelf: "center",
                  }} />
                  <span style={{ fontSize: "12px", color: "#9CA3AF" }}>{fieldLabel(fc.field)}</span>
                  <span style={{ fontSize: "12px", color: "#6B7280", textDecoration: "line-through" }}>{fc.previous ?? "—"}</span>
                  <span style={{ fontSize: "12px", color: "#E5E7EB", whiteSpace: "nowrap" }}>→ {fc.current ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          {comparison.clause_changes.length > 0 && (
            <div style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" as const, color: "#4B5563", marginBottom: "8px" }}>
                Clause changes
              </div>
              {comparison.clause_changes.map((cc, i) => (
                <div key={i} style={{
                  padding: "8px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#9CA3AF", marginBottom: "4px" }}>{cc.clause}</div>
                  {cc.previous && <div style={{ fontSize: "12px", color: "#6B7280", marginBottom: "2px" }}>Was: {cc.previous}</div>}
                  {cc.current && <div style={{ fontSize: "12px", color: "#D1D5DB" }}>Now: {cc.current}</div>}
                </div>
              ))}
            </div>
          )}

          {totalChanges === 0 && (
            <div style={{ fontSize: "13px", color: "#6B7280" }}>No significant changes detected.</div>
          )}

          <div style={{ fontSize: "11px", color: "#4B5563", marginTop: "8px" }}>
            For informational purposes only · Not legal advice
          </div>
        </div>
      )}
    </div>
  );
}

export default function ReviewClient({ contract, extractions, pdfUrl, isManual, parentContractId, aiEnabled }: {
  contract: Contract; extractions: ExtractionRow[]; pdfUrl: string | null; isManual: boolean;
  parentContractId: string | null; aiEnabled: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const showExpiredBanner = !bannerDismissed && isExpired(contract);

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

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "Delete failed");
      setDeleting(false);
      setDeleteConfirm(false);
      return;
    }
    router.push("/dashboard");
  }

  async function handleManualBack() {
    // If the contract name is still the placeholder, the user abandoned without doing anything — clean up the stub
    if (contract.name === "New Contract") {
      await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" }).catch(() => {});
    }
    router.push("/dashboard");
  }

  if (isManual) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", padding: "0 16px" }}>
        <div style={{ width: "100%", maxWidth: "680px", padding: "24px 0" }}>
          {/* Manual header: back button + "Manual entry" label, no delete button */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <button onClick={handleManualBack} style={{ fontSize: "12px", color: "#6B7280", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
              ← Back to dashboard
            </button>
            <span style={{ fontSize: "12px", color: "#4B5563" }}>Manual entry</span>
          </div>

          {showExpiredBanner && contract.expiry_date && (
            <ExpiredWarningBanner
              expiryDate={contract.expiry_date}
              onDismiss={() => setBannerDismissed(true)}
            />
          )}

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
    );
  }

  return (
    <>
      <div className="flex flex-col md:flex-row h-screen overflow-hidden">
        {/* PDF panel — desktop only */}
        <div className={`hidden md:block ${pdfClass} h-full border-r border-slate-200 flex-shrink-0`}>
          {pdfUrl
            ? <iframe src={pdfUrl} className="w-full h-full" title="Contract PDF" loading="lazy" />
            : <div className="flex items-center justify-center h-full text-sm text-slate-400">PDF unavailable</div>
          }
        </div>

        {/* Fields panel */}
        <div className={`${fieldsClass} h-full overflow-y-auto`}>
          <div className="p-5">
            <Link href="/dashboard" style={{ fontSize: "12px", color: "#6B7280", textDecoration: "none", display: "inline-block", marginBottom: "16px" }}>← Back to contracts</Link>
            {showExpiredBanner && contract.expiry_date && (
              <ExpiredWarningBanner
                expiryDate={contract.expiry_date}
                onDismiss={() => setBannerDismissed(true)}
              />
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <h1 style={{ fontSize: "17px", fontWeight: 600, color: "#F9FAFB", margin: 0 }}>{contract.name || contract.file_name || "Untitled"}</h1>
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "12px",
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: "#6B7280",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: "4px",
                    padding: "7px 14px",
                    background: "transparent",
                    cursor: "pointer",
                    transition: "color 150ms ease, border-color 150ms ease",
                  }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#EF4444"; el.style.border = "1px solid rgba(239,68,68,0.4)"; }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.color = "#6B7280"; el.style.border = "1px solid rgba(255,255,255,0.12)"; }}
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
                      fontSize: "12px",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "#0A0F1E",
                      background: "#EF4444",
                      border: "1px solid #EF4444",
                      borderRadius: "4px",
                      padding: "7px 14px",
                      cursor: deleting ? "not-allowed" : "pointer",
                      opacity: deleting ? 0.6 : 1,
                    }}
                  >
                    {deleting ? "Deleting…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "12px",
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "#6B7280",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "4px",
                      padding: "7px 14px",
                      background: "transparent",
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {error && (
              <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "6px", padding: "10px 14px", marginBottom: "16px", fontSize: "13px", color: "#FCA5A5" }}>{error}</div>
            )}

            <ExtractionComparisonPanel contractId={contract.id} />
            {parentContractId && (
              <ComparisonPanel contractId={contract.id} aiEnabled={aiEnabled} />
            )}
            <FieldPanel
              name={contract.name || contract.file_name || "Untitled"}
              category={contract.category}
              extractions={extractions}
              onConfirm={handleConfirm}
              isConfirming={confirming}
              isManual={false}
            />
          </div>
        </div>
      </div>
    </>
  );
}
