// lib/triage.ts
// Pure triage-queue derivation — the home screen's "what needs action now?" logic.
export type TriageContract = {
  id: string; name: string;
  party_a: string | null; party_b: string | null;
  status: string; annual_value: number | null;
  expiry_date: string | null; renewal_date: string | null;
  notice_period_days: number | null;
  snoozed_until: string | null; renewal_decision: string | null;
};

export type TriageItem = {
  contract_id: string; name: string;
  party_a: string | null; party_b: string | null;
  annual_value: number | null;
  decision_date: string;
  decision_kind: "notice_deadline" | "expiry" | "renewal";
  days_left: number;
  urgency: "overdue" | "critical" | "warning";
};

const QUEUE_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function utcMidnight(d: Date): number {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c.getTime();
}

function dateMs(dateStr: string): number | null {
  const t = new Date(dateStr + "T00:00:00Z").getTime();
  return Number.isNaN(t) ? null : t;
}

function decisionPoint(c: TriageContract):
  { date: string; kind: TriageItem["decision_kind"] } | null {
  if (c.expiry_date && c.notice_period_days != null && c.notice_period_days > 0) {
    const ms = dateMs(c.expiry_date);
    if (ms != null) {
      const d = new Date(ms - c.notice_period_days * MS_PER_DAY);
      return { date: d.toISOString().slice(0, 10), kind: "notice_deadline" };
    }
  }
  if (c.renewal_date && c.renewal_date !== c.expiry_date && dateMs(c.renewal_date) != null) {
    return { date: c.renewal_date, kind: "renewal" };
  }
  if (c.expiry_date && dateMs(c.expiry_date) != null) {
    return { date: c.expiry_date, kind: "expiry" };
  }
  return null;
}

type SortableItem = TriageItem & { _sortMs: number };

function toItem(c: TriageContract, today: Date): SortableItem | null {
  const point = decisionPoint(c);
  if (!point) return null;
  const pointMs = dateMs(point.date)!;
  const daysLeft = Math.round((pointMs - utcMidnight(today)) / MS_PER_DAY);
  return {
    contract_id: c.id, name: c.name,
    party_a: c.party_a, party_b: c.party_b,
    annual_value: c.annual_value,
    decision_date: point.date, decision_kind: point.kind,
    days_left: daysLeft,
    urgency: daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "critical" : "warning",
    _sortMs: pointMs,
  };
}

function eligible(c: TriageContract, today: Date): boolean {
  if (c.status !== "active") return false;
  if (c.renewal_decision) return false;
  if (c.snoozed_until) {
    const ms = dateMs(c.snoozed_until);
    if (ms != null && ms >= utcMidnight(today)) return false;
  }
  return true;
}

function strip(item: SortableItem): TriageItem {
  const { _sortMs, ...rest } = item;
  void _sortMs;
  return rest;
}

export function buildTriageQueue(contracts: TriageContract[], today: Date = new Date()): TriageItem[] {
  return contracts
    .filter((c) => eligible(c, today))
    .map((c) => toItem(c, today))
    .filter((i): i is SortableItem => i != null && i.days_left <= QUEUE_WINDOW_DAYS)
    .sort((a, b) => a._sortMs - b._sortMs)
    .map(strip);
}

/** Nearest decision point beyond the queue window (for the empty-state "next up" line). */
export function nextUp(contracts: TriageContract[], today: Date = new Date()): TriageItem | null {
  const future = contracts
    .filter((c) => eligible(c, today))
    .map((c) => toItem(c, today))
    .filter((i): i is SortableItem => i != null && i.days_left > QUEUE_WINDOW_DAYS)
    .sort((a, b) => a._sortMs - b._sortMs);
  return future.length ? strip(future[0]) : null;
}

/** All eligible decision points within the horizon (default 365 days), sorted ascending. */
export function horizonEntries(contracts: TriageContract[], today: Date = new Date(), horizonDays = 365): TriageItem[] {
  return contracts
    .filter((c) => eligible(c, today))
    .map((c) => toItem(c, today))
    .filter((i): i is SortableItem => i != null && i.days_left >= 0 && i.days_left <= horizonDays)
    .sort((a, b) => a._sortMs - b._sortMs)
    .map(strip);
}
