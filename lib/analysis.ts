// lib/analysis.ts
import { createClient } from "@supabase/supabase-js";

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
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Idempotency: if a row was written within the last 60 seconds, return it
  //    This guards against double-confirm clicks firing two concurrent analyses.
  const { data: existing } = await adminClient
    .from("contract_analysis")
    .select("id, findings, created_at, analysis_version")
    .eq("contract_id", contractId)
    .order("analysis_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const ageMs = Date.now() - new Date(existing.created_at).getTime();
    if (ageMs < IDEMPOTENCY_WINDOW_MS) {
      return { findings: existing.findings as Finding[] };
    }
  }

  const nextVersion = existing ? (existing.analysis_version as number) + 1 : 1;

  // 2. Fetch contract fields (admin client bypasses RLS — contractId already verified upstream)
  const { data: contract, error: contractError } = await adminClient
    .from("contracts")
    .select(
      "file_path, party_a, party_b, category, auto_renew, notice_period_days, contract_value, expiry_date"
    )
    .eq("id", contractId)
    .single();

  if (contractError || !contract || !contract.file_path) {
    throw new Error("Contract not found or has no attached file");
  }

  // 3. Generate signed URL — storage requires service role key (session client cannot do this)
  const { data: signedData, error: signError } = await adminClient.storage
    .from("contracts")
    .createSignedUrl(contract.file_path, 120); // 120s validity — enough for the Python call

  if (signError || !signedData) {
    throw new Error("Could not generate signed URL for contract file");
  }

  // 4. Call Python /analyse
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
        file_url: signedData.signedUrl,
        contract_id: contractId,
        party_a: contract.party_a,
        party_b: contract.party_b,
        category: contract.category,
        auto_renew: contract.auto_renew,
        notice_period_days: contract.notice_period_days,
        contract_value: contract.contract_value,
        expiry_date: contract.expiry_date,
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

  // 5. Persist to contract_analysis
  //    UNIQUE(contract_id, analysis_version) constraint: concurrent triggers that race past
  //    the idempotency window will hit a unique violation (code "23505") on the second insert —
  //    that's acceptable. Any other error is a real problem and should surface.
  const { error: insertError } = await adminClient.from("contract_analysis").insert({
    contract_id: contractId,
    user_id: userId,
    findings,
    model: modelUsed,
    analysis_version: nextVersion,
  });
  if (insertError && insertError.code !== "23505") {
    throw new Error(`Failed to persist analysis: ${insertError.message}`);
  }

  // 6. Activity log
  await adminClient.from("activity_log").insert({
    user_id: userId,
    contract_id: contractId,
    event_type: "contract_analysed",
    metadata: { analysis_version: nextVersion, finding_count: findings.length },
  });

  return { findings };
}
