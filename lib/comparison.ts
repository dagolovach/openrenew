// lib/comparison.ts
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, contractComparisons, contractExtractions, activityLog } from "@/lib/db/schema";

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

const FIELD_COLUMNS = {
  filePath: true,
  status: true,
  partyA: true,
  partyB: true,
  category: true,
  autoRenew: true,
  noticePeriodDays: true,
  contractValue: true,
  expiryDate: true,
  effectiveDate: true,
  renewalDate: true,
  noticePeriodText: true,
} as const;

/**
 * Compare a renewal contract with its parent.
 *
 * Fetches both contract records and calls Python /compare with their file paths,
 * then persists the result to contract_comparisons.
 *
 * Triggered from the review screen client (POST /api/compare) when parent_contract_id exists.
 */
export async function triggerComparison(
  contractId: string,
  parentContractId: string,
  userId: string
): Promise<ComparisonResult> {
  // Idempotency: comparisons are one-per-contract by design (UNIQUE constraint).
  // Re-triggering is not supported — use the /api/compare POST endpoint only once per contract.
  // 1. Check idempotency — if comparison already exists, return it
  const existing = await db.query.contractComparisons.findFirst({
    where: eq(contractComparisons.contractId, contractId),
  });

  if (existing) {
    return {
      field_changes: existing.fieldChanges as FieldChange[],
      clause_changes: existing.clauseChanges as ClauseChange[],
      summary: existing.summary ?? "",
    };
  }

  // 2. Fetch both contracts with their extracted/confirmed fields
  const [current, previous] = await Promise.all([
    db.query.contracts.findFirst({ where: eq(contracts.id, contractId), columns: FIELD_COLUMNS }),
    db.query.contracts.findFirst({ where: eq(contracts.id, parentContractId), columns: FIELD_COLUMNS }),
  ]);

  if (!current || !previous) {
    throw new Error("Could not fetch contract pair for comparison");
  }

  // 3. Build field snapshots.
  // Draft contracts have null fields in the contracts table — values only land there at confirm.
  // Fall back to contract_extractions.extracted_value so comparison works before confirmation.
  const extractionOverride: Record<string, unknown> = {};
  if (current.status === "draft") {
    const extractionRows = await db.query.contractExtractions.findMany({
      where: eq(contractExtractions.contractId, contractId),
      columns: { fieldName: true, extractedValue: true, confirmedValue: true },
    });
    for (const row of extractionRows) {
      extractionOverride[row.fieldName] = row.confirmedValue ?? row.extractedValue;
    }
  }

  const currentFields: Record<string, unknown> = {
    party_a: extractionOverride.party_a ?? current.partyA,
    party_b: extractionOverride.party_b ?? current.partyB,
    category: extractionOverride.category ?? current.category,
    auto_renew: extractionOverride.auto_renew ?? current.autoRenew,
    notice_period_days: extractionOverride.notice_period_days ?? current.noticePeriodDays,
    contract_value: extractionOverride.contract_value ?? current.contractValue,
    expiry_date: extractionOverride.expiry_date ?? current.expiryDate,
    effective_date: extractionOverride.effective_date ?? current.effectiveDate,
    renewal_date: extractionOverride.renewal_date ?? current.renewalDate,
    notice_period_text: extractionOverride.notice_period_text ?? current.noticePeriodText,
  };

  const previousFields: Record<string, unknown> = {
    party_a: previous.partyA,
    party_b: previous.partyB,
    category: previous.category,
    auto_renew: previous.autoRenew,
    notice_period_days: previous.noticePeriodDays,
    contract_value: previous.contractValue,
    expiry_date: previous.expiryDate,
    effective_date: previous.effectiveDate,
    renewal_date: previous.renewalDate,
    notice_period_text: previous.noticePeriodText,
  };

  // 4. Call Python /compare with file paths
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
        current_file_path: current.filePath ?? null,
        previous_file_path: previous.filePath ?? null,
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

  // 5. Persist to contract_comparisons
  // UNIQUE(contract_id) — if concurrent triggers race, tolerate the conflict on the second insert
  await db.insert(contractComparisons).values({
    contractId,
    parentContractId,
    createdBy: userId,
    fieldChanges: result.field_changes,
    clauseChanges: result.clause_changes,
    summary: result.summary,
    model: modelUsed,
  }).onConflictDoNothing();

  // Log to activity_log (best-effort — don't throw if it fails)
  try {
    await db.insert(activityLog).values({
      userId,
      contractId,
      eventType: "comparison_generated",
      metadata: {
        parent_contract_id: parentContractId,
        model: modelUsed,
        field_changes_count: result.field_changes.length,
        clause_changes_count: result.clause_changes.length,
      },
    });
  } catch (err) {
    console.error("[triggerComparison] activity_log insert failed:", err);
  }

  return result;
}
