// components/dashboard/contract-list.tsx
"use client";

import { useEffect, useRef, useState, useMemo, startTransition } from "react";
import { useRouter } from "next/navigation";
import ContractCard, { CardState } from "./contract-card";
import { isExpired, daysUntil, activeExpiryDate } from "@/lib/utils";
import { formatAnnualValue } from "@/components/RenewalTimeline";

export type SpendStat = { totalSpend: number; trackedCount: number };


type ContractRow = {
  id: string;
  name: string;
  file_name: string | null;
  status: string;
  extraction_status: string;
  extraction_confidence: number | null;
  expiry_date: string | null;
  renewal_date: string | null;
  party_a: string | null;
  party_b: string | null;
  contract_value: string | null;
  notice_period_days: number | null;
  category: string | null;
  annual_value: number | null;
  updated_at: string;
  created_at: string;
  unresolved_count: number;
  parent_contract_id: string | null;
  renewal_decision?: string | null;
};

const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 90_000;
const UPCOMING_PREVIEW_COUNT = 5;

function computeCardState(c: ContractRow, timedOut: boolean): CardState {
  // 1. Active wins
  if (c.status === "active") {
    // Check expired first — before computing days to avoid negative urgency display
    if (isExpired(c)) {
      return { type: "expired", expiryDate: c.expiry_date!, partyA: c.party_a, partyB: c.party_b, annualValue: c.annual_value };
    }
    const dateForDays = activeExpiryDate(c);
    if (!dateForDays) return { type: "active", urgency: "green", expiryDate: null, daysLeft: null, partyA: c.party_a, partyB: c.party_b, annualValue: c.annual_value };
    const days = daysUntil(dateForDays);
    const urgency = days <= 30 ? "red" : days <= 60 ? "amber" : "green";
    return { type: "active", urgency, expiryDate: c.expiry_date, daysLeft: days, partyA: c.party_a, partyB: c.party_b, annualValue: c.annual_value };
  }
  // 1b. Renewed (replaced by successor)
  if (c.status === "renewed") {
    return { type: "expired", expiryDate: c.expiry_date ?? c.created_at.split("T")[0], partyA: c.party_a, partyB: c.party_b, annualValue: c.annual_value };
  }
  // 2. Manual (set by extract route) — only while still in draft
  if (c.status === "draft" && c.extraction_status === "manual") {
    return { type: "manual", message: "Scanned PDF · Manual entry needed" };
  }
  // 3. Processing (with 90s client-side timeout)
  if (c.status === "processing") {
    if (timedOut) return { type: "manual", message: "Extraction timed out. Enter dates manually." };
    return { type: "processing" };
  }
  // 3b. Analyzing (party names confirmed, AI analysis running in background)
  if (c.status === "analyzing") {
    if (timedOut) return { type: "manual", message: "Analysis timed out. Check your contract details." };
    return { type: "analyzing" };
  }
  // 3c. Party review (awaiting party name confirmation)
  if (c.status === "party_review") {
    return { type: "party_review" };
  }
  // 4. Ready to review
  if (c.status === "draft" && c.extraction_status === "review") {
    return { type: "draft", unresolvedCount: c.unresolved_count };
  }
  return { type: "processing" };
}

function getSortPriority(c: ContractRow): number {
  if (c.status === "active") {
    if (isExpired(c)) return 7;          // expired — bottom
    if (!c.expiry_date) return 3;        // no expiry date
    const date = activeExpiryDate(c);
    const days = date ? daysUntil(date) : Infinity;
    if (days <= 30) return 0;            // red — top
    if (days <= 60) return 1;            // amber
    return 2;                            // green
  }
  if (c.status === "renewed") return 7;  // treat same as expired
  if (c.status === "draft" && c.extraction_status === "review") return 4;
  if (c.status === "processing") return 5;
  if (c.status === "analyzing") return 5;
  if (c.status === "party_review") return 5;
  if (c.extraction_status === "manual") return 6;
  return 8; // fallback
}

