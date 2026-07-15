// components/contracts/ProgressBar.tsx
"use client";

import { useEffect, useState } from "react";

export default function ProgressBar({
  effectiveDate,
  expiryDate,
  expired = false,
}: {
  effectiveDate: string | null;
  expiryDate: string | null;
  expired?: boolean;
}) {
  const [todayMs, setTodayMs] = useState<number | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setTodayMs(Date.now()); }, []);

  if (!effectiveDate || !expiryDate) return null;

  const effective = new Date(effectiveDate).getTime();
  const expiry = new Date(expiryDate).getTime();

  if (expiry <= effective) return null;

  const total = expiry - effective;
  // Use a stable value (effective date) until mounted to avoid SSR/client mismatch
  const today = todayMs ?? effective;
  const elapsed = today - effective;
  const rawPct = expired ? 100 : Math.min(Math.max((elapsed / total) * 100, 0), 100);
  // Round to 4 decimal places to avoid floating-point precision mismatches
  const pct = Math.round(rawPct * 10000) / 10000;

  const markerColor = pct > 75 ? "#EF4444" : pct > 50 ? "#F59E0B" : "#10B981";

  const fmtShort = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div>
      {/* Bar */}
      <div
        style={{
          position: "relative",
          height: "6px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: "3px",
          marginBottom: "12px",
        }}
      >
        {/* Filled gradient or grey expired fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            height: "100%",
            width: `${pct}%`,
            background: expired
              ? "rgba(255,255,255,0.15)"
              : "linear-gradient(to right, #10B981, #F59E0B, #EF4444)",
            borderRadius: "3px",
          }}
        />
        {/* Today marker dot — hidden when expired */}
        {!expired && (
          <div
            style={{
              position: "absolute",
              left: `${pct}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: markerColor,
              border: "2px solid #0D1117",
              boxShadow: `0 0 8px ${markerColor}80`,
              zIndex: 1,
            }}
          />
        )}
      </div>

      {/* Labels */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "10px",
          color: "#4B5563",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        <span>Start · {fmtShort(effectiveDate)}</span>
        <span>Expiry · {fmtShort(expiryDate)}</span>
      </div>
    </div>
  );
}
