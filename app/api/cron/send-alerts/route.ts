import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildAlertEmail, AlertWithContext, AlertType, EMAIL_FROM, EMAIL_REPLY_TO } from '@/lib/email';
import { timingSafeEqual } from 'crypto';

export async function GET(request: NextRequest) {
  // ── Startup assertions ─────────────────────────────────
  if (!process.env.CRON_SECRET) {
    console.error('CRON_SECRET is not set — cron route is unprotected');
    return new Response('Server misconfiguration', { status: 500 });
  }
  if (!process.env.APP_URL) {
    console.error('APP_URL is not set — email CTA links will be broken');
    return new Response('Server misconfiguration', { status: 500 });
  }

  // ── Auth guard ─────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader ?? '');

  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    return new Response('Unauthorized', { status: 401 });
  }

  // ── Admin client (service role — bypasses RLS for cross-user query) ────
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── Query due alerts ───────────────────────────────────
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  // ── Mark expired contracts ──────────────────────────────
  // Run BEFORE alert processing so same-day expiries are correctly
  // labelled before any alert logic reads contract status.
  const { data: justExpired, error: expireError } = await adminClient
    .from('contracts')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expiry_date', today)
    .select('id');

  if (expireError) {
    console.error('[cron] Failed to mark contracts as expired:', expireError);
  } else {
    const expiredCount = justExpired?.length ?? 0;
    console.log(`[cron] Marked ${expiredCount} contract(s) as expired`);
    if (expiredCount > 0) {
      await adminClient.from('activity_log').insert({
        user_id: null,
        event_type: 'contracts_expired',
        metadata: { count: expiredCount, date: today },
      });
    }
  }

  const PAGE_SIZE = 100;
  const MAX_ALERTS_PER_RUN = 500;
  let totalSent = 0;
  let totalFailed = 0;
  let totalProcessed = 0;
  const resend = new Resend(process.env.RESEND_API_KEY);

  while (totalProcessed < MAX_ALERTS_PER_RUN) {
    // Always query status='pending' from the top — rows processed in the previous
    // iteration are now 'sent' or 'failed' and won't appear in this fetch.
    const { data: alerts, error: queryError } = await adminClient
      .from('alerts')
      .select(`
        id, alert_type, scheduled_for, target_date,
        contract_id, user_id,
        contracts!inner ( name, expiry_date, renewal_date, auto_renew, party_a, party_b, contract_value, notice_period_days, annual_value ),
        profiles!inner ( email, plan )
      `)
      .lte('scheduled_for', today)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true })
      .limit(PAGE_SIZE);

    if (queryError || !alerts) {
      console.error('Cron: failed to query alerts', queryError);
      return new Response('Internal Server Error', { status: 500 });
    }

    if (alerts.length === 0) break;

    type AlertRow = {
      id: string; alert_type: AlertType; scheduled_for: string; target_date: string;
      contract_id: string; user_id: string;
      contracts: {
        name: string; expiry_date: string | null; renewal_date: string | null;
        auto_renew: boolean | null; party_a: string | null; party_b: string | null;
        contract_value: string | null; notice_period_days: number | null;
        annual_value: number | null;
      };
      profiles: { email: string; plan: string | null };
    };
    const alertsWithContext: AlertWithContext[] = (alerts as unknown as AlertRow[]).map((a) => ({
      id: a.id,
      alert_type: a.alert_type,
      scheduled_for: a.scheduled_for,
      target_date: a.target_date,
      contract_id: a.contract_id,
      user_id: a.user_id,
      name: a.contracts.name,
      expiry_date: a.contracts.expiry_date,
      renewal_date: a.contracts.renewal_date,
      auto_renew: a.contracts.auto_renew,
      party_a: a.contracts.party_a,
      party_b: a.contracts.party_b,
      contract_value: a.contracts.contract_value,
      notice_period_days: a.contracts.notice_period_days,
      email: a.profiles.email,
      annual_value: a.contracts.annual_value,
      user_plan: a.profiles.plan,
    }));

    const results = await Promise.allSettled(
      alertsWithContext.map(async (alert) => {
        const email = buildAlertEmail(alert);
        await resend.emails.send({
          from: EMAIL_FROM,
          replyTo: EMAIL_REPLY_TO,
          to: alert.email,
          subject: email.subject,
          html: email.html,
        });
        return alert.id;
      })
    );

    await Promise.all(
      results.map(async (result, i) => {
        const alertId = alertsWithContext[i].id;
        if (result.status === 'fulfilled') {
          totalSent++;
          const { error } = await adminClient
            .from('alerts')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', alertId);
          if (error) console.error(`Cron: failed to mark alert ${alertId} sent`, error);
        } else {
          totalFailed++;
          const reason = String((result as PromiseRejectedResult).reason).slice(0, 500);
          console.error(`Cron: failed to send alert ${alertId}:`, reason);
          const { error } = await adminClient
            .from('alerts')
            .update({ status: 'failed', failure_reason: reason })
            .eq('id', alertId);
          if (error) console.error(`Cron: failed to mark alert ${alertId} failed`, error);
        }
      })
    );

    totalProcessed += alerts.length;
    if (alerts.length < PAGE_SIZE) break; // last page
  }

  if (totalProcessed >= MAX_ALERTS_PER_RUN) {
    console.error(
      `[cron] Hit MAX_ALERTS_PER_RUN ceiling (${MAX_ALERTS_PER_RUN}). ` +
      `Alerts may still be pending. Investigate backlog.`
    );
  }

  // Activity log — always written, even on zero-alert runs (complete audit trail)
  await adminClient.from('activity_log').insert({
    user_id: null,
    event_type: 'cron_alerts_sent',
    metadata: {
      sent: totalSent,
      failed: totalFailed,
      total: totalProcessed,
      date: today,
      hit_ceiling: totalProcessed >= MAX_ALERTS_PER_RUN,
    },
  });

  return NextResponse.json({ sent: totalSent, failed: totalFailed, total: totalProcessed });
}
