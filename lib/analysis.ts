// lib/analysis.ts
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, contractAnalysis, activityLog } from "@/lib/db/schema";

export type Finding = {
  type: "warning" | "positive" | "info";
  category: string;
  title: string;
  explanation: string;
  action: string | null;
  severity: "high" | "medium" | "low" | null;
};

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const IDEMPOTENCY_WINDOW_MS = 60_000; // 60 seconds

export async function triggerAnalysis(
  contractId: string,
  userId: string
): Promise<{ findings: Finding[] }> {
  // 1. Idempotency: if a row was written within the last 60 seconds, return it
  //    This guards against double-confirm clicks firing two concurrent analyses.
  const existing = await db.query.contractAnalysis.findFirst({
    where: eq(contractAnalysis.contractId, contractId),
    orderBy: desc(contractAnalysis.analysisVersion),
  });

  if (existing) {
    const ageMs = Date.now() - existing.createdAt.getTime();
    if (ageMs < IDEMPOTENCY_WINDOW_MS) {
      return { findings: existing.findings as Finding[] };
    }
  }

  const nextVersion = existing ? existing.analysisVersion + 1 : 1;

  // 2. Fetch contract fields (contractId already verified upstream)
  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, contractId),
    columns: {
      filePath: true,
      partyA: true,
      partyB: true,
      category: true,
      autoRenew: true,
      noticePeriodDays: true,
      contractValue: true,
      expiryDate: true,
    },
  });

  if (!contract || !contract.filePath) {
    throw new Error("Contract not found or has no attached file");
  }

  // 3. Call Python /analyse
  let findings: Finding[];
  let modelUsed = "claude-haiku-4-5";
  try {
    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/analyse`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
      },
      body: JSON.stringify({
        file_path: contract.filePath,
        contract_id: contractId,
        party_a: contract.partyA,
        party_b: contract.partyB,
        category: contract.category,
        auto_renew: contract.autoRenew,
        notice_period_days: contract.noticePeriodDays,
        contract_value: contract.contractValue,
        expiry_date: contract.expiryDate,
      }),
      signal: AbortSignal.timeout(55_000),
    });

    if (!pyRes.ok) {
      const err = await pyRes.json().catch(() => ({}));
      throw new Error(`Python /analyse returned ${pyRes.status}: ${err.error ?? "unknown"}`);
    }

    const body = await pyRes.json().catch(() => null);
    if (!body) throw new Error(`Python /analyse returned unparseable JSON (${pyRes.status})`);
    findings = Array.isArray(body.findings) ? body.findings : [];
    modelUsed = typeof body.model === "string" ? body.model : "claude-haiku-4-5";
  } catch (err) {
    // Log and re-throw — callers decide whether to surface or swallow
    console.error("[triggerAnalysis] Python call failed:", err);
    throw err;
  }

  // 4. Persist to contract_analysis
  //    UNIQUE(contract_id, analysis_version) constraint: concurrent triggers that race past
  //    the idempotency window will hit a unique violation on the second insert — that's
  //    acceptable, so we tolerate the conflict rather than surfacing it.
  await db.insert(contractAnalysis).values({
    contractId,
    createdBy: userId,
    findings,
    model: modelUsed,
    analysisVersion: nextVersion,
  }).onConflictDoNothing();

  // 5. Activity log
  await db.insert(activityLog).values({
    userId,
    contractId,
    eventType: "contract_analysed",
    metadata: { analysis_version: nextVersion, finding_count: findings.length },
  });

  return { findings };
}
