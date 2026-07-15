"use client";

import { useEffect, useState, startTransition } from "react";
import Link from "next/link";

type FieldChange = {
  field: string;
  previous: string | null;
  current: string | null;
  change_type: string;
  percentage: string | null;
  severity: "high" | "medium" | "low";
};

type ClauseChange = {
  category: string;
  title: string;
  previous_state: string;
  current_state: string;
  severity: "high" | "medium" | "low";
};

type Comparison = {
  field_changes: FieldChange[];
  clause_changes: ClauseChange[];
  summary: string;
  created_at: string;
};

type VersionInfo = {
  id: string;
  name: string;
  contract_version: number;
  status: string;
  expiry_date: string | null;
  contract_value: string | null;
  created_at: string;
};

type Props = {
  contractId: string;
  parentContractId: string | null;
  versionChain: VersionInfo[];
};

const SEV_COLORS = {
  high: { bg: "rgba(239, 68, 68, 0.08)", border: "rgba(239, 68, 68, 0.25)", text: "#FCA5A5", icon: "▲" },
  medium: { bg: "rgba(245, 158, 11, 0.08)", border: "rgba(245, 158, 11, 0.25)", text: "#FCD34D", icon: "●" },
  low: { bg: "rgba(16, 185, 129, 0.08)", border: "rgba(16, 185, 129, 0.25)", text: "#6EE7B7", icon: "▼" },
} as const;

