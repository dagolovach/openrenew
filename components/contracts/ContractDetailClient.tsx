// components/contracts/ContractDetailClient.tsx
"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RenewalUploadButton from "./RenewalUploadButton";

const ContractIntelligencePanel = dynamic(() => import("./ContractIntelligencePanel"), { ssr: false });
const RenewalHistoryPanel = dynamic(() => import("./RenewalHistoryPanel"), { ssr: false });
import { isExpired, daysUntil, activeExpiryDate } from "@/lib/utils";

export type Contract = {
  id: string;
  name: string;
  file_name: string | null;
  party_a: string | null;
  party_b: string | null;
  category: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  renewal_date: string | null;
  auto_renew: boolean | null;
  notice_period_days: number | null;
  notice_period_text: string | null;
  contract_value: string | null;
  extraction_confidence: number | null;
  status: string | null;
  parent_contract_id: string | null;
  contract_version: number | null;
  annual_value: number | null;
  renewal_decision: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatContractName(raw: string): string {
  return raw
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function categoryLabel(cat: string | null): string | null {
  if (!cat) return null;
  const map: Record<string, string> = {
    saas: "SaaS",
    lease: "Lease",
    vendor: "Vendor",
    employment: "Employment",
    other: "Other",
  };
  return map[cat.toLowerCase()] ?? cat;
}

const DECISION_BADGE: Record<string, { label: string; color: string }> = {
  renewing: { label: "Renewing", color: "#10B981" },
  canceling: { label: "Canceling", color: "#dc2626" },
  negotiating: { label: "Negotiating", color: "#f59e0b" },
};

function DecisionBadgeWithClear({ contractId, decision }: { contractId: string; decision: string | null }) {
  const router = useRouter();
  const [clearing, setClearing] = useState(false);

  if (!decision) return null;
  const cfg = DECISION_BADGE[decision];
  if (!cfg) return null;

  async function handleClear() {
    setClearing(true);
    try {
      const res = await fetch(`/api/contracts/${contractId}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: null }),
      });
      if (res.ok) router.refresh();
    } finally {
      setClearing(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
      <span
        style={{
          fontSize: "10px",
          fontFamily: "var(--font-jetbrains), monospace",
          padding: "2px 6px",
          borderRadius: "4px",
          background: "transparent",
          border: `1px solid ${cfg.color}`,
          color: cfg.color,
        }}
      >
        {cfg.label}
      </span>
      <button
        type="button"
        onClick={handleClear}
        disabled={clearing}
        style={{
          fontSize: "11px",
          color: "#6B7280",
          background: "none",
          border: "none",
          padding: 0,
          cursor: clearing ? "not-allowed" : "pointer",
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          textDecoration: "none",
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.textDecoration = "underline")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.textDecoration = "none")}
      >
        {clearing ? "Clearing…" : "clear"}
      </button>
    </span>
  );
}

type BandColors = {
  stripe: string;
  bgTint: string;
  border: string;
  countdownColor: string;
};

function heroBandColors(contract: Contract, expired: boolean): BandColors {
  if (expired) {
    return {
      stripe: "#374151",
      bgTint: "rgba(255,255,255,0.03)",
      border: "rgba(255,255,255,0.08)",
      countdownColor: "#6B7280",
    };
  }
  const expiry = activeExpiryDate(contract);
  if (!expiry) {
    return {
      stripe: "#10B981",
      bgTint: "rgba(16,185,129,0.05)",
      border: "rgba(16,185,129,0.15)",
      countdownColor: "#10B981",
    };
  }
  const days = daysUntil(expiry);
  if (days <= 30) {
    return {
      stripe: "#EF4444",
      bgTint: "rgba(239,68,68,0.05)",
      border: "rgba(239,68,68,0.18)",
      countdownColor: "#EF4444",
    };
  }
  if (days <= 60) {
    return {
      stripe: "#F59E0B",
      bgTint: "rgba(245,158,11,0.05)",
      border: "rgba(245,158,11,0.18)",
      countdownColor: "#F59E0B",
    };
  }
  return {
    stripe: "#10B981",
    bgTint: "rgba(16,185,129,0.05)",
    border: "rgba(16,185,129,0.15)",
    countdownColor: "#10B981",
  };
}

// ── Notice deadline helpers ───────────────────────────────────────────────────

function noticeDeadlineDateStr(contract: Contract): string | null {
  const target = contract.renewal_date ?? contract.expiry_date;
  if (!target || !contract.notice_period_days) return null;
  const d = new Date(target + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - contract.notice_period_days);
  return formatDate(d.toISOString());
}

function noticeDeadlineIso(contract: Contract): string | null {
  const target = contract.renewal_date ?? contract.expiry_date;
  if (!target || !contract.notice_period_days) return null;
  const d = new Date(target + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - contract.notice_period_days);
  return d.toISOString().slice(0, 10);
}

function noticeDeadlineDaysLeft(contract: Contract): number | null {
  const iso = noticeDeadlineIso(contract);
  if (!iso) return null;
  return daysUntil(iso);
}

// Returns urgency colour for a future-facing date value in the details list.
// Past dates get default text colour (no urgency colouring).
function dateUrgencyColor(isoDate: string): string {
  const days = daysUntil(isoDate);
  if (days < 0) return "#F9FAFB";
  if (days <= 30) return "#EF4444";
  if (days <= 60) return "#F59E0B";
  return "#F9FAFB";
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ContractDetailClient({
  contract,
  versionChain,
  aiEnabled,
}: {
  contract: Contract;
  versionChain: Array<{
    id: string;
    name: string | null;
    contract_version: number | null;
    status: string | null;
    expiry_date: string | null;
    contract_value: string | null;
    created_at: string;
    parent_contract_id: string | null;
  }>;
  aiEnabled: boolean;
}) {
  const contractExpired = isExpired(contract);
  const bandColors = heroBandColors(contract, contractExpired);
  const expiryDate = activeExpiryDate(contract);
  const daysLeft = expiryDate ? daysUntil(expiryDate) : null;

  const noticeDateStr = noticeDeadlineDateStr(contract);
  const noticeDaysLeft = noticeDeadlineDaysLeft(contract);
  const noticeIso = noticeDeadlineIso(contract);

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editedAnnualValue, setEditedAnnualValue] = useState<string>(
    contract.annual_value != null ? String(contract.annual_value) : ""
  );
  const [annualValueSaved, setAnnualValueSaved] = useState<number | null>(null);
  const [editingAnnualValue, setEditingAnnualValue] = useState(false);

  // ── Delete handler ────────────────────────────────────────────────────────
  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        setDeleting(false);
        setDeleteConfirm(false);
      }
    } catch {
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  // ── Single most-urgent badge ───────────────────────────────────────────────
  // Priority: (1) notice deadline exists & in future → (2) auto-renew → (3) expired → (4) confirmed
  // Notice deadline: amber styling ≤90d, green styling >90d — always beats auto-renew/confirmed
  const badge = (() => {
    if (!contractExpired && noticeDaysLeft !== null && noticeDaysLeft > 0) {
      const suffix = `in ${noticeDaysLeft} days`;
      const isUrgent = noticeDaysLeft <= 90;
      return {
        text: `⚡ Notice deadline: ${noticeDateStr} · ${suffix}`,
        color: isUrgent ? "#F59E0B" : "#10B981",
        bg: isUrgent ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.05)",
        border: isUrgent ? "rgba(245,158,11,0.3)" : "rgba(16,185,129,0.15)",
        mono: false,
      };
    }
    if (!contractExpired && contract.auto_renew) {
      return {
        text: "AUTO-RENEWS",
        color: "#F59E0B",
        bg: "transparent",
        border: "rgba(245,158,11,0.35)",
        mono: true,
      };
    }
    if (contractExpired) {
      return {
        text: "EXPIRED",
        color: "#6B7280",
        bg: "transparent",
        border: "rgba(255,255,255,0.2)",
        mono: true,
      };
    }
    return {
      text: "CONFIRMED",
      color: "#10B981",
      bg: "transparent",
      border: "rgba(16,185,129,0.3)",
      mono: true,
    };
  })();

  // ── Details key-value rows ─────────────────────────────────────────────────
  type DetailRow = {
    label: string;
    value: string;
    color?: string;
    dateIso?: string;
    useInter?: boolean;
  };

  const detailRows: DetailRow[] = [];

  if (contract.effective_date) {
    detailRows.push({ label: "EFFECTIVE DATE", value: formatDate(contract.effective_date), dateIso: contract.effective_date });
  }
  if (contract.expiry_date) {
    detailRows.push({ label: "EXPIRY DATE", value: formatDate(contract.expiry_date), dateIso: contract.expiry_date });
  }
  if (contract.renewal_date) {
    detailRows.push({ label: "RENEWAL DATE", value: formatDate(contract.renewal_date), dateIso: contract.renewal_date });
  }
  if (contract.notice_period_days != null) {
    detailRows.push({ label: "NOTICE PERIOD", value: `${contract.notice_period_days} days` });
  }
  if (noticeDateStr && noticeIso && !contractExpired) {
    detailRows.push({ label: "NOTICE DEADLINE", value: noticeDateStr, dateIso: noticeIso });
  }
  if (contract.contract_value) {
    detailRows.push({ label: "CONTRACT VALUE", value: contract.contract_value, useInter: true });
  }
  if (contract.extraction_confidence != null) {
    detailRows.push({ label: "CONFIDENCE", value: `${(contract.extraction_confidence * 100).toFixed(1)}%`, color: "#10B981" });
  }
  if (contract.category) {
    detailRows.push({ label: "CATEGORY", value: categoryLabel(contract.category) ?? contract.category, useInter: true });
  }

  useEffect(() => {
    const id = "cd-responsive-styles";
    if (document.getElementById(id)) return;
    const tag = document.createElement("style");
    tag.id = id;
    tag.textContent = `
      .cd-actions-row { display: flex; }
      .cd-inline-delete { display: none; }
      .cd-mobile-btn { display: none; }
      .hero-main { flex-direction: row; }
      .days-col { align-items: flex-end; }
      @media (max-width: 768px) {
        .cd-actions-row { display: none !important; }
        .cd-inline-delete { display: flex !important; }
        .cd-mobile-btn { display: flex !important; }
        .hero-main { flex-direction: column !important; align-items: flex-start !important; gap: 12px !important; }
        .days-col { align-items: flex-start !important; margin-left: 0 !important; }
      }
    `;
    document.head.appendChild(tag);
    return () => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0A0F1E",
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        padding: "32px 24px 64px",
      }}
    >

      <div style={{ maxWidth: "900px", margin: "0 auto" }}>

        {/* ── Back link ── */}
        <div style={{ marginBottom: "24px" }}>
          <Link
            href="/dashboard"
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              color: "#4B5563",
              textDecoration: "none",
              letterSpacing: "0.04em",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#9CA3AF")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#4B5563")}
          >
            ← Back to dashboard
          </Link>
        </div>

        {/* ══════════════════════════════════════════════════════════
            ZONE 1 — HEADLINE CARD
        ══════════════════════════════════════════════════════════ */}
        <div
          style={{
            position: "relative",
            background: bandColors.bgTint,
            border: `1px solid ${bandColors.border}`,
            borderRadius: "6px",
            padding: "20px 24px 18px 28px",
            marginBottom: "6px",
            overflow: "hidden",
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget.querySelector<HTMLElement>(".cd-actions-row");
            if (el) { el.style.opacity = "1"; el.style.pointerEvents = "auto"; }
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget.querySelector<HTMLElement>(".cd-actions-row");
            if (el) { el.style.opacity = "0"; el.style.pointerEvents = "none"; }
          }}
        >
          {/* 3px urgency stripe */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "3px",
              background: bandColors.stripe,
              borderRadius: "3px 0 0 3px",
            }}
          />

          {/* ── Mobile: ··· menu button ── */}
          <button
            className="cd-mobile-btn"
            onClick={() => setMobileMenuOpen((o) => !o)}
            style={{
              position: "absolute",
              top: "16px",
              right: "16px",
              fontSize: "18px",
              letterSpacing: "0.1em",
              color: "#6B7280",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              fontFamily: "var(--font-inter), system-ui",
              display: "none",
            }}
          >
            ···
          </button>

          {/* ── Mobile: dropdown menu ── */}
          {mobileMenuOpen && (
            <div
              style={{
                position: "absolute",
                top: "48px",
                right: "16px",
                background: "#111827",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "6px",
                overflow: "hidden",
                zIndex: 20,
                minWidth: "130px",
              }}
            >
              <Link
                href={`/dashboard/review/${contract.id}?reopen=1`}
                style={{
                  display: "block",
                  padding: "11px 16px",
                  fontSize: "13px",
                  color: "#D1D5DB",
                  textDecoration: "none",
                  fontFamily: "var(--font-inter), system-ui",
                }}
                onClick={() => setMobileMenuOpen(false)}
              >
                Edit
              </Link>
              <button
                onClick={() => {
                  setDeleteConfirm(true);
                  setMobileMenuOpen(false);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "11px 16px",
                  fontSize: "13px",
                  color: "#EF4444",
                  background: "none",
                  border: "none",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  cursor: "pointer",
                  fontFamily: "var(--font-inter), system-ui",
                }}
              >
                Delete
              </button>
            </div>
          )}

          {/* ── Mobile: delete confirmation bar ── */}
          {deleteConfirm && (
            <div
              className="cd-inline-delete"
              style={{
                gap: "8px",
                alignItems: "center",
                marginBottom: "14px",
              }}
            >
              <button
                onClick={handleDelete}
                disabled={deleting}
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#0A0F1E",
                  background: "#EF4444",
                  border: "1px solid #EF4444",
                  borderRadius: "4px",
                  padding: "5px 12px",
                  cursor: deleting ? "not-allowed" : "pointer",
                  opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                onClick={() => setDeleteConfirm(false)}
                style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "#6B7280",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "4px",
                  padding: "5px 12px",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* ── Main row: name+parties (left) | days (right) ── */}
          <div
            className="hero-main"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              marginBottom: "14px",
            }}
          >
            {/* Left column */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
                <h1
                  style={{
                    fontFamily: "var(--font-inter), system-ui, sans-serif",
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "#F9FAFB",
                    margin: 0,
                    letterSpacing: "0.01em",
                    lineHeight: 1.2,
                  }}
                >
                  {formatContractName(contract.name)}
                </h1>
                <DecisionBadgeWithClear contractId={contract.id} decision={contract.renewal_decision} />
              </div>

              {(contract.party_a || contract.party_b) && (
                <div
                  style={{
                    fontFamily: "var(--font-inter), system-ui, sans-serif",
                    fontSize: "13px",
                    color: "#9CA3AF",
                  }}
                >
                  {contract.party_a && (
                    <span>{contract.party_a}</span>
                  )}
                  {contract.party_a && contract.party_b && (
                    <span style={{ color: "#374151", margin: "0 8px" }}>↔</span>
                  )}
                  {contract.party_b && (
                    <span>{contract.party_b}</span>
                  )}
                </div>
              )}
            </div>

            {/* Right column: actions (fade in/out) + countdown + date */}
            <div
              className="days-col"
              style={{
                display: "flex",
                flexDirection: "column",
                flexShrink: 0,
                marginLeft: "32px",
                gap: "4px",
              }}
            >
              {/* Actions area — always occupies 20px, fades in on hover. Hidden on mobile. */}
              {!deleteConfirm ? (
                <div
                  className="cd-actions-row"
                  style={{
                    gap: "16px",
                    height: "20px",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    opacity: 0,
                    transition: "opacity 120ms ease",
                    pointerEvents: "none",
                  }}
                >
                  <Link
                    href={`/dashboard/review/${contract.id}?reopen=1`}
                    style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      textDecoration: "none",
                      fontFamily: "var(--font-inter), system-ui",
                      transition: "color 120ms ease",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#9CA3AF")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.color = "#6B7280")}
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => setDeleteConfirm(true)}
                    style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      fontFamily: "var(--font-inter), system-ui",
                      padding: 0,
                      transition: "color 120ms ease",
                    }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#EF4444")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#6B7280")}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <div
                  className="cd-actions-row"
                  style={{
                    gap: "8px",
                    height: "20px",
                    alignItems: "center",
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "11px",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "#0A0F1E",
                      background: "#EF4444",
                      border: "none",
                      borderRadius: "3px",
                      padding: "2px 10px",
                      cursor: deleting ? "not-allowed" : "pointer",
                      opacity: deleting ? 0.6 : 1,
                      whiteSpace: "nowrap",
                      lineHeight: "16px",
                    }}
                  >
                    {deleting ? "Deleting…" : "Confirm"}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(false)}
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "11px",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "#6B7280",
                      border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: "3px",
                      padding: "2px 10px",
                      background: "transparent",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                      lineHeight: "16px",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Countdown */}
              {contractExpired ? (
                <>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "36px",
                      fontWeight: 700,
                      color: "#6B7280",
                      letterSpacing: "0.04em",
                      lineHeight: 1,
                      textAlign: "right",
                    }}
                  >
                    EXPIRED
                  </div>
                  {contract.expiry_date && (
                    <div
                      style={{
                        fontFamily: "var(--font-jetbrains), monospace",
                        fontSize: "12px",
                        color: "#4B5563",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        textAlign: "right",
                      }}
                    >
                      {formatDate(contract.expiry_date)}
                    </div>
                  )}
                </>
              ) : expiryDate ? (
                <>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "48px",
                      fontWeight: 700,
                      color: bandColors.countdownColor,
                      lineHeight: 1,
                      letterSpacing: "-0.02em",
                      textAlign: "right",
                    }}
                  >
                    {daysLeft}
                    <span
                      style={{
                        fontSize: "20px",
                        fontWeight: 400,
                        marginLeft: "6px",
                        letterSpacing: "0.02em",
                        opacity: 0.7,
                      }}
                    >
                      days
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-jetbrains), monospace",
                      fontSize: "12px",
                      color: "#6B7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      textAlign: "right",
                    }}
                  >
                    Expires {formatDate(expiryDate)}
                  </div>
                </>
              ) : (
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "#10B981",
                    letterSpacing: "0.04em",
                    textAlign: "right",
                  }}
                >
                  ACTIVE
                </div>
              )}
            </div>
          </div>

          {/* ── Single most-urgent badge ── */}
          <div>
            <span
              style={{
                display: "inline-block",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: badge.mono ? "10px" : "11px",
                fontWeight: badge.mono ? 700 : 400,
                letterSpacing: badge.mono ? "0.12em" : "0.02em",
                textTransform: badge.mono ? "uppercase" : "none",
                color: badge.color,
                background: badge.bg,
                border: `1px solid ${badge.border}`,
                borderRadius: "3px",
                padding: "4px 10px",
                whiteSpace: "nowrap",
              }}
            >
              {badge.text}
            </span>
          </div>
        </div>
        {/* ── END ZONE 1 ── */}

        {/* ── Upload renewal button (confirmed contracts only) ── */}
        {contract.status === "active" && (
          <div style={{ marginBottom: "12px" }}>
            <RenewalUploadButton contractId={contract.id} aiEnabled={aiEnabled} />
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════
            ZONE 2 — DETAILS (collapsed by default)
        ══════════════════════════════════════════════════════════ */}
        <div style={{ marginBottom: "12px" }}>
          <button
            onClick={() => setDetailsOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "7px",
              width: "100%",
              background: "none",
              border: "none",
              borderBottom: detailsOpen ? "none" : "1px solid rgba(255,255,255,0.06)",
              padding: "12px 0",
              cursor: "pointer",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: "13px",
              color: "#9CA3AF",
              textAlign: "left",
              transition: "color 150ms ease",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#D1D5DB")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#9CA3AF")}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "10px",
                display: "inline-block",
                transition: "transform 200ms ease",
                transform: detailsOpen ? "rotate(90deg)" : "rotate(0deg)",
              }}
            >
              ▸
            </span>
            Contract details
          </button>

          {detailsOpen && (
            <div
              style={{
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                paddingBottom: "4px",
              }}
            >
              {detailRows.map(({ label, value, color, dateIso, useInter }) => {
                let valueColor = color ?? "#F9FAFB";
                if (!color && dateIso && !contractExpired) {
                  valueColor = dateUrgencyColor(dateIso);
                }
                return (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      padding: "8px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "var(--font-jetbrains), monospace",
                        fontSize: "11px",
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#6B7280",
                        width: "160px",
                        flexShrink: 0,
                      }}
                    >
                      {label}
                    </div>
                    <div
                      style={{
                        fontFamily: useInter
                          ? "var(--font-inter), system-ui, sans-serif"
                          : "var(--font-jetbrains), monospace",
                        fontSize: "13px",
                        color: valueColor,
                        flex: 1,
                      }}
                    >
                      {value}
                    </div>
                  </div>
                );
              })}

              {/* ── Annual value ── */}
              {(() => {
                const displayAnnualValue = annualValueSaved ?? contract.annual_value;

                if (displayAnnualValue != null && !editingAnnualValue) {
                  return (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280" }}>Annual value</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "13px", color: "#F9FAFB" }}>
                          ${displayAnnualValue.toLocaleString()}/yr
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditedAnnualValue(String(displayAnnualValue));
                            setEditingAnnualValue(true);
                          }}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "#6B7280", fontSize: "11px", padding: "0",
                            fontFamily: "var(--font-inter), sans-serif",
                            textDecoration: "underline",
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280" }}>Annual value</span>
                    <div style={{ marginTop: "6px", display: "flex", gap: "8px", alignItems: "center" }}>
                      <input
                        type="number"
                        value={editedAnnualValue}
                        onChange={(e) => setEditedAnnualValue(e.target.value)}
                        placeholder="0"
                        style={{
                          width: "120px", padding: "6px 10px", fontSize: "13px",
                          background: "#1E293B", border: "1px solid #334155",
                          borderRadius: "6px", color: "#F1F5F9", outline: "none",
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const val = parseFloat(editedAnnualValue);
                          if (isNaN(val)) return;
                          const res = await fetch(`/api/contracts/${contract.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ annual_value: val }),
                          });
                          if (!res.ok) return;
                          setAnnualValueSaved(val);
                          setEditingAnnualValue(false);
                        }}
                        style={{
                          padding: "6px 12px", fontSize: "12px", background: "#10B981",
                          border: "none", borderRadius: "6px", color: "#0A0F1E",
                          fontFamily: "var(--font-jetbrains), monospace", fontWeight: 700, cursor: "pointer",
                        }}
                      >
                        Save
                      </button>
                      {displayAnnualValue != null && (
                        <button
                          type="button"
                          onClick={() => setEditingAnnualValue(false)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "#6B7280", fontSize: "11px", padding: "0",
                            fontFamily: "var(--font-inter), sans-serif", textDecoration: "underline",
                          }}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "#4B5563", marginTop: "4px" }}>
                      Used for dollar amounts on contract cards and email alerts
                    </p>
                  </div>
                );
              })()}

              {contract.notice_period_text && (
                <div
                  style={{
                    padding: "12px 0 8px",
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                    fontFamily: "var(--font-inter), system-ui, sans-serif",
                    fontSize: "12px",
                    color: "#6B7280",
                    fontStyle: "italic",
                    lineHeight: 1.6,
                  }}
                >
                  Notice clause: &ldquo;{contract.notice_period_text}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>
        {/* ── END ZONE 2 ── */}

        {/* ══════════════════════════════════════════════════════════
            ZONE 3 — CONTRACT INTELLIGENCE (unchanged)
        ══════════════════════════════════════════════════════════ */}
        {contract.file_name !== null && <ContractIntelligencePanel
          contractId={contract.id}
          aiEnabled={aiEnabled}
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
        />}

        {/* ── Renewal history (shown when there are multiple versions or contract has a parent) ── */}
        {(versionChain.length > 1 || contract.parent_contract_id) && (
          <RenewalHistoryPanel
            contractId={contract.id}
            parentContractId={contract.parent_contract_id ?? null}
            versionChain={versionChain.map((v) => ({
              id: v.id,
              name: v.name ?? "",
              contract_version: v.contract_version ?? 1,
              status: v.status ?? "",
              expiry_date: v.expiry_date,
              contract_value: v.contract_value,
              created_at: v.created_at,
            }))}
          />
        )}
      </div>
    </div>
  );
}
