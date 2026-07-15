// components/dashboard/DashboardMetrics.tsx
"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";

interface Metrics {
  contractsManaged: number;
  alertsSent: number;
  totalSpend: number;
  trackedCount: number;
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function ContractIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="4" y="3" width="12" height="14" rx="2" stroke="#6B7280" strokeWidth="1.5" />
      <path d="M7 7h6M7 10h6M7 13h4" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 2a6 6 0 016 6c0 3.5 1 5 1 5H3s1-1.5 1-5a6 6 0 016-6z" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 15a2 2 0 004 0" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SpendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="16" height="11" rx="2" stroke="#6B7280" strokeWidth="1.5" />
      <path d="M2 9h16" stroke="#6B7280" strokeWidth="1.5" />
      <path d="M5 4h10" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="13" r="1" fill="#6B7280" />
    </svg>
  );
}

interface MetricCardProps {
  icon: ReactNode;
  value: string;
  label: string;
  secondary?: string;
}

function MetricCard({ icon, value, label, secondary }: MetricCardProps) {
  return (
    <div style={{
      background: "#111827",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "8px",
      padding: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
        {icon}
        <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <span style={{
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "28px",
        fontWeight: 700,
        color: "#F9FAFB",
        lineHeight: 1,
      }}>{value}</span>
      {secondary && (
        <span style={{
          fontFamily: "var(--font-inter), sans-serif",
          fontSize: "11px",
          color: "#4B5563",
        }}>{secondary}</span>
      )}
    </div>
  );
}

interface Props {
  userId: string;
  refreshKey?: number;
}

export default function DashboardMetrics({ userId, refreshKey }: Props) {
  const [metrics, setMetrics] = useState<Metrics | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const supabase = createClient();
      const todayStr = new Date().toISOString().split("T")[0];

      const [contractsRes, alertsRes] = await Promise.all([
        supabase
          .from("contracts")
          .select("annual_value, status")
          .eq("user_id", userId)
          .eq("status", "active")
          .or(`expiry_date.is.null,expiry_date.gte.${todayStr}`),
        supabase
          .from("alerts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .not("sent_at", "is", null),
      ]);

      if (!active) return;

      const rows = (contractsRes.data ?? []) as unknown as { annual_value: number | null }[];
      const contractsManaged = rows.length;
      const parsedValues = rows
        .map((c) => (c.annual_value != null && c.annual_value > 0 ? c.annual_value : null))
        .filter((v): v is number => v !== null);
      const totalSpend = parsedValues.reduce((a, b) => a + b, 0);
      const trackedCount = parsedValues.length;

      setMetrics({
        contractsManaged,
        alertsSent: alertsRes.count ?? 0,
        totalSpend,
        trackedCount,
      });
    }

    load();

    return () => {
      active = false;
    };
  }, [userId, refreshKey]);

  if (!metrics) {
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "12px",
        marginBottom: "24px",
      }}>
        {[...Array(3)].map((_, i) => (
          <div key={i} style={{ background: "#111827", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", height: "88px", opacity: 0.4 }} />
        ))}
      </div>
    );
  }

  const { contractsManaged, alertsSent, totalSpend, trackedCount } = metrics;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: "12px",
        marginBottom: "24px",
      }}
      className="dashboard-metrics-grid"
    >
      <style>{`@media (max-width: 768px) { .dashboard-metrics-grid { grid-template-columns: 1fr !important; } }`}</style>
      <MetricCard icon={<ContractIcon />} value={String(contractsManaged)} label="Contracts Managed" />
      <MetricCard icon={<AlertIcon />} value={String(alertsSent)} label="Alerts Sent" />
      {/* Tracked Spend card — custom render for styled value */}
      <div style={{
        background: "#111827",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "8px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
          <SpendIcon />
          <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Tracked Spend</span>
        </div>
        {trackedCount === 0 ? (
          <>
            <span style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "28px",
              fontWeight: 700,
              color: "#F9FAFB",
              lineHeight: 1,
            }}>—</span>
            <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "#4B5563" }}>No values extracted yet</span>
          </>
        ) : (
          <>
            <div style={{ lineHeight: 1 }}>
              <span style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "28px",
                fontWeight: 700,
                color: "#F9FAFB",
              }}>~{formatCurrency(totalSpend)}</span>
              <span style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "14px",
                color: "#6B7280",
                marginLeft: "4px",
              }}>/yr</span>
            </div>
            <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "#4B5563" }}>{trackedCount} of {contractsManaged} contracts</span>
          </>
        )}
      </div>
    </div>
  );
}
