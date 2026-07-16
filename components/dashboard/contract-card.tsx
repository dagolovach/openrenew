// components/dashboard/contract-card.tsx
"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { formatExpiredDate } from "@/lib/utils";

export type CardState =
  | { type: "processing" }
  | { type: "analyzing" }
  | { type: "party_review" }
  | { type: "draft"; unresolvedCount: number }
  | { type: "active"; urgency: "green" | "amber" | "red"; expiryDate: string | null; daysLeft: number | null; partyA: string | null; partyB: string | null; annualValue?: number | null }
  | { type: "expired"; expiryDate: string | null; partyA: string | null; partyB: string | null; annualValue?: number | null }
  | { type: "manual"; message: string };

function formatContractName(raw: string): string {
  return raw
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cardStateEqual(a: CardState, b: CardState): boolean {
  if (a.type !== b.type) return false;
  if (a.type === "active" && b.type === "active") {
    return (
      a.urgency === b.urgency &&
      a.expiryDate === b.expiryDate &&
      a.daysLeft === b.daysLeft &&
      a.partyA === b.partyA &&
      a.partyB === b.partyB &&
      a.annualValue === b.annualValue
    );
  }
  if (a.type === "draft" && b.type === "draft") return a.unresolvedCount === b.unresolvedCount;
  if (a.type === "manual" && b.type === "manual") return a.message === b.message;
  if (a.type === "expired" && b.type === "expired") return a.expiryDate === b.expiryDate && a.partyA === b.partyA && a.partyB === b.partyB && a.annualValue === b.annualValue;
  return true; // processing / analyzing (no payload fields to compare)
}

const STRIPE: Record<string, string> = {
  red:   "#EF4444",
  amber: "#F59E0B",
  green: "#10B981",
  gray:  "#374151",
  none:  "transparent",
};

const ROW: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  minHeight: "48px",
  padding: "0 16px 0 0",
  cursor: "pointer",
  position: "relative",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  transition: "background 120ms ease",
  userSelect: "none" as const,
};