function fieldLabel(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function RenewalHistoryPanel({ contractId, parentContractId, versionChain }: Props) {
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(!!parentContractId);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!parentContractId) return;

    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    async function poll() {
      try {
        const res = await fetch(`/api/compare?contract_id=${contractId}`);
        if (!res.ok) return;
        const data = await res.json() as { comparison: Comparison | null };
        if (data.comparison && !cancelled) {
          startTransition(() => {
            setComparison(data.comparison);
            setLoading(false);
          });
          return;
        }
      } catch { /* ignore */ }

      attempts++;
      if (attempts < MAX_ATTEMPTS && !cancelled) {
        setTimeout(poll, 3000);
      } else if (!cancelled) {
        setLoading(false);
      }
    }

    poll();
    return () => { cancelled = true; };
  }, [contractId, parentContractId]);

  const highSeverityCount = comparison
    ? [...comparison.field_changes, ...comparison.clause_changes].filter((c) => c.severity === "high").length
    : 0;

  const hasChanges = comparison &&
    (comparison.field_changes.length > 0 || comparison.clause_changes.length > 0);

  return (
    <div style={{
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 10,
      background: "#111827",
      marginTop: 16,
      overflow: "hidden",
    }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 18px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#F9FAFB",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Renewal History</span>
          {versionChain.length > 1 && (
            <span style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(16,185,129,0.1)",
              color: "#10B981",
              fontWeight: 600,
            }}>
              v{versionChain.length}
            </span>
          )}
          {loading && (
            <span style={{ fontSize: 12, color: "#6B7280" }}>
              {"● Comparing…"}
            </span>
          )}
          {!loading && highSeverityCount > 0 && (
            <span style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 4,
              background: "rgba(239,68,68,0.1)",
              color: "#FCA5A5",
              fontWeight: 600,
            }}>
              {highSeverityCount} critical change{highSeverityCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <span style={{ color: "#6B7280", fontSize: 12 }}>{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div style={{ padding: "0 18px 18px" }}>
          {/* Version timeline */}
          <div style={{ marginBottom: comparison ? 20 : 0 }}>
            {versionChain.map((v, i) => (
              <div key={v.id} style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                paddingLeft: 24,
                paddingTop: 8,
                paddingBottom: 8,
                borderLeft: i < versionChain.length - 1
                  ? "2px solid rgba(255,255,255,0.08)"
                  : "2px solid #10B981",
                marginLeft: 6,
                position: "relative",
              }}>
                <div style={{
                  position: "absolute",
                  left: -5,
                  top: 14,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: v.id === contractId ? "#10B981" : "#4B5563",
                }} />
                <div style={{ flex: 1 }}>
                  <Link
                    href={`/dashboard/contracts/${v.id}`}
                    style={{
                      fontSize: 13,
                      fontWeight: v.id === contractId ? 600 : 400,
                      color: v.id === contractId ? "#F9FAFB" : "#9CA3AF",
                      textDecoration: "none",
                    }}
                  >
                    {v.name || "Untitled"}{" "}
                    <span style={{ color: "#6B7280", fontSize: 11 }}>v{v.contract_version}</span>
                  </Link>
                  <div style={{ fontSize: 11, color: "#6B7280", marginTop: 2 }}>
                    {v.contract_value && <span>{v.contract_value} · </span>}
                    {v.expiry_date && <span>Expires {v.expiry_date}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Comparison results */}
          {comparison && hasChanges && (
            <div>
              {comparison.summary && (
                <div style={{
                  padding: "10px 14px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 13,
                  color: "#D1D5DB",
                  marginBottom: 16,
                  lineHeight: 1.5,
                }}>
                  {comparison.summary}
                </div>
              )}

              {comparison.field_changes.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#6B7280",
                    marginBottom: 8,
                  }}>
                    Field Changes
                  </div>
                  {comparison.field_changes.map((fc, i) => {
                    const sev = SEV_COLORS[fc.severity];
                    return (
                      <div key={i} style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 12px",
                        borderRadius: 6,
                        background: sev.bg,
                        border: `1px solid ${sev.border}`,
                        marginBottom: 6,
                        fontSize: 13,
                        flexWrap: "wrap",
                      }}>
                        <span style={{ color: sev.text, fontSize: 10 }}>{sev.icon}</span>
                        <span style={{ color: "#9CA3AF", minWidth: 120 }}>{fieldLabel(fc.field)}</span>
                        <span style={{ color: "#6B7280", textDecoration: "line-through" }}>{fc.previous ?? "—"}</span>
                        <span style={{ color: "#6B7280" }}>→</span>
                        <span style={{ color: "#F9FAFB", fontWeight: 600 }}>{fc.current ?? "—"}</span>
                        {fc.percentage && (
                          <span style={{
                            color: fc.change_type === "increase" ? "#FCA5A5" : "#6EE7B7",
                            fontSize: 11,
                            fontWeight: 600,
                          }}>
                            {fc.percentage}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {comparison.clause_changes.length > 0 && (
                <div>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "#6B7280",
                    marginBottom: 8,
                  }}>
                    Clause Changes
                  </div>
                  {comparison.clause_changes.map((cc, i) => {
                    const sev = SEV_COLORS[cc.severity];
                    return (
                      <div key={i} style={{
                        padding: "10px 14px",
                        borderRadius: 6,
                        background: sev.bg,
                        border: `1px solid ${sev.border}`,
                        marginBottom: 6,
                      }}>
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 4,
                        }}>
                          <span style={{ color: sev.text, fontSize: 10 }}>{sev.icon}</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: "#F9FAFB" }}>{cc.title}</span>
                          <span style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            borderRadius: 3,
                            background: "rgba(255,255,255,0.05)",
                            color: "#6B7280",
                            textTransform: "uppercase",
                          }}>
                            {cc.category.replace(/_/g, " ")}
                          </span>
                        </div>
                        <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 2 }}>
                          <span style={{ textDecoration: "line-through" }}>{cc.previous_state}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#D1D5DB" }}>
                          → {cc.current_state}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          )}

          {comparison && !hasChanges && (
            <div style={{ fontSize: 13, color: "#6B7280", textAlign: "center", padding: "8px 0" }}>
              No significant changes detected between versions.
            </div>
          )}

          {comparison && (
            <div style={{
              marginTop: 16,
              fontSize: 11,
              color: "#4B5563",
              textAlign: "center",
            }}>
              For informational purposes only · Not legal advice
            </div>
          )}
        </div>
      )}
    </div>
  );
}
