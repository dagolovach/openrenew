// lib/email.ts

export const EMAIL_FROM = 'OpenRenew <alerts@localhost>';
export const EMAIL_REPLY_TO = 'alerts@localhost';

function escapeHtml(str: string | null | undefined): string {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export type AlertType = 'day_60' | 'day_30' | 'day_7' | 'notice_deadline';

export type AlertWithContext = {
  id: string;
  contract_id: string;
  user_id: string;
  alert_type: AlertType;
  scheduled_for: string;
  target_date: string;
  name: string;
  expiry_date: string | null;
  renewal_date: string | null;
  auto_renew: boolean | null;
  party_a: string | null;
  party_b: string | null;
  contract_value: string | null;
  notice_period_days: number | null;
  email: string;
  annual_value: number | null;
  user_plan: string | null;
};

const URGENCY_COLOR: Record<AlertType, string> = {
  day_60: '#16a34a',
  day_30: '#d97706',
  day_7: '#dc2626',
  notice_deadline: '#dc2626',
};

const DAYS_LABEL: Record<AlertType, string> = {
  day_60: '60 days',
  day_30: '30 days',
  day_7: '7 days',
  notice_deadline: 'Notice deadline',
};

function verb(autoRenew: boolean | null): string {
  return autoRenew === true ? 'renews on' : 'expires on';
}

export function buildAlertEmail(alert: AlertWithContext): { subject: string; html: string } {
  const appUrl = process.env.APP_URL ?? '';
  const ctaUrl = `${appUrl}/dashboard/review/${alert.contract_id}`;
  const relevantDate = alert.expiry_date ?? alert.renewal_date ?? alert.target_date;
  const v = verb(alert.auto_renew);

  // Subject
  let subject: string;
  if (alert.alert_type === 'notice_deadline') {
    subject = `📋 Action required: ${alert.name} notice deadline in 7 days`;
  } else {
    const emoji = alert.alert_type === 'day_60' ? '⏰' : alert.alert_type === 'day_30' ? '⚠️' : '🔴';
    const days = DAYS_LABEL[alert.alert_type];
    subject = `${emoji} ${days}: ${alert.name} ${v} ${relevantDate}`;
  }

  // Detail grid rows (omit null values)
  const rows: Array<[string, string]> = [];
  if (alert.party_a) rows.push(['Party A', escapeHtml(alert.party_a)]);
  if (alert.party_b) rows.push(['Party B', escapeHtml(alert.party_b)]);
  rows.push(['Date', escapeHtml(relevantDate)]);
  if (alert.contract_value) rows.push(['Contract value', escapeHtml(alert.contract_value)]);
  if (alert.notice_period_days != null) rows.push(['Notice period', `${alert.notice_period_days} days`]);

  const detailRows = rows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:6px 12px 6px 0;color:#6b7280;font-size:14px;white-space:nowrap;">${label}</td>
        <td style="padding:6px 0;font-size:14px;color:#111827;">${value}</td>
      </tr>`
    )
    .join('');

  const noticeBlock =
    alert.alert_type === 'notice_deadline'
      ? `<p style="margin:16px 0 0;padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px;color:#991b1b;font-size:14px;">
           <strong>⚠ You must act by: ${escapeHtml(alert.target_date)}</strong><br/>
           <span style="color:#6b7280;">Refers to expiry: ${escapeHtml(alert.expiry_date) || 'N/A'}</span>
         </p>`
      : '';

  const annualValueBlock =
    alert.annual_value != null
      ? `<p style="margin:16px 0 0;font-size:14px;color:#d1d5db;">
           <strong style="color:#ffffff;">This contract is worth $${alert.annual_value.toLocaleString('en-US')}/year.</strong>
           Missing the notice deadline could lock you in for another term.
         </p>`
      : "";

  const bannerColor = URGENCY_COLOR[alert.alert_type];
  const headline =
    alert.alert_type === 'notice_deadline'
      ? `Notice deadline for ${escapeHtml(alert.name)} in 7 days`
      : `Your ${escapeHtml(alert.name)} ${v} ${escapeHtml(relevantDate)}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header -->
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
            <div style="display:inline-flex;align-items:center;gap:2px;margin-bottom:0;">
              <div style="width:24px;height:24px;border-radius:4px;background:#10B981;display:inline-flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:#0A0F1E;vertical-align:middle;">R</div>
              <span style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.02em;vertical-align:middle;">enewl</span>
            </div>
          </td>
        </tr>
        <!-- Urgency banner -->
        <tr>
          <td style="background:${bannerColor};padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;">
            ${DAYS_LABEL[alert.alert_type]}
          </td>
        </tr>
        <!-- Headline -->
        <tr>
          <td style="padding:24px 24px 0;">
            <h1 style="margin:0;font-size:20px;font-weight:700;color:#111827;line-height:1.3;">${headline}</h1>
          </td>
        </tr>
        <!-- Detail grid -->
        <tr>
          <td style="padding:16px 24px 0;">
            <table cellpadding="0" cellspacing="0">${detailRows}</table>
            ${noticeBlock}
            ${annualValueBlock}
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding:24px;">
            <a href="${ctaUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">View contract →</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Sent by OpenRenew ·
              <a href="${appUrl}/dashboard" style="color:#6b7280;">Manage alerts</a> ·
              Questions? <a href="mailto:hello@localhost" style="color:#6b7280;">hello@localhost</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// ── Weekly digest ─────────────────────────────────────────────────────────────

export interface DigestContract {
  id: string;
  name: string;
  party_a: string | null;
  expiry_date: string | null;
  renewal_date: string | null;
  auto_renew: boolean | null;
  notice_period_days: number | null;
  contract_value: string | null;
  days_until_expiry: number; // pre-computed by the cron route
}

export interface DigestEmailInput {
  email: string;
  contracts: DigestContract[]; // already sorted ascending by days_until_expiry
}

function digestUrgencyBand(days: number): { bg: string; border: string; text: string } {
  if (days <= 30) return { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' };
  if (days <= 60) return { bg: '#fffbeb', border: '#fde68a', text: '#92400e' };
  return { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' };
}

function formatDigestDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function buildDigestEmail(input: DigestEmailInput): { subject: string; html: string } {
  const appUrl = process.env.APP_URL ?? '';
  const n = input.contracts.length;
  const hasUrgent = input.contracts.some((c) => c.days_until_expiry <= 30);

  const base = n === 1
    ? '1 contract renewing in the next 90 days'
    : `${n} contracts renewing in the next 90 days`;
  const subject = hasUrgent ? `⚠ Action needed: ${base}` : base;

  const contractRows = input.contracts
    .map((c) => {
      const band = digestUrgencyBand(c.days_until_expiry);
      const safeName = escapeHtml(c.name);
      const safePartyA = escapeHtml(c.party_a);
      const safeValue = escapeHtml(c.contract_value);
      const dateStr = c.expiry_date ?? c.renewal_date ?? '';
      const verbLabel = c.auto_renew === true ? 'Renews' : 'Expires';
      const formattedDate = dateStr ? formatDigestDate(dateStr) : '';

      const noticeLine =
        c.notice_period_days != null && c.days_until_expiry <= c.notice_period_days + 14
          ? `<div style="margin-top:6px;font-size:12px;color:#92400e;">⚠ Notice deadline approaching</div>`
          : '';

      const partyLine = safePartyA
        ? `<div style="color:#6b7280;font-size:13px;margin-top:2px;">${safePartyA}</div>`
        : '';

      const valueLine = safeValue
        ? `<div style="color:#6b7280;font-size:13px;margin-top:4px;">${safeValue}</div>`
        : '';

      return `
        <table width="100%" cellpadding="0" cellspacing="0" style="background:${band.bg};border:1px solid ${band.border};border-radius:6px;margin-bottom:8px;">
          <tr>
            <td style="padding:12px 16px;vertical-align:top;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:top;">
                    <div style="font-weight:700;color:#111827;font-size:15px;">${safeName}</div>
                    ${partyLine}
                    <div style="color:#374151;font-size:13px;margin-top:6px;">${verbLabel} ${formattedDate}</div>
                    ${noticeLine}
                  </td>
                  <td style="vertical-align:top;text-align:right;white-space:nowrap;padding-left:16px;">
                    <span style="display:inline-block;font-weight:700;font-size:14px;color:${band.text};">${c.days_until_expiry} days</span>
                    ${valueLine}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>`;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <!-- Header -->
        <tr>
          <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
            <div style="display:inline-flex;align-items:center;gap:2px;margin-bottom:0;">
              <div style="width:24px;height:24px;border-radius:4px;background:#10B981;display:inline-flex;align-items:center;justify-content:center;font-family:'Courier New',monospace;font-size:14px;font-weight:700;color:#0A0F1E;vertical-align:middle;">R</div>
              <span style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#111827;letter-spacing:-0.02em;vertical-align:middle;">enewl</span>
            </div>
          </td>
        </tr>
        <!-- Banner -->
        <tr>
          <td style="background:#2563eb;padding:12px 24px;color:#ffffff;font-size:14px;font-weight:600;">
            Your weekly renewal digest
          </td>
        </tr>
        <!-- Intro -->
        <tr>
          <td style="padding:24px 24px 16px;">
            <p style="margin:0;font-size:15px;color:#374151;">You have ${n} contract${n === 1 ? '' : 's'} coming up in the next 90 days.</p>
          </td>
        </tr>
        <!-- Contract rows -->
        <tr>
          <td style="padding:0 24px 8px;">
            ${contractRows}
          </td>
        </tr>
        <!-- CTA -->
        <tr>
          <td style="padding:16px 24px 24px;">
            <a href="${appUrl}/dashboard" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;font-weight:600;">Go to dashboard →</a>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:16px 24px;border-top:1px solid #e5e7eb;background:#f9fafb;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">
              Sent by OpenRenew ·
              <a href="${appUrl}/dashboard" style="color:#6b7280;">Manage alerts</a> ·
              To stop receiving these digests, visit your <a href="${appUrl}/dashboard" style="color:#6b7280;">account settings</a>.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
