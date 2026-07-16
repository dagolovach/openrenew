// components/RenewalTimeline.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { extractNumericValue } from "@/lib/spend";
import { DecisionBadge } from "@/components/ui/DecisionBadge";

export interface TimelineContract {
  id: string;
  name: string;
  party_a: string | null;
  party_b: string | null;
  expiry_date: string | null;
  notice_period_days: number | null;
  annual_value: number | null;
  contract_value?: string | null;
  renewal_decision?: string | null;
}

function resolveDisplayValue(contract: TimelineContract): number | null {
  if (contract.annual_value != null && contract.annual_value > 0) return contract.annual_value;
  return extractNumericValue(contract.contract_value ?? null);
}

type Urgency = "red" | "amber" | "green";

const COLOURS: Record<
  Urgency,
  { bar: string; pillBg: string; pillText: string; pillBorder: string }
> = {
  red: {
    bar: "#EF4444",
    pillBg: "#1F0A0A",
    pillText: "#EF4444",
    pillBorder: "#3B1010",
  },
  amber: {
    bar: "#F59E0B",
    pillBg: "#1A1200",
    pillText: "#F59E0B",
    pillBorder: "#3B2800",
  },
  green: {
    bar: "#10B981",
    pillBg: "#051A12",
    pillText: "#10B981",
    pillBorder: "#0A3D26",
  },
};

function sortContracts(contracts: TimelineContract[]): TimelineContract[] {
  return [...contracts].sort((a, b) => {
    if (!a.expiry_date && !b.expiry_date) return 0;
    if (!a.expiry_date) return 1;
    if (!b.expiry_date) return -1;
    return a.expiry_date < b.expiry_date ? -1 : 1;
  });
}

