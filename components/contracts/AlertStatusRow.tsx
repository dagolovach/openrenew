// components/contracts/AlertStatusRow.tsx
"use client";

export type AlertRow = {
  alert_type: string;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  target_date?: string | null; // added in Week 2 migration; may not exist
};

function labelFor(alertType: string): string {
  if (alertType === "notice_deadline") return "NOTICE";
  const n = Number(alertType);
  if (!isNaN(n)) return `${n}D`;
  return alertType.toUpperCase();
}

export default function AlertStatusRow({
  autoRenew,
  alerts,
}: {
  autoRenew: boolean | null;
  alerts: AlertRow[];
}) {
  const mono: React.CSSProperties = {
    fontFamily: "var(--font-jetbrains), monospace",
    fontSize: "11px",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
  };

  // Deduplicate by alert_type — prefer 'sent' over 'pending'
  const byType = new Map<string, string>();
  for (const a of alerts) {
    const existing = byType.get(a.alert_type);
    if (!existing || (existing !== "sent" && a.status === "sent")) {
      byType.set(a.alert_type, a.status);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
      }}
    >
      {/* Auto-renew indicator */}
      {autoRenew ? (
        <span style={{ ...mono, color: "#F59E0B" }}>
          △ AUTO-RENEW CLAUSE DETECTED
        </span>
      ) : (
        <span style={{ ...mono, color: "#4B5563" }}>✓ NO AUTO-RENEW</span>
      )}

      {/* Alert type indicators */}
      {byType.size > 0 && (
        <>
          <span style={{ ...mono, color: "rgba(255,255,255,0.15)" }}>·</span>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {Array.from(byType.entries()).map(([type, status]) => {
              const isSent = status === "sent";
              const isPending = status === "pending";
              return (
                <span
                  key={type}
                  style={{
                    ...mono,
                    color: isSent ? "#10B981" : isPending ? "#F59E0B" : "#4B5563",
                  }}
                >
                  {labelFor(type)} {isSent ? "✓" : isPending ? "●" : "○"}
                </span>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
