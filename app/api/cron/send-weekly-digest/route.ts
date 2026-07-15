import { NextRequest, NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildDigestEmail, DigestContract } from '@/lib/email';
import { timingSafeEqual } from 'crypto';

const DIGEST_FROM = 'OpenRenew <alerts@localhost>';

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

  const resend = new Resend(process.env.RESEND_API_KEY);

  // ── Date range ─────────────────────────────────────────
  const todayDate = new Date();
  const today = todayDate.toISOString().split('T')[0]; // YYYY-MM-DD
  const ninetyDaysOut = new Date(todayDate);
  ninetyDaysOut.setUTCDate(ninetyDaysOut.getUTCDate() + 90);
  const ninetyDaysFromNow = ninetyDaysOut.toISOString().split('T')[0];

  // ── Query contracts expiring in the next 90 days ───────
  const { data, error } = await adminClient
    .from('contracts')
    .select(`
      id, user_id, name, party_a, expiry_date, renewal_date,
      auto_renew, notice_period_days, contract_value,
      profiles!inner ( email )
    `)
    .eq('status', 'active')
    .gte('expiry_date', today)
    .lte('expiry_date', ninetyDaysFromNow)
    .order('expiry_date', { ascending: true });

  if (error || !data) {
    console.error('Digest cron: failed to query contracts', error);
    return new Response('Internal Server Error', { status: 500 });
  }

  // ── Group by user ──────────────────────────────────────
  const userMap = new Map<string, { email: string; contracts: DigestContract[] }>();

  type ContractWithProfile = {
    id: string; user_id: string; name: string; party_a: string | null;
    expiry_date: string | null; renewal_date: string | null; auto_renew: boolean | null;
    notice_period_days: number | null; contract_value: string | null;
    profiles: { email: string };
  };
  for (const row of data as unknown as ContractWithProfile[]) {
    if (!row.expiry_date) continue; // guard: query filters this out, but be safe

    const days = Math.ceil(
      (new Date(row.expiry_date).getTime() - new Date(today).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    const contract: DigestContract = {
      id: row.id,
      name: row.name,
      party_a: row.party_a,
      expiry_date: row.expiry_date,
      renewal_date: row.renewal_date,
      auto_renew: row.auto_renew,
      notice_period_days: row.notice_period_days,
      contract_value: row.contract_value,
      days_until_expiry: days,
    };

    const userId: string = row.user_id;
    const existing = userMap.get(userId);
    if (existing) {
      existing.contracts.push(contract);
    } else {
      userMap.set(userId, { email: row.profiles.email, contracts: [contract] });
    }
  }

  // ── Send one digest per user ───────────────────────────
  let sentCount = 0;
  let skippedCount = 0;

  const sendResults = await Promise.allSettled(
    Array.from(userMap.entries()).map(async ([userId, { email, contracts }]) => {
      if (contracts.length === 0) {
        skippedCount++;
        return;
      }

      // contracts are already ordered ascending by expiry_date from the query
      const digest = buildDigestEmail({ email, contracts });
      await resend.emails.send({
        from: DIGEST_FROM,
        to: email,
        subject: digest.subject,
        html: digest.html,
      });

      return userId;
    })
  );

  for (const result of sendResults) {
    if (result.status === 'fulfilled' && result.value !== undefined) {
      sentCount++;
    } else if (result.status === 'rejected') {
      skippedCount++;
      console.error('Digest cron: failed to send digest:', String(result.reason).slice(0, 500));
    }
  }

  // ── Activity log ───────────────────────────────────────
  await adminClient.from('activity_log').insert({
    user_id: null,
    event_type: 'cron_digest_sent',
    metadata: { sent: sentCount, skipped: skippedCount, date: today },
  });

  return NextResponse.json({ sent: sentCount, skipped: skippedCount });
}