export function formatAnnualValue(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}k`;
  return `$${value}`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function computeRowData(contract: TimelineContract) {
  if (!contract.expiry_date) return null;
  const today = new Date();
  const expiry = new Date(contract.expiry_date);
  const daysUntilExpiry = Math.ceil(
    (expiry.getTime() - today.getTime()) / 86400000
  );
  const daysUntilNotice =
    contract.notice_period_days != null
      ? daysUntilExpiry - contract.notice_period_days
      : null;
  const barWidth = `${Math.min(Math.max(daysUntilExpiry / 365, 0), 1) * 100}%`;
  const noticeTickLeft =
    daysUntilNotice !== null
      ? `${Math.min(Math.max(daysUntilNotice / 365, 0), 1) * 100}%`
      : null;
  const urgency: Urgency =
    daysUntilExpiry <= 30
      ? "red"
      : daysUntilExpiry <= 90 ||
          (daysUntilNotice !== null && daysUntilNotice <= 60)
        ? "amber"
        : "green";
  return { daysUntilExpiry, daysUntilNotice, barWidth, noticeTickLeft, urgency };
}

function LegendItem({ dot, label }: { dot: string; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "#4B5563",
        fontFamily: "var(--font-inter)",
      }}
    >
      <div
        style={{ width: 8, height: 8, borderRadius: "50%", background: dot }}
      />
      {label}
    </div>
  );
}

export function RenewalTimeline({
  contracts,
  expiredContracts = [],
}: {
  contracts: TimelineContract[];
  expiredContracts?: TimelineContract[];
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoveredExpiredIndex, setHoveredExpiredIndex] = useState<number | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const sorted = sortContracts(contracts);

  if (sorted.length === 0 && expiredContracts.length === 0) {
    return (
      <div
        style={{
          padding: "32px",
          textAlign: "center",
          color: "#4B5563",
          fontSize: 13,
          fontFamily: "var(--font-inter)",
        }}
      >
        No active contracts yet — upload a PDF above to get started
      </div>
    );
  }

  return (
    <div>
      {sorted.length > 0 && (
        <>
      {/* Legend */}
      <div style={{ display: "flex", gap: 20, marginBottom: 12 }}>
        <LegendItem dot="#EF4444" label="Expiring within 30 days" />
        <LegendItem dot="#F59E0B" label="Notice deadline within 60 days" />
        <LegendItem dot="#10B981" label="Healthy" />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "#4B5563",
            fontFamily: "var(--font-inter)",
          }}
        >
          <div
            style={{
              width: 2,
              height: 12,
              background: "#F59E0B",
              borderRadius: 1,
            }}
          />
          Notice deadline
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          background: "#111827",
          border: "0.5px solid #1F2937",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {/* Column header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "240px 1fr 110px",
            padding: "10px 20px",
            fontSize: 10,
            color: "#374151",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            borderBottom: "0.5px solid #1F2937",
            fontFamily: "var(--font-inter)",
          }}
        >
          <span>Contract</span>
          <span>Timeline</span>
          <span style={{ textAlign: "right" }}>Status</span>
        </div>

        {/* Rows */}
        {sorted.map((contract, i) => {
          const computed = computeRowData(contract);
          const isLast = i === sorted.length - 1;
          const colours = computed ? COLOURS[computed.urgency] : null;

          const noticeDate =
            contract.notice_period_days != null && contract.expiry_date
              ? (() => {
                  const d = new Date(contract.expiry_date);
                  d.setDate(d.getDate() - contract.notice_period_days!);
                  return formatDate(d.toISOString().split("T")[0]);
                })()
              : null;

          const expiryColour = computed
            ? computed.daysUntilExpiry <= 30
              ? "#EF4444"
              : computed.daysUntilExpiry <= 60
                ? "#F59E0B"
                : "#374151"
            : "#374151";

          const noticeColour =
            computed?.daysUntilNotice != null
              ? computed.daysUntilNotice <= 30
                ? "#EF4444"
                : computed.daysUntilNotice <= 60
                  ? "#F59E0B"
                  : "#374151"
              : "#374151";

          return (
            <Link
              key={contract.id}
              href={`/dashboard/contracts/${contract.id}`}
              style={{ textDecoration: "none", display: "block" }}
            >
              <div
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "240px 1fr 110px",
                  alignItems: "center",
                  padding: "14px 20px",
                  gap: 16,
                  borderBottom: isLast ? "none" : "0.5px solid #1F2937",
                  background:
                    hoveredIndex === i ? "#0F1929" : "transparent",
                  cursor: "pointer",
                  transition: "background 80ms ease",
                }}
              >
                {/* Left — contract info */}
                <div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "#F9FAFB",
                      marginBottom: 2,
                      fontFamily: "var(--font-inter)",
                    }}
                  >
                    {contract.name}
                    <DecisionBadge decision={contract.renewal_decision} style={{ marginLeft: "8px" }} />
                  </div>
                  {(contract.party_a || contract.party_b) && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#4B5563",
                        fontFamily: "var(--font-inter)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {[contract.party_a, contract.party_b]
                        .filter(Boolean)
                        .join(" ↔ ")}
                    </div>
                  )}
                  {resolveDisplayValue(contract) != null && (
                    <div
                      style={{
                        fontSize: 11,
                        color: "#4B5563",
                        fontFamily: "var(--font-inter)",
                      }}
                    >
                      {formatAnnualValue(resolveDisplayValue(contract)!)}
                    </div>
                  )}
                </div>

                {/* Middle — bar track */}
                <div>
                  <div
                    style={{
                      position: "relative",
                      background: "#1F2937",
                      borderRadius: 3,
                      height: 8,
                    }}
                  >
                    {computed && (
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          height: 8,
                          borderRadius: 3,
                          width: computed.barWidth,
                          background: colours!.bar,
                        }}
                      />
                    )}
                    {computed?.noticeTickLeft && (
                      <div
                        style={{
                          position: "absolute",
                          top: -4,
                          width: 2,
                          height: 16,
                          borderRadius: 1,
                          background: "#F59E0B",
                          left: computed.noticeTickLeft,
                        }}
                      />
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginTop: 4,
                      fontSize: 10,
                      fontFamily: "var(--font-inter)",
                    }}
                  >
                    <span style={{ color: expiryColour }}>
                      {contract.expiry_date
                        ? formatDate(contract.expiry_date)
                        : "—"}
                    </span>
                    {noticeDate && (
                      <span style={{ color: noticeColour }}>
                        Notice: {noticeDate}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right — days badge */}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  {computed && colours ? (
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        fontSize: 12,
                        fontWeight: 500,
                        padding: "4px 10px",
                        borderRadius: 20,
                        border: `0.5px solid ${colours.pillBorder}`,
                        background: colours.pillBg,
                        color: colours.pillText,
                        fontFamily: "var(--font-jetbrains)",
                      }}
                    >
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: colours.pillText,
                          flexShrink: 0,
                        }}
                      />
                      {computed.daysUntilExpiry}d
                    </div>
                  ) : (
                    <span
                      style={{
                        color: "#4B5563",
                        fontSize: 13,
                        fontFamily: "var(--font-inter)",
                      }}
                    >
                      —
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      </>
      )}

      {/* Expired contracts toggle + section */}
      {expiredContracts.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button
            onClick={() => setShowExpired((v) => !v)}
            style={{
              fontSize: 12,
              color: "#4B5563",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "var(--font-inter)",
            }}
          >
            {showExpired
              ? "▲ Hide expired"
              : `▼ Show ${expiredContracts.length} expired contract${expiredContracts.length === 1 ? "" : "s"}`}
          </button>

          {showExpired && (
            <div
              style={{
                marginTop: 8,
                background: "#111827",
                border: "0.5px solid #1F2937",
                borderRadius: 12,
                overflow: "hidden",
              }}
            >
              {expiredContracts.map((contract, i) => {
                const isLast = i === expiredContracts.length - 1;
                const noticeDate =
                  contract.notice_period_days != null && contract.expiry_date
                    ? (() => {
                        const d = new Date(contract.expiry_date);
                        d.setDate(d.getDate() - contract.notice_period_days!);
                        return formatDate(d.toISOString().split("T")[0]);
                      })()
                    : null;

                return (
                  <Link
                    key={contract.id}
                    href={`/dashboard/contracts/${contract.id}`}
                    style={{ textDecoration: "none", display: "block" }}
                  >
                    <div
                      onMouseEnter={() => setHoveredExpiredIndex(i)}
                      onMouseLeave={() => setHoveredExpiredIndex(null)}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "240px 1fr 110px",
                        alignItems: "center",
                        padding: "14px 20px",
                        gap: 16,
                        borderBottom: isLast ? "none" : "0.5px solid #1F2937",
                        background:
                          hoveredExpiredIndex === i ? "#0F1929" : "transparent",
                        cursor: "pointer",
                        transition: "background 80ms ease",
                      }}
                    >
                      {/* Left — contract info (muted) */}
                      <div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "#6B7280",
                            marginBottom: 2,
                            fontFamily: "var(--font-inter)",
                          }}
                        >
                          {contract.name}
                        </div>
                        {(contract.party_a || contract.party_b) && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6B7280",
                              fontFamily: "var(--font-inter)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {[contract.party_a, contract.party_b]
                              .filter(Boolean)
                              .join(" ↔ ")}
                          </div>
                        )}
                        {resolveDisplayValue(contract) != null && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#6B7280",
                              fontFamily: "var(--font-inter)",
                            }}
                          >
                            {formatAnnualValue(resolveDisplayValue(contract)!)}
                          </div>
                        )}
                      </div>

                      {/* Middle — grey bar track, no fill, no notice tick */}
                      <div>
                        <div
                          style={{
                            position: "relative",
                            background: "#1F2937",
                            borderRadius: 3,
                            height: 8,
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginTop: 4,
                            fontSize: 10,
                            fontFamily: "var(--font-inter)",
                          }}
                        >
                          <span style={{ color: "#374151" }}>
                            {contract.expiry_date
                              ? formatDate(contract.expiry_date)
                              : "—"}
                          </span>
                          {noticeDate && (
                            <span style={{ color: "#374151" }}>
                              Notice: {noticeDate}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Right — "Expired" badge */}
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            fontSize: 12,
                            fontWeight: 500,
                            padding: "4px 10px",
                            borderRadius: 20,
                            border: "0.5px solid #2A2A2A",
                            background: "#1A1A1A",
                            color: "#6B7280",
                            fontFamily: "var(--font-jetbrains)",
                          }}
                        >
                          Expired
                        </div>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
