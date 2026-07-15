// app/api/confirm/route.ts
import { NextResponse, after } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, contractExtractions, alerts as alertsTable, activityLog } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { buildAlerts } from "@/lib/alerts";
import { triggerAnalysis } from "@/lib/analysis";
import { z } from "zod";
import { validateDateOrder } from "@/lib/utils";

export const dynamic = "force-dynamic";

const VALID_CATEGORIES = ["saas", "lease", "vendor", "employment", "other"] as const;

const confirmSchema = z.object({
  contract_id: z.string().uuid(),
  name: z.string().min(1, "Name is required").max(500, "Name too long"),
  category: z.enum(VALID_CATEGORIES),
  fields: z.record(
    z.enum([
      "party_a", "party_b",
      "effective_date", "expiry_date", "renewal_date",
      "auto_renew", "notice_period_days", "notice_period_text",
      "contract_value",
    ]),
    z.union([z.string(), z.boolean(), z.number(), z.null()])
  ),
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { contract_id, name, category, fields } = parsed.data;

  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, contract_id) });

  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  // Upsert extractions (confidence metadata row is blocked by VALID_FIELDS check above)
  const extractionRows = Object.entries(fields as Record<string, unknown>).map(
    ([fieldName, value]) => ({
      contractId: contract_id,
      fieldName: fieldName,
      confirmedValue: value != null ? String(value) : null,
    })
  );

  if (extractionRows.length > 0) {
    try {
      await db.insert(contractExtractions).values(extractionRows).onConflictDoUpdate({
        target: [contractExtractions.contractId, contractExtractions.fieldName],
        set: { confirmedValue: sql`excluded.confirmed_value` },
      });
    } catch (upsertError) {
      console.error("Upsert error:", upsertError);
      return NextResponse.json({ error: "Failed to save field values" }, { status: 500 });
    }
  }

  const f = fields as Record<string, unknown>;

  // ── Compute annual_value ──────────────────────────────────────────────────
  // Primary: use what the Python extraction service already computed.
  // Fallback: derive from contract_value string ÷ contract term in years.
  let computedAnnualValue: number | null = null;

  let annualValueRow: { extractedValue: string | null; confirmedValue: string | null } | undefined;
  try {
    annualValueRow = await db.query.contractExtractions.findFirst({
      where: and(eq(contractExtractions.contractId, contract_id), eq(contractExtractions.fieldName, "annual_value")),
    });
  } catch (avError) {
    console.error("[confirm] annual_value extraction query failed:", avError);
  }

  if (annualValueRow) {
    const raw = annualValueRow.confirmedValue ?? annualValueRow.extractedValue;
    const parsed = raw != null ? parseFloat(raw) : NaN;
    if (!isNaN(parsed) && parsed > 0) computedAnnualValue = parsed;
  }

  // Fallback: parse numeric portion of contract_value ÷ years
  if (computedAnnualValue === null) {
    const cvRaw = f.contract_value != null ? String(f.contract_value) : null;
    const effectiveStr = f.effective_date ? String(f.effective_date) : (contract.effectiveDate ?? null);
    const expiryStr   = f.expiry_date   ? String(f.expiry_date)   : (contract.expiryDate   ?? null);

    if (cvRaw && effectiveStr && expiryStr) {
      const numericStr = cvRaw.replace(/[^0-9.]/g, "");
      const cvNum = parseFloat(numericStr);
      const years = (new Date(expiryStr).getTime() - new Date(effectiveStr).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (!isNaN(cvNum) && cvNum > 0 && years > 0) {
        computedAnnualValue = Math.round(cvNum / years);
      }
    }
  }

  const autoRenew =
    f.auto_renew != null
      ? typeof f.auto_renew === "string" ? f.auto_renew === "true" : Boolean(f.auto_renew)
      : null;
  const noticePeriodDaysParsed = f.notice_period_days != null ? parseInt(String(f.notice_period_days), 10) : null;
  const noticePeriodDays = noticePeriodDaysParsed != null && !isNaN(noticePeriodDaysParsed) ? noticePeriodDaysParsed : null;

  // Update contracts row BEFORE generating alerts (makes 409 guard effective on retries)
  const hasFile = !!contract.filePath;

  try {
    await db.update(contracts).set({
      name, category: (f.category ?? category) as string, status: hasFile ? "analyzing" : "active", updatedAt: new Date(),
      expiryDate: f.expiry_date ? String(f.expiry_date) : null,
      renewalDate: f.renewal_date ? String(f.renewal_date) : null,
      effectiveDate: f.effective_date ? String(f.effective_date) : null,
      autoRenew: autoRenew,
      noticePeriodDays: noticePeriodDays,
      noticePeriodText: f.notice_period_text != null ? String(f.notice_period_text) : null,
      partyA: f.party_a != null ? String(f.party_a) : null,
      partyB: f.party_b != null ? String(f.party_b) : null,
      contractValue: f.contract_value != null ? String(f.contract_value) : null,
      ...(computedAnnualValue !== null ? { annualValue: computedAnnualValue } : {}),
    }).where(eq(contracts.id, contract_id));
  } catch (updateError) {
    console.error("Update error:", updateError);
    return NextResponse.json({ error: "Failed to update contract" }, { status: 500 });
  }

  // Pre-generate alerts using confirmed values (not DB values which may be stale).
  // Use !== undefined check so an explicit null (field cleared) isn't overridden by the old
  // DB value. Treat empty strings as null so stale "" extractions don't silently suppress alerts.
  const coerceDate = (v: unknown): string | null => (v != null && v !== "" ? String(v) : null);
  const alertRows = buildAlerts({
    id: contract_id,
    expiry_date: f.expiry_date !== undefined ? coerceDate(f.expiry_date) : (contract.expiryDate || null),
    renewal_date: f.renewal_date !== undefined ? coerceDate(f.renewal_date) : (contract.renewalDate || null),
    effective_date: f.effective_date !== undefined ? coerceDate(f.effective_date) : (contract.effectiveDate || null),
    notice_period_days: noticePeriodDays ?? contract.noticePeriodDays ?? null,
  });

  let alertCount = 0;
  if (alertRows.length > 0) {
    // No delete() before this upsert — intentional.
    // Upsert on (contract_id, alert_type, target_date) is idempotent.
    // Deleting first creates a window where alerts are permanently lost if the upsert fails.
    // Tradeoff: stale alerts for old target_dates remain if user re-confirms with changed dates.
    try {
      await db.insert(alertsTable).values(
        alertRows.map((r) => ({
          contractId: r.contract_id,
          alertType: r.alert_type,
          scheduledFor: r.scheduled_for,
          targetDate: r.target_date,
          status: r.status,
        }))
      ).onConflictDoNothing({
        target: [alertsTable.contractId, alertsTable.alertType, alertsTable.targetDate],
      });
      alertCount = alertRows.length;
    } catch (alertError) {
      console.error("Alert upsert error (contract still confirmed):", alertError);
    }
  }

  try {
    await db.insert(activityLog).values({
      userId: userId,
      contractId: contract_id,
      eventType: "contract_confirmed",
      metadata: { contract_id, alert_count: alertCount },
    });
  } catch (logError) {
    console.error("[confirm] contract_confirmed activity log insert failed:", logError);
  }

  // Log date order anomalies for extraction quality observability
  const dateWarnings = validateDateOrder({
    effective_date: coerceDate(f.effective_date),
    renewal_date:   coerceDate(f.renewal_date),
    expiry_date:    coerceDate(f.expiry_date),
  });
  if (dateWarnings.length > 0) {
    try {
      await db.insert(activityLog).values({
        userId: userId,
        contractId: contract_id,
        eventType: "date_order_warning",
        metadata: { warnings: dateWarnings },
      });
    } catch (warningLogError) {
      console.error("[confirm] date_order_warning insert failed:", warningLogError);
    }
  }

  // Run analysis after responding — after() keeps the Vercel function alive up to maxDuration
  // Manual contracts (no file_path) skip analysis and are already marked active above.
  if (hasFile) {
    after(async () => {
      try {
        await triggerAnalysis(contract_id, userId);
      } catch (err) {
        console.error("[confirm] Background analysis failed:", err);
        return; // contract remains "analyzing" — polling timeout handles graceful fallback
      }
      // Mark contract active once analysis is complete
      try {
        await db.update(contracts).set({ status: "active" }).where(eq(contracts.id, contract_id));
      } catch (err) {
        console.error("[confirm] Failed to mark contract active after analysis:", err);
      }
    });
  }

  // Mark parent contract as expired and skip its pending alerts
  if (contract.parentContractId) {
    await db.update(contracts).set({ status: "renewed" }).where(eq(contracts.id, contract.parentContractId));

    await db.update(alertsTable).set({ status: "skipped" }).where(
      and(eq(alertsTable.contractId, contract.parentContractId), eq(alertsTable.status, "pending"))
    );
  }

  return NextResponse.json({ ok: true });
}
