import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, activityLog } from "@/lib/db/schema";
import { buildDigestEmail, DigestContract } from "@/lib/email";
import { getSetting } from "@/lib/db/settings";
import { sendSlackMessage } from "@/lib/slack";
import { isSmtpConfigured, alertRecipients, sendEmail } from "@/lib/email-smtp";
import { timingSafeEqual } from "crypto";

export async function GET(request: NextRequest) {
  // ── Startup assertions ─────────────────────────────────
  if (!process.env.CRON_SECRET) {
    console.error("CRON_SECRET is not set — cron route is unprotected");
    return new Response("Server misconfiguration", { status: 500 });
  }
  if (!process.env.APP_URL) {
    console.error("APP_URL is not set — email CTA links will be broken");
    return new Response("Server misconfiguration", { status: 500 });
  }

  // ── Auth guard ─────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  const actual = Buffer.from(authHeader ?? "");

  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  // ── Delivery channels (skip cleanly if neither is configured) ──
  const slackWebhook = await getSetting<string>("slack_webhook_url");
  const recipients = isSmtpConfigured() ? alertRecipients() : [];

  if (!slackWebhook && recipients.length === 0) {
    console.log("[cron] weekly digest: no delivery channel configured; skipping");
    return NextResponse.json({ skipped: true });
  }

  // ── Date range ─────────────────────────────────────────
  const todayDate = new Date();
  const today = todayDate.toISOString().split("T")[0]; // YYYY-MM-DD
  const ninetyDaysOut = new Date(todayDate);
  ninetyDaysOut.setUTCDate(ninetyDaysOut.getUTCDate() + 90);
  const ninetyDaysFromNow = ninetyDaysOut.toISOString().split("T")[0];

  // ── Query contracts expiring in the next 90 days ───────
  let rows;
  try {
    rows = await db
      .select({
        id: contracts.id,
        name: contracts.name,
        partyA: contracts.partyA,
        expiryDate: contracts.expiryDate,
        renewalDate: contracts.renewalDate,
        autoRenew: contracts.autoRenew,
        noticePeriodDays: contracts.noticePeriodDays,
        contractValue: contracts.contractValue,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.status, "active"),
          gte(contracts.expiryDate, today),
          lte(contracts.expiryDate, ninetyDaysFromNow)
        )
      )
      .orderBy(asc(contracts.expiryDate));
  } catch (queryError) {
    console.error("Digest cron: failed to query contracts", queryError);
    return new Response("Internal Server Error", { status: 500 });
  }

  const digestContracts: DigestContract[] = rows
    .filter((row): row is typeof row & { expiryDate: string } => row.expiryDate != null)
    .map((row) => {
      const days = Math.ceil(
        (new Date(row.expiryDate).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24)
      );
      return {
        id: row.id,
        name: row.name,
        party_a: row.partyA,
        expiry_date: row.expiryDate,
        renewal_date: row.renewalDate,
        auto_renew: row.autoRenew,
        notice_period_days: row.noticePeriodDays,
        contract_value: row.contractValue,
        days_until_expiry: days,
      };
    });

  if (digestContracts.length === 0) {
    console.log("[cron] weekly digest: no contracts expiring in the next 90 days; skipping");
    return NextResponse.json({ skipped: true });
  }

  // ── Deliver one digest ──────────────────────────────────
  const digest = buildDigestEmail({ contracts: digestContracts });
  const errors: string[] = [];
  let delivered = false;

  if (slackWebhook) {
    const titles = digestContracts
      .slice(0, 5)
      .map((c) => `• ${c.name} — ${c.days_until_expiry} days`)
      .join("\n");
    const summary =
      `📋 Weekly renewal digest — ${digestContracts.length} contract(s) renewing in the next 90 days\n` +
      `${titles}\n${process.env.APP_URL}/dashboard`;
    const ok = await sendSlackMessage(slackWebhook, summary);
    if (ok) delivered = true;
    else errors.push("slack: delivery failed");
  }

  if (recipients.length > 0) {
    const sendResults = await Promise.allSettled(
      recipients.map((to) => sendEmail({ to, subject: digest.subject, html: digest.html }))
    );
    const failures = sendResults.filter((r) => r.status === "rejected");
    if (failures.length < sendResults.length) delivered = true;
    if (failures.length > 0) {
      errors.push(`smtp: ${failures.length}/${sendResults.length} recipient(s) failed`);
    }
  }

  if (!delivered) {
    console.error("Digest cron: failed to deliver digest:", errors.join("; "));
  }

  // ── Activity log ───────────────────────────────────────
  await db.insert(activityLog).values({
    userId: null,
    eventType: "cron_digest_sent",
    metadata: {
      sent: delivered ? 1 : 0,
      skipped: delivered ? 0 : 1,
      contract_count: digestContracts.length,
      date: today,
    },
  });

  return NextResponse.json({ sent: delivered ? 1 : 0, skipped: delivered ? 0 : 1 });
}
