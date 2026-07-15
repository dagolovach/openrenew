// lib/alerts.ts
export type AlertRow = {
  contract_id: string;
  user_id: string;
  alert_type: "day_60" | "day_30" | "day_7" | "notice_deadline";
  scheduled_for: string;
  target_date: string;
  status: "pending";
};

type ContractDateData = {
  id: string;
  user_id: string;
  expiry_date: string | null;
  renewal_date: string | null;
  effective_date: string | null;
  notice_period_days: number | null;
};

function addDays(dateStr: string, days: number): Date {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function tierAlerts(
  contractId: string,
  userId: string,
  targetDateStr: string,
  today: Date
): AlertRow[] {
  const tiers: Array<{ type: AlertRow["alert_type"]; offset: number }> = [
    { type: "day_60", offset: -60 },
    { type: "day_30", offset: -30 },
    { type: "day_7", offset: -7 },
  ];
  return tiers
    .map(({ type, offset }) => ({
      contract_id: contractId,
      user_id: userId,
      alert_type: type,
      scheduled_for: toISODate(addDays(targetDateStr, offset)),
      target_date: targetDateStr,
      status: "pending" as const,
    }))
    .filter((a) => new Date(a.scheduled_for + "T00:00:00Z") >= today);
}

export function buildAlerts(contract: ContractDateData, today?: Date): AlertRow[] {
  const todayStart = new Date(today ?? new Date());
  todayStart.setUTCHours(0, 0, 0, 0);

  const { id, user_id, expiry_date, renewal_date, effective_date, notice_period_days } = contract;
  const alerts: AlertRow[] = [];

  if (expiry_date) {
    alerts.push(...tierAlerts(id, user_id, expiry_date, todayStart));
  }

  // Renewal alerts: when renewal_date is present and distinct from expiry_date (or expiry is null)
  if (renewal_date && renewal_date !== expiry_date) {
    alerts.push(...tierAlerts(id, user_id, renewal_date, todayStart));
  }

  if (notice_period_days && expiry_date) {
    const deadlineDate = addDays(expiry_date, -notice_period_days);
    const scheduledDate = addDays(toISODate(deadlineDate), -7);

    // Sanity check: skip only this alert if scheduled_for < effective_date
    // Use a local flag — do NOT early-return (would discard any renewal-date alerts already pushed)
    const disqualifiedByEffectiveDate =
      !!effective_date && scheduledDate <= new Date(effective_date + "T00:00:00Z");

    // Global skip rule: skip if scheduled_for <= today (applies to all alert types)
    if (!disqualifiedByEffectiveDate && scheduledDate > todayStart) {
      alerts.push({
        contract_id: id,
        user_id: user_id,
        alert_type: "notice_deadline",
        scheduled_for: toISODate(scheduledDate),
        target_date: toISODate(deadlineDate),
        status: "pending",
      });
    }
  }

  return alerts;
}