function sortContracts(contracts: ContractRow[]): ContractRow[] {
  return [...contracts].sort((a, b) => {
    const gd = getSortPriority(a) - getSortPriority(b);
    if (gd !== 0) return gd;

    // Within expired group: most recently expired first (desc)
    if (isExpired(a) && isExpired(b)) {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date > b.expiry_date ? -1 : 1;
    }

    // Within active group: soonest expiry first (asc)
    if (a.status === "active") {
      if (!a.expiry_date && !b.expiry_date) return 0;
      if (!a.expiry_date) return 1;
      if (!b.expiry_date) return -1;
      return a.expiry_date < b.expiry_date ? -1 : 1;
    }
    if (a.status === "draft") return a.updated_at > b.updated_at ? -1 : 1;
    return a.created_at > b.created_at ? -1 : 1;
  });
}

type ExtractionRow = { field_name: string; confidence: number | null; confirmed_value: string | null; was_edited: boolean };

function countUnresolved(extractions: ExtractionRow[]): number {
  return (extractions ?? []).filter(
    (e) => e.field_name !== "confidence" && (e.confidence ?? 1) < 0.9 && e.confirmed_value === null && !e.was_edited
  ).length;
}


// ── SectionHeader ─────────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <div style={{
      padding: "12px 16px 4px",
      fontSize: "10px",
      fontWeight: 700,
      letterSpacing: "0.1em",
      textTransform: "uppercase" as const,
      color: "#4B5563",
    }}>
      {label}
    </div>
  );
}

// ── Sections ──────────────────────────────────────────────────────────────────

type Section = {
  key: string;
  label: string;
  filter: (c: ContractRow) => boolean;
};

