// app/api/confirm/route.ts
import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { buildAlerts } from "@/lib/alerts";
import { triggerAnalysis } from "@/lib/analysis";
import { z } from "zod";
import { validateDateOrder } from "@/lib/utils";
import { posthogClient, shutdownPosthog } from "@/lib/posthog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = user.id;

  const body = await request.json();
  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { contract_id, name, category, fields } = parsed.data;

  const { data: contract, error: contractError } = await sessionClient
    .from("contracts")
    .select("id, status, file_path, expiry_date, renewal_date, effective_date, notice_period_days, parent_contract_id")
    .eq("id", contract_id)
    .single();

  if (contractError || !contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });

  // Upsert extractions (confidence metadata row is blocked by VALID_FIELDS check above)
  const extractionRows = Object.entries(fields as Record<string, unknown>).map(
    ([fieldName, value]) => ({
      contract_id,
      field_name: fieldName,
      confirmed_value: value != null ? String(value) : null,
    })
  );

  if (extractionRows.length > 0) {
    const { error: upsertError } = await sessionClient
      .from("contract_extractions")
      .upsert(extractionRows, { onConflict: "contract_id,field_name" });
    if (upsertError) {
      console.error("Upsert error:", upsertError);
      return NextResponse.json({ error: "Failed to save field values" }, { status: 500 });
    }
  }

  const f = fields as Record<string, unknown>;

  // ── Compute annual_value ──────────────────────────────────────────────────
  // Primary: use what the Python extraction service already computed.
  // Fallback: derive from contract_value string ÷ contract term in years.
  let computedAnnualValue: number | null = null;

  const { data: annualValueRow, error: avError } = await sessionClient
    .from("contract_extractions")
    .select("extracted_value, confirmed_value")
    .eq("contract_id", contract_id)
    .eq("field_name", "annual_value")
    .maybeSingle();
  if (avError) console.error("[confirm] annual_value extraction query failed:", avError);

  if (annualValueRow) {
    const raw = annualValueRow.confirmed_value ?? annualValueRow.extracted_value;
    const parsed = raw != null ? parseFloat(raw) : NaN;
    if (!isNaN(parsed) && parsed > 0) computedAnnualValue = parsed;
  }

  // Fallback: parse numeric portion of contract_value ÷ years
  if (computedAnnualValue === null) {
    const cvRaw = f.contract_value != null ? String(f.contract_value) : null;
    const effectiveStr = f.effective_date ? String(f.effective_date) : (contract.effective_date ?? null);
    const expiryStr   = f.expiry_date   ? String(f.expiry_date)   : (contract.expiry_date   ?? null);

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
  const hasFile = !!contract.file_path;

  const { error: updateError } = await sessionClient
    .from("contracts")
    .update({
      name, category: (f.category ?? category) as string, status: hasFile ? "analyzing" : "active", updated_at: new Date().toISOString(),
      expiry_date: f.expiry_date ? String(f.expiry_date) : null,
      renewal_date: f.renewal_date ? String(f.renewal_date) : null,
      effective_date: f.effective_date ? String(f.effective_date) : null,
      auto_renew: autoRenew,
      notice_period_days: noticePeriodDays,
      notice_period_text: f.notice_period_text != null ? String(f.notice_period_text) : null,
      party_a: f.party_a != null ? String(f.party_a) : null,
      party_b: f.party_b != null ? String(f.party_b) : null,
      contract_value: f.contract_value != null ? String(f.contract_value) : null,
      ...(computedAnnualValue !== null ? { annual_value: computedAnnualValue } : {}),
    })
    .eq("id", contract_id);

  if (updateError) {
    console.error("Update error:", updateError);
    return NextResponse.json({ error: "Failed to update contract" }, { status: 500 });
  }

  // Pre-generate alerts using confirmed values (not DB values which may be stale).
  // Use !== undefined check so an explicit null (field cleared) isn't overridden by the old
  // DB value. Treat empty strings as null so stale "" extractions don't silently suppress alerts.
  const coerceDate = (v: unknown): string | null => (v != null && v !== "" ? String(v) : null);
  const alertRows = buildAlerts({
    id: contract_id,
    user_id: userId,
    expiry_date: f.expiry_date !== undefined ? coerceDate(f.expiry_date) : (contract.expiry_date || null),
    renewal_date: f.renewal_date !== undefined ? coerceDate(f.renewal_date) : (contract.renewal_date || null),
    effective_date: f.effective_date !== undefined ? coerceDate(f.effective_date) : (contract.effective_date || null),
    notice_period_days: noticePeriodDays ?? contract.notice_period_days ?? null,
  });

  let alertCount = 0;
  if (alertRows.length > 0) {
    // No delete() before this upsert — intentional.
    // Upsert on (contract_id, alert_type, target_date) is idempotent.
    // Deleting first creates a window where alerts are permanently lost if the upsert fails.
    // Tradeoff: stale alerts for old target_dates remain if user re-confirms with changed dates.
    const { error: alertError } = await sessionClient
      .from("alerts")
      .upsert(alertRows, { onConflict: "contract_id,alert_type,target_date", ignoreDuplicates: true });
    if (alertError) {
      console.error("Alert upsert error (contract still confirmed):", alertError);
    } else {
      alertCount = alertRows.length;
    }
  }

  await sessionClient.from("activity_log").insert({
    user_id: userId,
    contract_id,
    event_type: "contract_confirmed",
    metadata: { contract_id, alert_count: alertCount },
  });

  // Log date order anomalies for extraction quality observability
  const dateWarnings = validateDateOrder({
    effective_date: coerceDate(f.effective_date),
    renewal_date:   coerceDate(f.renewal_date),
    expiry_date:    coerceDate(f.expiry_date),
  });
  if (dateWarnings.length > 0) {
    const { error: warningLogError } = await sessionClient.from("activity_log").insert({
      user_id: userId,
      contract_id,
      event_type: "date_order_warning",
      metadata: { warnings: dateWarnings },
    });
    if (warningLogError) console.error("[confirm] date_order_warning insert failed:", warningLogError);
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
      const adminClient = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );
      const { error } = await adminClient
        .from("contracts")
        .update({ status: "active" })
        .eq("id", contract_id);
      if (error) console.error("[confirm] Failed to mark contract active after analysis:", error);
    });
  }

  // Mark parent contract as expired and skip its pending alerts
  if (contract.parent_contract_id) {
    await sessionClient
      .from("contracts")
      .update({ status: "renewed" })
      .eq("id", contract.parent_contract_id)
      .eq("user_id", userId);

    await sessionClient
      .from("alerts")
      .update({ status: "skipped" })
      .eq("contract_id", contract.parent_contract_id)
      .eq("user_id", userId)
      .eq("status", "pending");
  }

  try {
    posthogClient.capture({
      distinctId: userId,
      event: 'contract_confirmed',
      properties: { contract_id },
    })
    await shutdownPosthog()
  } catch (e) {
    console.error('[confirm] PostHog capture failed:', e)
  }

  return NextResponse.json({ ok: true });
}
