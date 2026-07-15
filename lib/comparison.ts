// lib/comparison.ts
import { createClient } from "@supabase/supabase-js";

export type FieldChange = {
  field: string;
  previous: string | null;
  current: string | null;
  change_type: "increase" | "decrease" | "added" | "removed" | "modified";
  percentage: string | null;
  severity: "high" | "medium" | "low";
};

export type ClauseChange = {
  category: string;
  title: string;
  previous_state: string;
  current_state: string;
  severity: "high" | "medium" | "low";
};

export type ComparisonResult = {
  field_changes: FieldChange[];
  clause_changes: ClauseChange[];
  summary: string;
};

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

/**
 * Compare a renewal contract with its parent.
 *
 * Fetches both contract records, generates signed URLs for their PDFs,
 * calls Python /compare, and persists the result to contract_comparisons.
 *
 * Triggered from the review screen client (POST /api/compare) when parent_contract_id exists.
 */
export async function triggerComparison(
  contractId: string,
  parentContractId: string,
  userId: string
): Promise<ComparisonResult> {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Idempotency: comparisons are one-per-contract by design (UNIQUE constraint).
  // Re-triggering is not supported — use the /api/compare POST endpoint only once per contract.
  // 1. Check idempotency — if comparison already exists, return it
  const { data: existing } = await adminClient
    .from("contract_comparisons")
    .select("field_changes, clause_changes, summary")
    .eq("contract_id", contractId)
    .maybeSingle();

  if (existing) {
    return {
      field_changes: existing.field_changes as FieldChange[],
      clause_changes: existing.clause_changes as ClauseChange[],
      summary: existing.summary ?? "",
    };
  }

  const FIELD_COLS = "file_path, status, party_a, party_b, category, auto_renew, notice_period_days, contract_value, expiry_date, effective_date, renewal_date, notice_period_text";

  // 2. Fetch both contracts with their extracted/confirmed fields
  const [currentResult, previousResult] = await Promise.all([
    adminClient.from("contracts").select(FIELD_COLS).eq("id", contractId).single(),
    adminClient.from("contracts").select(FIELD_COLS).eq("id", parentContractId).single(),
  ]);

  if (currentResult.error || !currentResult.data || previousResult.error || !previousResult.data) {
    throw new Error("Could not fetch contract pair for comparison");
  }

  const current = currentResult.data;
  const previous = previousResult.data;

  // 3. Generate signed URLs for both PDFs (600s — same as /extract pattern)
  const [currentSigned, previousSigned] = await Promise.all([
    current.file_path
      ? adminClient.storage.from("contracts").createSignedUrl(current.file_path, 600)
      : Promise.resolve({ data: null, error: null }),
    previous.file_path
      ? adminClient.storage.from("contracts").createSignedUrl(previous.file_path, 600)
      : Promise.resolve({ data: null, error: null }),
  ]);

  // 4. Build field snapshots.
  // Draft contracts have null fields in the contracts table — values only land there at confirm.
  // Fall back to contract_extractions.extracted_value so comparison works before confirmation.
  const extractionOverride: Record<string, unknown> = {};
  if (current.status === "draft") {
    const { data: extractions } = await adminClient
      .from("contract_extractions")
      .select("field_name, extracted_value, confirmed_value")
      .eq("contract_id", contractId);
    if (extractions) {
      for (const row of extractions) {
        extractionOverride[row.field_name] = row.confirmed_value ?? row.extracted_value;
      }
    }
  }

  const currentFields: Record<string, unknown> = {
    party_a: extractionOverride.party_a ?? current.party_a,
    party_b: extractionOverride.party_b ?? current.party_b,
    category: extractionOverride.category ?? current.category,
    auto_renew: extractionOverride.auto_renew ?? current.auto_renew,
    notice_period_days: extractionOverride.notice_period_days ?? current.notice_period_days,
    contract_value: extractionOverride.contract_value ?? current.contract_value,
    expiry_date: extractionOverride.expiry_date ?? current.expiry_date,
    effective_date: extractionOverride.effective_date ?? current.effective_date,
    renewal_date: extractionOverride.renewal_date ?? current.renewal_date,
    notice_period_text: extractionOverride.notice_period_text ?? current.notice_period_text,
  };

  const previousFields: Record<string, unknown> = {
    party_a: previous.party_a,
    party_b: previous.party_b,
    category: previous.category,
    auto_renew: previous.auto_renew,
    notice_period_days: previous.notice_period_days,
    contract_value: previous.contract_value,
    expiry_date: previous.expiry_date,
    effective_date: previous.effective_date,
    renewal_date: previous.renewal_date,
    notice_period_text: previous.notice_period_text,
  };

  // 5. Call Python /compare with signed URLs
  let result: ComparisonResult;
  let modelUsed = "claude-haiku-4-5-20251001";

  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/compare`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
      },
      body: JSON.stringify({
        current_file_url: currentSigned.data?.signedUrl ?? null,
        previous_file_url: previousSigned.data?.signedUrl ?? null,
        current_fields: currentFields,
        previous_fields: previousFields,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!pyRes.ok) {
      const err = await pyRes.json().catch(() => ({}));
      throw new Error(`Python /compare returned ${pyRes.status}: ${(err as Record<string, string>).error ?? "unknown"}`);
    }

    const body = await pyRes.json() as {
      field_changes?: FieldChange[];
      clause_changes?: ClauseChange[];
      summary?: string;
      model?: string;
    };

    result = {
      field_changes: body.field_changes ?? [],
      clause_changes: body.clause_changes ?? [],
      summary: body.summary ?? "",
    };
    modelUsed = body.model ?? modelUsed;
  } catch (err) {
    console.error("[triggerComparison] Python call failed:", err);
    throw err;
  }

  // 6. Persist to contract_comparisons
  // UNIQUE(contract_id) — if concurrent triggers race, second insert gets 23505 (unique violation)
  const { error: insertError } = await adminClient.from("contract_comparisons").insert({
    contract_id: contractId,
    parent_contract_id: parentContractId,
    user_id: userId,
    field_changes: result.field_changes,
    clause_changes: result.clause_changes,
    summary: result.summary,
    model: modelUsed,
  });

  if (insertError && insertError.code !== "23505") {
    throw new Error(`Failed to persist comparison: ${insertError.message}`);
  }

  // Log to activity_log (best-effort — don't throw if it fails)
  await Promise.resolve(
    adminClient.from("activity_log").insert({
      user_id: userId,
      contract_id: contractId,
      event_type: "comparison_generated",
      metadata: {
        parent_contract_id: parentContractId,
        model: modelUsed,
        field_changes_count: result.field_changes.length,
        clause_changes_count: result.clause_changes.length,
      },
    })
  ).catch((err) => console.error("[triggerComparison] activity_log insert failed:", err));

  return result;
}
