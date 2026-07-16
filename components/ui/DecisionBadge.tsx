// components/ui/DecisionBadge.tsx
// Shared renewal-decision badge: Renewing / Canceling / Negotiating.
import type { CSSProperties } from "react";

export const DECISION_BADGE: Record<string, { label: string; color: string }> = {
  renewing: { label: "Renewing", color: "#10B981" },
  canceling: { label: "Canceling", color: "#dc2626" },
  negotiating: { label: "Negotiating", color: "#f59e0b" },
};

export function DecisionBadge({
  decision,
  style,
}: {
  decision?: string | null;
  style?: CSSProperties;
}) {
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
        ...style,
      }}
    >
      {cfg.label}
    </span>
  );
}
