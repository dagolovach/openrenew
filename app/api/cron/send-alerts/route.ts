import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { alerts as alertsTable, contracts, activityLog } from "@/lib/db/schema";
import { buildAlertEmail, AlertWithContext, AlertType } from "@/lib/email";
import { getSetting } from "@/lib/db/settings";
import { sendSlackMessage } from "@/lib/slack";
import { isSmtpConfigured, alertRecipients, sendEmail } from "@/lib/email-smtp";
import { timingSafeEqual } from "crypto";

const ALERT_LABEL: Record<AlertType, string> = {
  day_60: "renewal in 60 days",
  day_30: "renewal in 30 days",
  day_7: "renewal in 7 days",
  notice_deadline: "notice deadline",
};

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

  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  // ── Mark expired contracts ──────────────────────────────
  // Run BEFORE alert processing so same-day expiries are correctly
  // labelled before any alert logic reads contract status.
  try {
    const justExpired = await db
      .update(contracts)
      .set({ status: "expired" })
      .where(and(eq(contracts.status, "active"), lt(contracts.expiryDate, today)))
      .returning({ id: contracts.id });

    const expiredCount = justExpired.length;
    console.log(`[cron] Marked ${expiredCount} contract(s) as expired`);
    if (expiredCount > 0) {
      await db.insert(activityLog).values({
        userId: null,
        eventType: "contracts_expired",
        metadata: { count: expiredCount, date: today },
      });
    }
  } catch (expireError) {
    console.error("[cron] Failed to mark contracts as expired:", expireError);
  }

  // ── Delivery channels (read once per run) ────────────────
  const slackWebhook = await getSetting<string>("slack_webhook_url");
  const recipients = isSmtpConfigured() ? alertRecipients() : [];

  if (!slackWebhook && recipients.length === 0) {
    const pending = await db.query.alerts.findMany({
      where: and(lte(alertsTable.scheduledFor, today), eq(alertsTable.status, "pending")),
      columns: { id: true },
    });
    console.log(`[cron] no delivery channel configured; ${pending.length} alerts left pending`);
    await db.insert(activityLog).values({
      userId: null,
      eventType: "cron_alerts_sent",
      metadata: { sent: 0, failed: 0, total: 0, pending: pending.length, date: today },
    });
    return NextResponse.json({ sent: 0, failed: 0, total: 0, pending: pending.length });
  }

  const PAGE_SIZE = 100;
  const MAX_ALERTS_PER_RUN = 500;
  let totalSent = 0;
  let totalFailed = 0;
  let totalProcessed = 0;

  while (totalProcessed < MAX_ALERTS_PER_RUN) {
    // Always query status='pending' from the top — rows processed in the previous
    // iteration are now 'sent' or 'failed' and won't appear in this fetch.
    let dueAlerts;
    try {
      dueAlerts = await db
        .select({
          id: alertsTable.id,
          alertType: alertsTable.alertType,
          scheduledFor: alertsTable.scheduledFor,
          targetDate: alertsTable.targetDate,
          contractId: alertsTable.contractId,
          name: contracts.name,
          expiryDate: contracts.expiryDate,
          renewalDate: contracts.renewalDate,
          autoRenew: contracts.autoRenew,
          partyA: contracts.partyA,
          partyB: contracts.partyB,
          contractValue: contracts.contractValue,
          noticePeriodDays: contracts.noticePeriodDays,
          annualValue: contracts.annualValue,
        })
        .from(alertsTable)
        .innerJoin(contracts, eq(alertsTable.contractId, contracts.id))
        .where(and(lte(alertsTable.scheduledFor, today), eq(alertsTable.status, "pending")))
        .orderBy(asc(alertsTable.scheduledFor))
        .limit(PAGE_SIZE);
    } catch (queryError) {
      console.error("Cron: failed to query alerts", queryError);
      return new Response("Internal Server Error", { status: 500 });
    }

    if (dueAlerts.length === 0) break;

    const alertsWithContext: Array<AlertWithContext & { id: string }> = dueAlerts.map((a) => ({
      id: a.id,
      contract_id: a.contractId,
      alert_type: a.alertType as AlertType,
      scheduled_for: a.scheduledFor,
      target_date: a.targetDate,
      name: a.name,
      expiry_date: a.expiryDate,
      renewal_date: a.renewalDate,
      auto_renew: a.autoRenew,
      party_a: a.partyA,
      party_b: a.partyB,
      contract_value: a.contractValue,
      notice_period_days: a.noticePeriodDays,
      annual_value: a.annualValue,
    }));

    const results = await Promise.allSettled(
      alertsWithContext.map(async (alert) => {
        const errors: string[] = [];
        let delivered = false;

        if (slackWebhook) {
          const label = ALERT_LABEL[alert.alert_type];
          const line =
            `⏰ *${alert.name}* — ${label} on ${alert.target_date}` +
            `${alert.auto_renew ? " (auto-renews)" : ""} · ${process.env.APP_URL}/dashboard/contracts/${alert.contract_id}`;
          const ok = await sendSlackMessage(slackWebhook, line);
          if (ok) delivered = true;
          else errors.push("slack: delivery failed");
        }

        if (recipients.length > 0) {
          const email = buildAlertEmail(alert);
          const sendResults = await Promise.allSettled(
            recipients.map((to) => sendEmail({ to, subject: email.subject, html: email.html }))
          );
          const failures = sendResults.filter((r) => r.status === "rejected");
          if (failures.length < sendResults.length) delivered = true;
          if (failures.length > 0) {
            errors.push(`smtp: ${failures.length}/${sendResults.length} recipient(s) failed`);
          }
        }

        if (!delivered) {
          throw new Error(errors.join("; ") || "no delivery channel succeeded");
        }
        return alert.id;
      })
    );

    await Promise.all(
      results.map(async (result, i) => {
        const alertId = alertsWithContext[i].id;
        if (result.status === "fulfilled") {
          totalSent++;
          try {
            await db.update(alertsTable)
              .set({ status: "sent", sentAt: new Date() })
              .where(eq(alertsTable.id, alertId));
          } catch (err) {
            console.error(`Cron: failed to mark alert ${alertId} sent`, err);
          }
        } else {
          totalFailed++;
          const reason = String((result as PromiseRejectedResult).reason).slice(0, 500);
          console.error(`Cron: failed to send alert ${alertId}:`, reason);
          try {
            await db.update(alertsTable)
              .set({ status: "failed", failureReason: reason })
              .where(eq(alertsTable.id, alertId));
          } catch (err) {
            console.error(`Cron: failed to mark alert ${alertId} failed`, err);
          }
        }
      })
    );

    totalProcessed += dueAlerts.length;
    if (dueAlerts.length < PAGE_SIZE) break; // last page
  }

  if (totalProcessed >= MAX_ALERTS_PER_RUN) {
    console.error(
      `[cron] Hit MAX_ALERTS_PER_RUN ceiling (${MAX_ALERTS_PER_RUN}). ` +
      `Alerts may still be pending. Investigate backlog.`
    );
  }

  // Activity log — always written, even on zero-alert runs (complete audit trail)
  await db.insert(activityLog).values({
    userId: null,
    eventType: "cron_alerts_sent",
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