function formatShortDate(iso: string): string {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildPartiesStr(partyA?: string | null, partyB?: string | null): string | null {
  if (partyA && partyB) return `${partyA} ↔ ${partyB}`;
  if (partyA) return partyA;
  if (partyB) return partyB;
  return null;
}

const DECISION_BADGE: Record<string, { label: string; color: string }> = {
  renewing: { label: "Renewing", color: "#10B981" },
  canceling: { label: "Canceling", color: "#dc2626" },
  negotiating: { label: "Negotiating", color: "#f59e0b" },
};

function DecisionBadge({ decision }: { decision?: string | null }) {
  if (!decision) return null;
  const cfg = DECISION_BADGE[decision];
  if (!cfg) return null;
  return (
    <span
      style={{
        fontSize: "10px",
        fontFamily: "var(--font-jetbrains), monospace",
        padding: "2px 6px",
        borderRadius: "4px",
        background: "transparent",
        border: `1px solid ${cfg.color}`,
        color: cfg.color,
        flexShrink: 0,
      }}
    >
      {cfg.label}
    </span>
  );
}

const ContractCard = React.memo(
  function ContractCard({
    id,
    name,
    partyA,
    partyB,
    contractValue,
    noticePeriodDays,
    renewalDecision,
    cardState,
    onDelete,
  }: {
    id: string;
    name: string;
    partyA?: string | null;
    partyB?: string | null;
    contractValue?: string | null;
    noticePeriodDays?: number | null;
    renewalDecision?: string | null;
    cardState: CardState;
    onDelete?: () => void;
  }) {
    const router = useRouter();
    const [hovered, setHovered] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [deleting, setDeleting] = useState(false);

    function initiateDelete(e: React.MouseEvent) {
      e.stopPropagation();
      setDeleteConfirm(true);
    }

    function cancelDelete(e: React.MouseEvent) {
      e.stopPropagation();
      setDeleteConfirm(false);
    }

    async function confirmDelete(e: React.MouseEvent) {
      e.stopPropagation();
      setDeleting(true);
      const res = await fetch(`/api/contracts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setDeleting(false);
        setDeleteConfirm(false);
        return;
      }
      onDelete?.();
    }

    const displayName = formatContractName(name);

    const btnBase: React.CSSProperties = {
      fontFamily: "var(--font-jetbrains), monospace",
      fontSize: "11px",
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      borderRadius: "3px",
      padding: "3px 8px",
      cursor: "pointer",
      background: "transparent",
      border: "1px solid rgba(255,255,255,0.1)",
      color: "#6B7280",
    };

    const confirmBtns = (
      <>
        <button
          onClick={confirmDelete}
          disabled={deleting}
          style={{
            ...btnBase,
            color: "#0A0F1E",
            background: "#EF4444",
            border: "1px solid #EF4444",
            cursor: deleting ? "not-allowed" : "pointer",
            opacity: deleting ? 0.6 : 1,
          }}
        >
          {deleting ? "Deleting…" : "Confirm"}
        </button>
        <button onClick={cancelDelete} style={{ ...btnBase, cursor: "pointer" }}>
          Cancel
        </button>
      </>
    );

    const deleteBtn = (
      <button
        onClick={initiateDelete}
        style={{ ...btnBase, cursor: "pointer" }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#EF4444";
          (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(239,68,68,0.35)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#6B7280";
          (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(255,255,255,0.1)";
        }}
      >
        Delete
      </button>
    );

    const editLink = (
      <button
        onClick={(e) => { e.stopPropagation(); router.push(`/dashboard/review/${id}`); }}
        style={{ ...btnBase }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#E5E7EB";
          (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(255,255,255,0.2)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.color = "#6B7280";
          (e.currentTarget as HTMLButtonElement).style.border = "1px solid rgba(255,255,255,0.1)";
        }}
      >
        Edit
      </button>
    );

    const visible = hovered || deleteConfirm;

    // Edit + Delete — for confirmed/expired rows
    const hoverActions = (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          opacity: visible ? 1 : 0,
          transition: "opacity 120ms ease",
          flexShrink: 0,
          marginRight: "12px",
        }}
      >
        {deleteConfirm ? confirmBtns : <>{editLink}{deleteBtn}</>}
      </div>
    );

    // Delete only — for review/manual rows
    const deleteOnly = (
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          opacity: visible ? 1 : 0,
          transition: "opacity 120ms ease",
          flexShrink: 0,
          marginRight: "12px",
        }}
      >
        {deleteConfirm ? confirmBtns : deleteBtn}
      </div>
    );

    // ── processing ──────────────────────────────────────────────────────────

    if (cardState.type === "processing") {
      return (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
          style={{
            ...ROW,
            background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
            cursor: "default",
          }}
        >
          <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
          <div style={{ width: "16px", flexShrink: 0 }} />
          <div style={{
            flex: 1,
            minWidth: 0,
            color: "#9CA3AF",
            fontStyle: "italic",
            fontSize: "14px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {displayName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <span
              className="pulse-dot"
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#10B981",
                display: "inline-block",
              }}
            />
            <span style={{
              fontSize: "12px",
              color: "#6B7280",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              Extracting…
            </span>
          </div>
        </div>
      );
    }

    // ── analyzing ──────────────────────────────────────────────────────────

    if (cardState.type === "analyzing") {
      return (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
          style={{
            ...ROW,
            background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
            cursor: "default",
          }}
        >
          <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
          <div style={{ width: "16px", flexShrink: 0 }} />
          <div style={{
            flex: 1,
            minWidth: 0,
            color: "#9CA3AF",
            fontStyle: "italic",
            fontSize: "14px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {displayName}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <span
              className="pulse-dot"
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: "#10B981",
                display: "inline-block",
              }}
            />
            <span style={{
              fontSize: "12px",
              color: "#6B7280",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              Analyzing…
            </span>
          </div>
        </div>
      );
    }

    // ── party_review ──────────────────────────────────────────────────────────

    if (cardState.type === "party_review") {
      return (
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
          style={{
            ...ROW,
            background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
            cursor: "default",
          }}
        >
          <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
          <div style={{ width: "16px", flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, padding: "6px 0" }}>
            <div style={{
              fontSize: "14px",
              color: "#9CA3AF",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {displayName}
            </div>
            <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>
              Upload interrupted — re-upload to continue
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flexShrink: 0 }}>
            <span style={{
              fontSize: "11px",
              color: "#F59E0B",
              background: "rgba(245,158,11,0.1)",
              borderRadius: "3px",
              padding: "2px 6px",
              whiteSpace: "nowrap",
            }}>
              Awaiting confirmation
            </span>
            {deleteOnly}
          </div>
        </div>
      );
    }

    // ── review ───────────────────────────────────────────────────────────────

    if (cardState.type === "draft") {
      const label = cardState.unresolvedCount > 0
        ? `${cardState.unresolvedCount} field${cardState.unresolvedCount === 1 ? "" : "s"} · Review →`
        : "Ready to confirm · Review →";

      return (
        <div
          onClick={() => router.push(`/dashboard/review/${id}`)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
          style={{
            ...ROW,
            background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
            cursor: "pointer",
          }}
        >
          <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
          <div style={{ width: "16px", flexShrink: 0 }} />
          <div style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            overflow: "hidden",
          }}>
            <span style={{
              fontSize: "14px",
              color: "#F9FAFB",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {displayName}
            </span>
            <span
              style={{
                fontSize: "11px",
                color: "#F59E0B",
                background: "rgba(245,158,11,0.1)",
                borderRadius: "3px",
                padding: "2px 6px",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {label}
            </span>
          </div>
          {deleteOnly}
        </div>
      );
    }

    // ── confirmed ─────────────────────────────────────────────────────────────

    if (cardState.type === "active") {
      const { urgency, expiryDate, daysLeft } = cardState;
      const stripeColor = STRIPE[urgency];
      const urgencyColor = urgency === "red" ? "#EF4444" : urgency === "amber" ? "#F59E0B" : "#10B981";
      const partiesStr = buildPartiesStr(partyA, partyB);

      // Notice badge — show when within notice_period_days + 7 days of expiry
      const noticeActByDate =
        noticePeriodDays && expiryDate
          ? (() => {
              const d = new Date(expiryDate + "T00:00:00Z");
              d.setUTCDate(d.getUTCDate() - noticePeriodDays);
              return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
            })()
          : null;
      const showNoticeBadge =
        daysLeft !== null && noticePeriodDays != null && daysLeft <= noticePeriodDays + 7;

      // Countdown subtitle: "Apr 1 · $12,000"
      const datePart = expiryDate ? formatShortDate(expiryDate) : null;
      const valuePart = contractValue || null;
      const subtitle = [datePart, valuePart].filter(Boolean).join(" · ");

      return (
        <div
          onClick={() => router.push(`/dashboard/contracts/${id}`)}
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
          style={{
            ...ROW,
            background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
          }}
        >
          <div style={{ width: "3px", alignSelf: "stretch", background: stripeColor, flexShrink: 0 }} />
          <div style={{ width: "16px", flexShrink: 0 }} />

          {/* Name + parties + notice badge */}
          <div style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "2px",
            overflow: "hidden",
            padding: "6px 0",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
              <span style={{
                fontSize: "14px",
                fontWeight: 500,
                color: "#F9FAFB",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {displayName}
              </span>
              <DecisionBadge decision={renewalDecision} />
              {showNoticeBadge && noticeActByDate && (
                <span style={{
                  fontSize: "11px",
                  color: "#EF4444",
                  background: "rgba(239,68,68,0.1)",
                  borderRadius: "3px",
                  padding: "2px 6px",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                }}>
                  Notice: act by {noticeActByDate}
                </span>
              )}
            </div>
            {partiesStr && (
              <div style={{
                fontSize: "12px",
                color: "#6B7280",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {partiesStr}
                {cardState.annualValue != null && (
                  <span style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "11px",
                    color: "#6B7280",
                    marginLeft: "8px",
                  }}>
                    ${cardState.annualValue.toLocaleString()}/yr
                  </span>
                )}
              </div>
            )}
            {!partiesStr && cardState.annualValue != null && (
              <div style={{
                fontSize: "12px",
                color: "#6B7280",
              }}>
                <span style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  color: "#6B7280",
                }}>
                  ${cardState.annualValue.toLocaleString()}/yr
                </span>
              </div>
            )}
          </div>

          {/* Hover actions */}
          {hoverActions}

          {/* Countdown column */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            justifyContent: "center",
            flexShrink: 0,
            minWidth: "88px",
            textAlign: "right",
          }}>
            {daysLeft !== null ? (
              <>
                <div style={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: urgencyColor,
                  fontFamily: "var(--font-jetbrains), monospace",
                  lineHeight: 1,
                }}>
                  {daysLeft} days
                </div>
                {subtitle && (
                  <div style={{
                    fontSize: "10px",
                    color: "#6B7280",
                    textTransform: "uppercase",
                    fontFamily: "var(--font-jetbrains), monospace",
                    marginTop: "3px",
                    letterSpacing: "0.05em",
                  }}>
                    {subtitle}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: "12px", color: "#374151" }}>—</div>
            )}
          </div>
        </div>
        </div>
      );
    }

    // ── expired ───────────────────────────────────────────────────────────────

    if (cardState.type === "expired") {
      const { expiryDate } = cardState;
      const formattedExpiry = expiryDate ? formatExpiredDate(expiryDate) : "Unknown";
      const partiesStr = buildPartiesStr(partyA, partyB);

      return (
        <div
          onClick={() => router.push(`/dashboard/contracts/${id}`)}
          style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
        >
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => { setHovered(false); if (!deleting) setDeleteConfirm(false); }}
          style={{
            ...ROW,
            background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
            opacity: hovered ? 1 : 0.7,
          }}
        >
          <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
          <div style={{ width: "16px", flexShrink: 0 }} />

          {/* Name + parties */}
          <div style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "2px",
            overflow: "hidden",
            padding: "6px 0",
          }}>
            <div style={{
              fontSize: "14px",
              color: "#9CA3AF",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {displayName}
            </div>
            {partiesStr && (
              <div style={{
                fontSize: "12px",
                color: "#6B7280",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {partiesStr}
                {cardState.annualValue != null && (
                  <span style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "11px",
                    color: "#6B7280",
                    marginLeft: "8px",
                  }}>
                    ${cardState.annualValue.toLocaleString()}/yr
                  </span>
                )}
              </div>
            )}
            {!partiesStr && cardState.annualValue != null && (
              <div style={{
                fontSize: "12px",
                color: "#6B7280",
              }}>
                <span style={{
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontSize: "11px",
                  color: "#6B7280",
                }}>
                  ${cardState.annualValue.toLocaleString()}/yr
                </span>
              </div>
            )}
          </div>

          {/* Hover actions */}
          {hoverActions}

          {/* Expired label + date */}
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            justifyContent: "center",
            flexShrink: 0,
            minWidth: "88px",
            textAlign: "right",
          }}>
            <div style={{
              fontSize: "10px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#4B5563",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              EXPIRED
            </div>
            <div style={{
              fontSize: "11px",
              fontFamily: "var(--font-jetbrains), monospace",
              color: "#4B5563",
              marginTop: "2px",
            }}>
              {formattedExpiry}
            </div>
          </div>
        </div>
        </div>
      );
    }

    // ── manual ────────────────────────────────────────────────────────────────

    return (
      <div
        onClick={() => router.push(`/dashboard/review/${id}`)}
        style={{ textDecoration: "none", color: "inherit", display: "block", cursor: "pointer" }}
      >
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          ...ROW,
          background: hovered ? "rgba(255,255,255,0.03)" : "transparent",
        }}
      >
        <div style={{ width: "3px", alignSelf: "stretch", background: STRIPE.gray, flexShrink: 0 }} />
        <div style={{ width: "16px", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0, padding: "6px 0" }}>
          <div style={{
            fontSize: "14px",
            color: "#9CA3AF",
            fontStyle: "italic",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {displayName}
          </div>
          <div style={{ fontSize: "12px", color: "#6B7280", marginTop: "2px" }}>
            {(cardState as { type: "manual"; message: string }).message}
          </div>
        </div>
        <span
          style={{
            fontSize: "13px",
            color: "#10B981",
            textDecoration: "none",
            flexShrink: 0,
            marginLeft: "12px",
          }}
        >
          Enter dates →
        </span>
      </div>
      </div>
    );
  },
  (prev, next) =>
    prev.id === next.id &&
    prev.name === next.name &&
    prev.partyA === next.partyA &&
    prev.partyB === next.partyB &&
    prev.contractValue === next.contractValue &&
    prev.noticePeriodDays === next.noticePeriodDays &&
    prev.renewalDecision === next.renewalDecision &&
    cardStateEqual(prev.cardState, next.cardState) &&
    prev.onDelete === next.onDelete
);

export default ContractCard;
