// components/dashboard/triage-queue.tsx
"use client";

import { useState, type CSSProperties, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TriageItem } from "@/lib/triage";

type Props = {
  items: TriageItem[];
  next: TriageItem | null;
  aiFindingsByContract: Record<string, boolean>;
  aiEnabled: boolean;
};

const URGENCY_COLOR: Record<TriageItem["urgency"], string> = {
  overdue: "#dc2626",
  critical: "#f59e0b",
  warning: "#eab308",
};

const KIND_LABEL: Record<TriageItem["decision_kind"], string> = {
  notice_deadline: "Notice window closes",
  expiry: "Expires",
  renewal: "Renews",
};

const KIND_LABEL_LOWER: Record<TriageItem["decision_kind"], string> = {
  notice_deadline: "notice window closes",
  expiry: "expires",
  renewal: "renews",
};

function formatDate(d: string): string {
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatValueChip(value: number): string {
  return `~$${Math.round(value / 1000)}k/yr`;
}

function buildPartiesStr(partyA: string | null, partyB: string | null): string | null {
  if (partyA && partyB) return `${partyA} ↔ ${partyB}`;
  if (partyA) return partyA;
  if (partyB) return partyB;
  return null;
}

type Decision = "renewing" | "canceling" | "negotiating";

function TriageRow({
  item,
  showDraftLink,
}: {
  item: TriageItem;
  showDraftLink: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  const urgencyColor = URGENCY_COLOR[item.urgency];
  const partiesStr = buildPartiesStr(item.party_a, item.party_b);
  const daysAbs = Math.abs(item.days_left);
  const deadlineSentence = `${KIND_LABEL[item.decision_kind]} ${formatDate(item.decision_date)} — ${daysAbs} days ${item.days_left < 0 ? "overdue" : "left"}`;

  async function act(body: { decision: Decision | null } | { snooze_days: number }) {
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/contracts/${item.contract_id}/decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError(true);
        setPending(false);
      }
    } catch {
      setError(true);
      setPending(false);
    }
  }

  const buttonBase: CSSProperties = {
    background: "transparent",
    border: "1px solid #374151",
    color: "#D1D5DB",
    borderRadius: 6,
    padding: "5px 10px",
    fontSize: 12,
    fontFamily: "var(--font-inter)",
    cursor: pending ? "not-allowed" : "pointer",
    opacity: pending ? 0.5 : 1,
  };

  function onEnter(e: MouseEvent<HTMLButtonElement>) {
    if (pending) return;
    (e.currentTarget as HTMLButtonElement).style.borderColor = "#10B981";
  }
  function onLeave(e: MouseEvent<HTMLButtonElement>) {
    (e.currentTarget as HTMLButtonElement).style.borderColor = "#374151";
  }

  return (
    <div
      style={{
        background: "#111827",
        borderRadius: 8,
        border: "1px solid #1F2937",
        borderLeft: `3px solid ${urgencyColor}`,
        padding: "14px 16px",
        marginBottom: 10,
      }}
    >
      {/* Row 1 — name + value chip */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Link
          href={`/dashboard/contracts/${item.contract_id}`}
          style={{ fontSize: 15, fontWeight: 600, color: "#F9FAFB", textDecoration: "none" }}
        >
          {item.name}
        </Link>
        {item.annual_value != null && (
          <span
            style={{
              fontFamily: "var(--font-jetbrains)",
              fontSize: 11,
              color: "#9CA3AF",
            }}
          >
            {formatValueChip(item.annual_value)}
          </span>
        )}
      </div>

      {/* Row 2 — parties */}
      {partiesStr && (
        <div style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>{partiesStr}</div>
      )}

      {/* Row 3 — deadline sentence */}
      <div style={{ fontSize: 13, color: urgencyColor, marginTop: 6 }}>{deadlineSentence}</div>

      {/* Row 4 — actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button
          style={buttonBase}
          disabled={pending}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onClick={() => act({ decision: "renewing" })}
        >
          Renewing
        </button>
        <button
          style={buttonBase}
          disabled={pending}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onClick={() => act({ decision: "canceling" })}
        >
          Canceling
        </button>
        <button
          style={buttonBase}
          disabled={pending}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onClick={() => act({ decision: "negotiating" })}
        >
          Negotiating
        </button>
        <button
          style={buttonBase}
          disabled={pending}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onClick={() => act({ snooze_days: 7 })}
        >
          Snooze 7d
        </button>
        {showDraftLink && (
          <Link
            href={`/dashboard/contracts/${item.contract_id}#draft-email`}
            style={{ color: "#10B981", fontSize: 12, textDecoration: "none" }}
          >
            Draft email →
          </Link>
        )}
        {error && (
          <span style={{ fontSize: 12, color: "#dc2626" }}>Action failed — try again</span>
        )}
      </div>
    </div>
  );
}

export default function TriageQueue({ items, next, aiFindingsByContract, aiEnabled }: Props) {
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
        NEEDS ACTION
      </div>

      {items.length === 0 ? (
        <div style={{ background: "#111827", borderRadius: 8, border: "1px solid #1F2937", padding: "14px 16px" }}>
          <div style={{ fontSize: 15, color: "#9CA3AF" }}>Nothing needs action.</div>
          {next && (
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>
              Next up: {next.name} — {KIND_LABEL_LOWER[next.decision_kind]}, {formatDate(next.decision_date)} ({next.days_left} days)
            </div>
          )}
        </div>
      ) : (
        items.map((item) => (
          <TriageRow
            key={item.contract_id}
            item={item}
            showDraftLink={aiEnabled && !!aiFindingsByContract[item.contract_id]}
          />
        ))
      )}
    </div>
  );
}