const SECTIONS: Section[] = [
  {
    key: "action",
    label: "Action needed",
    filter: (c) => {
      if (c.status !== "active" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      return d ? daysUntil(d) <= 30 : false;
    },
  },
  {
    key: "month",
    label: "This month",
    filter: (c) => {
      if (c.status !== "active" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      if (!d) return false;
      const days = daysUntil(d);
      return days > 30 && days <= 60;
    },
  },
  {
    key: "upcoming",
    label: "Upcoming",
    filter: (c) => {
      if (c.status !== "active" || isExpired(c)) return false;
      const d = activeExpiryDate(c);
      if (!d) return false;
      return daysUntil(d) > 60;
    },
  },
  {
    key: "active-nodate",
    label: "Tracked — no expiry",
    filter: (c) =>
      c.status === "active" && !isExpired(c) && !c.expiry_date && !c.renewal_date,
  },
  {
    key: "draft",
    label: "Needs review",
    filter: (c) =>
      (c.status === "draft" && c.extraction_status === "review") ||
      (c.status === "draft" && c.extraction_status === "manual") ||
      c.status === "processing" ||
      c.status === "analyzing" ||
      c.status === "party_review",
  },
  {
    key: "expired",
    label: "Expired",
    filter: (c) => c.status === "active" && isExpired(c),
  },
  {
    key: "renewed",
    label: "Renewed",
    filter: (c) => c.status === "renewed",
  },
];

// ── ContractList ──────────────────────────────────────────────────────────────

export default function ContractList({
  initialContracts,
  spend,
}: {
  initialContracts: ContractRow[];
  spend?: SpendStat;
}) {
  const router = useRouter();
  const [contracts, setContracts] = useState(initialContracts);
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  const contractsRef = useRef(initialContracts); // stable ref so interval doesn't recreate on every state update
  const startTimes = useRef<Map<string, number>>(new Map());
  const timedOut = useRef<Set<string>>(new Set());
  const deleteHandlers = useRef(new Map<string, () => void>());

  // Keep contractsRef in sync with state (without adding contracts to any effect deps)
  contractsRef.current = contracts;

  // Merge contracts from server (router.refresh() re-runs server component with new props,
  // but useState ignores prop changes after mount — so we merge manually).
  // Also updates existing contracts when their status/extraction_status changed server-side
  // so that transitioning from party_review → processing is reflected immediately.
  useEffect(() => {
    setContracts((prev) => {
      const newIds = new Set(initialContracts.map((c) => c.id));
      const prevMap = new Map(prev.map((c) => [c.id, c]));
      let changed = false;
      // Remove contracts no longer in initialContracts (e.g. transitioned to active)
      for (const c of prev) {
        if (!newIds.has(c.id)) { changed = true; prevMap.delete(c.id); }
      }
      // Add new or update changed contracts
      for (const c of initialContracts) {
        const existing = prevMap.get(c.id);
        if (!existing) {
          prevMap.set(c.id, c);
          changed = true;
        } else if (
          existing.status !== c.status ||
          existing.extraction_status !== c.extraction_status
        ) {
          prevMap.set(c.id, { ...existing, ...c });
          changed = true;
        }
      }
      return changed ? Array.from(prevMap.values()) : prev;
    });
  }, [initialContracts]);

  useEffect(() => {
    // Initialise start times for any processing contracts present at mount
    contractsRef.current
      .filter((c) => c.status === "processing" || c.status === "analyzing")
      .forEach((c) => { if (!startTimes.current.has(c.id)) startTimes.current.set(c.id, Date.now()); });

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      if (cancelled) return;

      const current = contractsRef.current;
      const now = Date.now();

      // Track start times + timeouts for processing contracts
      current.filter((c) => c.status === "processing" || c.status === "analyzing").forEach((c) => {
        if (!startTimes.current.has(c.id)) startTimes.current.set(c.id, Date.now());
        if ((now - (startTimes.current.get(c.id) ?? now)) >= TIMEOUT_MS) timedOut.current.add(c.id);
      });

      const pollIds = current
        .filter((c) => (c.status === "processing" || c.status === "analyzing") && !timedOut.current.has(c.id))
        .map((c) => c.id);

      if (pollIds.length > 0) {
        const res = await fetch(`/api/contracts?ids=${pollIds.join(",")}`);
        const data = res.ok ? await res.json() : null;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pollData = data as unknown as any[];
        if (pollData && !cancelled) {
          // Check before updating state: did any contract leave processing/analyzing?
          // If so, router.refresh() will re-render the server components (timeline, expired section).
          const inProgress = new Set(["processing", "analyzing"]);
          const needsRefresh = pollData.some((updated: { id: string; status: string }) => {
            const existing = contractsRef.current.find((c) => c.id === updated.id);
            return existing && inProgress.has(existing.status) && !inProgress.has(updated.status);
          });

          startTransition(() => {
            setContracts((prev) => {
              const map = new Map(prev.map((c) => [c.id, c]));
              let changed = false;
              pollData.forEach((updated: { id: string; contract_extractions: ExtractionRow[]; [key: string]: unknown }) => {
                const { contract_extractions, ...rest } = updated;
                const existing = map.get(updated.id);
                const newUnresolved = countUnresolved(contract_extractions);
                if (
                  existing &&
                  existing.status === rest.status &&
                  existing.extraction_status === rest.extraction_status &&
                  existing.unresolved_count === newUnresolved
                ) return; // nothing changed for this contract
                changed = true;
                map.set(updated.id, { ...existing!, ...rest, unresolved_count: newUnresolved });
              });
              return changed ? Array.from(map.values()) : prev;
            });
          });

          if (needsRefresh) router.refresh();
        }
      }

      // Always reschedule — loop runs continuously but only fetches
      // when there are processing contracts. This ensures contracts that
      // transition to "processing" after mount (e.g. via router.refresh()) are
      // picked up without needing to restart the effect.
      if (!cancelled) {
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    // Start unconditionally so the loop catches contracts that become
    // processing after the initial mount.
    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // empty deps — reads state via contractsRef; router is stable

  const sorted = useMemo(() => sortContracts(contracts), [contracts]);

  function getDeleteHandler(id: string): () => void {
    if (!deleteHandlersSnapshot.has(id)) {
      deleteHandlersSnapshot.set(id, () => {
        setContracts((prev) => {
          const deleted = prev.find((x) => x.id === id);
          const filtered = prev.filter((x) => x.id !== id);
          if (deleted?.parent_contract_id) {
            return filtered.map((x) =>
              x.id === deleted.parent_contract_id ? { ...x, status: "active" } : x
            );
          }
          return filtered;
        });
        router.refresh();
      });
    }
    return deleteHandlersSnapshot.get(id)!;
  }

  // Snapshot ref values before render — avoids react-hooks/refs lint errors
  const timedOutSnapshot = timedOut.current;
  const deleteHandlersSnapshot = deleteHandlers.current;

  const spendHeader = spend && spend.trackedCount > 0 ? (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
      <span style={{
        fontSize: "12px",
        color: "#6B7280",
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {`~${formatAnnualValue(spend.totalSpend)}/yr tracked across ${spend.trackedCount} contract${spend.trackedCount === 1 ? "" : "s"}`}
      </span>
    </div>
  ) : null;

  if (sorted.length === 0) {
    // Active contracts render in the table below this component; when there is
    // tracked spend but nothing needing review, show only the spend header.
    if (spend && spend.trackedCount > 0) return spendHeader;
    return (
      <>
        {spendHeader}
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 24px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: "15px", color: "#9CA3AF", marginBottom: "8px" }}>
            No contracts tracked yet.
          </div>
          <div style={{ fontSize: "13px", color: "#6B7280", maxWidth: "280px", lineHeight: 1.6 }}>
            Upload your first contract below and OpenRenew will extract the key dates automatically.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    {spendHeader}
    <div style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: "8px", overflow: "hidden" }}>
      {SECTIONS.map((section) => {
        const sectionContracts = sorted.filter(section.filter);
        if (sectionContracts.length === 0) return null;

        if (section.key === "upcoming") {
          const visible = upcomingExpanded
            ? sectionContracts
            : sectionContracts.slice(0, UPCOMING_PREVIEW_COUNT);
          const hiddenCount = sectionContracts.length - UPCOMING_PREVIEW_COUNT;
          return (
            <div key={section.key}>
              <SectionHeader label={section.label} />
              {visible.map((c) => (
                <ContractCard
                  key={c.id}
                  id={c.id}
                  name={c.name || c.file_name || ""}
                  partyA={c.party_a ?? null}
                  partyB={c.party_b ?? null}
                  contractValue={c.contract_value ?? null}
                  noticePeriodDays={c.notice_period_days ?? null}
                  renewalDecision={c.renewal_decision ?? null}
                  cardState={computeCardState(c, timedOutSnapshot.has(c.id))}
                  onDelete={getDeleteHandler(c.id)}
                />
              ))}
              {sectionContracts.length > UPCOMING_PREVIEW_COUNT && (
                <button
                  onClick={() => setUpcomingExpanded((prev) => !prev)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    width: "100%",
                    padding: "10px 16px",
                    background: "transparent",
                    border: "none",
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    cursor: "pointer",
                    color: "#4B5563",
                    fontSize: "12px",
                    fontFamily: "var(--font-inter), system-ui",
                    textAlign: "left",
                    transition: "color 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#9CA3AF";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#4B5563";
                  }}
                >
                  <span style={{
                    fontFamily: "var(--font-jetbrains), monospace",
                    fontSize: "10px",
                    transition: "transform 120ms ease",
                    display: "inline-block",
                    transform: upcomingExpanded ? "rotate(90deg)" : "rotate(0deg)",
                  }}>
                    ▶
                  </span>
                  {upcomingExpanded ? "Show less" : `Show ${hiddenCount} more`}
                </button>
              )}
            </div>
          );
        }

        return (
          <div key={section.key}>
            <SectionHeader label={section.label} />
            {sectionContracts.map((c) => (
              <ContractCard
                key={c.id}
                id={c.id}
                name={c.name || c.file_name || ""}
                partyA={c.party_a ?? null}
                partyB={c.party_b ?? null}
                contractValue={c.contract_value ?? null}
                noticePeriodDays={c.notice_period_days ?? null}
                renewalDecision={c.renewal_decision ?? null}
                cardState={computeCardState(c, timedOutSnapshot.has(c.id))}
                onDelete={getDeleteHandler(c.id)}
              />
            ))}
          </div>
        );
      })}
    </div>
    </>
  );
}
