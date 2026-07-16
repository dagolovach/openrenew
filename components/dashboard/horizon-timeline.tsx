// components/dashboard/horizon-timeline.tsx
import Link from "next/link";
import type { TriageItem } from "@/lib/triage";

type Props = {
  entries: TriageItem[];
};

function dotColor(daysLeft: number): string {
  if (daysLeft <= 7) return "#dc2626";
  if (daysLeft <= 30) return "#f59e0b";
  return "#10B981";
}

function nextTwelveMonthLabels(): string[] {
  const labels: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    labels.push(d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }));
  }
  return labels;
}

export default function HorizonTimeline({ entries }: Props) {
  if (entries.length === 0) return null;

  const months = nextTwelveMonthLabels();

  return (
    <div style={{ marginBottom: 32 }}>
      <div
        style={{
          fontFamily: "var(--font-jetbrains)",
          fontSize: 12,
          letterSpacing: "0.08em",
          color: "#9CA3AF",
          marginBottom: 12,
        }}
      >
        NEXT 12 MONTHS
      </div>

      <div style={{ background: "#111827", borderRadius: 8, padding: 16 }}>
        {/* Month axis */}
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {months.map((m, i) => (
            <span
              key={i}
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 10,
                color: "#6B7280",
              }}
            >
              {m}
            </span>
          ))}
        </div>
        <div style={{ borderBottom: "1px solid #1F2937", marginTop: 6, marginBottom: 4 }} />

        {/* Entry rows */}
        {entries.map((item) => (
          <div key={item.contract_id} style={{ height: 26, position: "relative", display: "flex", alignItems: "center" }}>
            <Link
              href={`/dashboard/contracts/${item.contract_id}`}
              style={{
                fontFamily: "var(--font-jetbrains)",
                fontSize: 11,
                color: "#9CA3AF",
                textDecoration: "none",
                width: 180,
                flexShrink: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.name}
            </Link>
            <div style={{ position: "relative", flex: 1, height: "100%" }}>
              <Link
                href={`/dashboard/contracts/${item.contract_id}`}
                style={{
                  position: "absolute",
                  left: `${Math.min(item.days_left / 365, 1) * 100}%`,
                  top: "50%",
                  transform: "translate(-50%, -50%)",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: dotColor(item.days_left),
                  display: "block",
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
