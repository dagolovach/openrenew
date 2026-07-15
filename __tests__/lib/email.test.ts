// __tests__/lib/email.test.ts
import { buildAlertEmail } from '@/lib/email';

const base = {
  id: 'alert-1',
  contract_id: 'contract-1',
  user_id: 'user-1',
  alert_type: 'day_60' as const,
  scheduled_for: '2026-06-01',
  target_date: '2026-07-31',
  name: 'Acme SaaS Agreement',
  expiry_date: '2026-07-31',
  renewal_date: null,
  auto_renew: false,
  party_a: 'Acme Corp',
  party_b: null,
  contract_value: '£12,000/yr',
  notice_period_days: 30,
  email: 'user@example.com',
  annual_value: null,
  user_plan: null,
};

describe('buildAlertEmail', () => {
  it('auto_renew=true → subject contains "renews on"', () => {
    const { subject } = buildAlertEmail({ ...base, auto_renew: true });
    expect(subject).toContain('renews on');
  });

  it('auto_renew=false → subject contains "expires on"', () => {
    const { subject } = buildAlertEmail({ ...base, auto_renew: false });
    expect(subject).toContain('expires on');
  });

  it('auto_renew=null → subject contains "expires on"', () => {
    const { subject } = buildAlertEmail({ ...base, auto_renew: null });
    expect(subject).toContain('expires on');
  });

  it('notice_deadline → subject contains "Action required"', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'notice_deadline' });
    expect(subject).toContain('Action required');
  });

  it('day_60 → subject starts with ⏰ 60 days:', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'day_60' });
    expect(subject).toMatch(/^⏰ 60 days:/);
  });

  it('day_30 → subject starts with ⚠️ 30 days:', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'day_30' });
    expect(subject).toMatch(/^⚠️ 30 days:/);
  });

  it('day_7 → subject starts with 🔴 7 days:', () => {
    const { subject } = buildAlertEmail({ ...base, alert_type: 'day_7' });
    expect(subject).toMatch(/^🔴 7 days:/);
  });

  it('null party_a → Party A row omitted from HTML', () => {
    const { html } = buildAlertEmail({ ...base, party_a: null });
    expect(html).not.toContain('Party A');
  });

  it('null contract_value → row omitted from HTML', () => {
    const { html } = buildAlertEmail({ ...base, contract_value: null });
    expect(html).not.toContain('Contract value');
  });

  it('notice_deadline → HTML shows "You must act by"', () => {
    const { html } = buildAlertEmail({
      ...base,
      alert_type: 'notice_deadline',
      target_date: '2026-07-01',
    });
    expect(html).toContain('You must act by');
    expect(html).toContain('2026-07-01');
  });

  it('CTA link includes contract_id', () => {
    const { html } = buildAlertEmail({ ...base });
    expect(html).toContain('/dashboard/review/contract-1');
  });

  it('returns valid html string', () => {
    const { html } = buildAlertEmail({ ...base });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Renewl');
  });
});
