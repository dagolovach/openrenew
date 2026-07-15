import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { z } from "zod";

const extractSchema = z.object({
  contract_id: z.string().uuid("contract_id must be a valid UUID"),
  party_a: z.string().max(200).nullable().optional(),
  party_b: z.string().max(200).nullable().optional(),
});

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
const ENABLE_LEGACY_COMPARISON = process.env.EXTRACT_COMPARE_WITH_LEGACY === "true";

const UPSERT_FIELDS = [
  "effective_date",
  "expiry_date",
  "renewal_date",
  "auto_renew",
  "notice_period_days",
  "notice_period_text",
  "contract_value",
  "annual_value",
  "confidence",
  "category",
] as const;

type JsonObject = Record<string, unknown>;

type EndpointResult = {
  ok: boolean;
  json: JsonObject;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function normalizeScalar(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toInt(value: unknown): number | null {
  const n = toNumber(value);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.round(n);
}

function clampConfidence(value: unknown): number {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(1, n));
}

function mapLangGraphToLegacyFields(data: JsonObject): JsonObject {
  const renewalType = typeof data.renewal_type === "string" ? data.renewal_type : "unknown";
  const autoRenew = renewalType === "auto" || renewalType === "evergreen"
    ? true
    : renewalType === "manual"
    ? false
    : null;

  return {
    effective_date: normalizeScalar(data.effective_date),
    expiry_date: normalizeScalar(data.expiration_date),
    renewal_date: normalizeScalar(data.renewal_date),
    auto_renew: autoRenew,
    notice_period_days: toInt(data.notice_period_days),
    notice_period_text: normalizeScalar(data.notice_period_text),
    contract_value: normalizeScalar(data.contract_value),
    annual_value: toNumber(data.annual_value),
    confidence: clampConfidence(data.overall_confidence),
    category: normalizeScalar(data.category) ?? "vendor",
  };
}

function normalizeSnapshot(fields: JsonObject): Record<string, string | null> {
  const snapshot: Record<string, string | null> = {};
  for (const field of UPSERT_FIELDS) {
    snapshot[field] = normalizeScalar(fields[field]);
  }
  return snapshot;
}

function buildFieldComparison(legacyFields: JsonObject, langgraphFields: JsonObject) {
  const rows = UPSERT_FIELDS.map((field) => {
    const legacy = normalizeScalar(legacyFields[field]);
    const langgraph = normalizeScalar(langgraphFields[field]);
    return {
      field,
      legacy,
      langgraph,
      changed: legacy !== langgraph,
    };
  });

  return {
    changed_count: rows.filter((r) => r.changed).length,
    total_count: rows.length,
    rows,
  };
}

async function callPythonExtraction(path: string, payload: JsonObject): Promise<EndpointResult> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(55000),
    });

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (json == null) return { ok: false, json: { error: "invalid_response" } };
    return { ok: res.ok, json: asObject(json) };
  } catch {
    return { ok: false, json: { error: "timeout_or_network_error" } };
  }
}

export async function POST(request: Request) {
  if (!process.env.EXTRACTION_SERVICE_SECRET) {
    throw new Error("EXTRACTION_SERVICE_SECRET is not set");
  }
  if (!process.env.PYTHON_SERVICE_URL && process.env.NODE_ENV === "production") {
    throw new Error("PYTHON_SERVICE_URL must be set in production");
  }

  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;

  const body = await request.json();
  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { contract_id, party_a, party_b } = parsed.data;

  const { data: contract, error: contractError } = await sessionClient
    .from("contracts")
    .select("id, status, file_path, file_name, party_a, party_b")
    .eq("id", contract_id)
    .single();
  if (contractError || !contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (["draft", "active"].includes(contract.status)) {
    return NextResponse.json({ error: "Already processed" }, { status: 409 });
  }
  if (!contract.file_path) return NextResponse.json({ error: "No file attached" }, { status: 422 });

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: signedData, error: signError } = await adminClient.storage
    .from("contracts")
    .createSignedUrl(contract.file_path, 600);
  if (signError || !signedData) {
    return NextResponse.json({ error: "Could not generate file URL" }, { status: 500 });
  }

  await sessionClient.from("contracts").update({
    party_a: party_a ?? contract.party_a ?? null,
    party_b: party_b ?? contract.party_b ?? null,
    status: "processing",
  }).eq("id", contract_id).eq("user_id", userId);

  const resolvedPartyA = party_a ?? contract.party_a ?? null;
  const resolvedPartyB = party_b ?? contract.party_b ?? null;
  const signedUrl = signedData.signedUrl;

  after(async () => {
    let extractionResult: JsonObject = { error: "extraction_failed" };
    let extractionEngine = "langgraph_v2";

    let langgraphFieldsSnapshot: Record<string, string | null> | null = null;
    let legacyFieldsSnapshot: Record<string, string | null> | null = null;
    let fieldComparison: ReturnType<typeof buildFieldComparison> | null = null;

    const v2Result = await callPythonExtraction("/extract-v2/start", {
      file_url: signedUrl,
      thread_id: contract_id,
    });

    if (v2Result.ok) {
      const status = typeof v2Result.json.status === "string" ? v2Result.json.status : "error";
      const data = asObject(v2Result.json.data);
      const mappedV2Fields = mapLangGraphToLegacyFields(data);
      extractionResult = {
        fields: mappedV2Fields,
        model: "langgraph-gpt-4o",
        raw_text_length: null,
        v2_status: status,
        v2_thread_id: normalizeScalar(v2Result.json.thread_id),
        uncertain_fields: Array.isArray(v2Result.json.uncertain_fields) ? v2Result.json.uncertain_fields : [],
      };
      langgraphFieldsSnapshot = normalizeSnapshot(mappedV2Fields);
    } else {
      extractionResult = { error: normalizeScalar(v2Result.json.error) ?? "extraction_v2_failed" };
    }

    if (ENABLE_LEGACY_COMPARISON || ("error" in extractionResult && !("fields" in extractionResult))) {
      const legacyResult = await callPythonExtraction("/extract", {
        file_url: signedUrl,
        contract_id,
        party_a: resolvedPartyA,
        party_b: resolvedPartyB,
      });

      if (legacyResult.ok) {
        const legacyFields = asObject(legacyResult.json.fields);
        legacyFieldsSnapshot = normalizeSnapshot(legacyFields);

        if ("error" in extractionResult && !("fields" in extractionResult)) {
          extractionEngine = "legacy_fallback";
          extractionResult = {
            ...legacyResult.json,
            engine: extractionEngine,
          };
        }

        if (langgraphFieldsSnapshot) {
          fieldComparison = buildFieldComparison(legacyFields, asObject(extractionResult.fields));
        }
      }
    }

    const failed = "error" in extractionResult && !("fields" in extractionResult);
    const isScanned = extractionResult.error === "no_text_extracted";
    const fields = asObject(extractionResult.fields);
    const confidence = clampConfidence(fields.confidence);

    const extractionStatus = failed ? "manual" : "review";
    const statusMessage = isScanned
      ? "This looks like a scanned PDF. Please enter the dates manually."
      : failed
      ? "Extraction failed. Please enter dates manually."
      : extractionResult.v2_status === "human_needed"
      ? "LangGraph marked uncertain fields for review."
      : null;

    if (!failed) {
      const rows = UPSERT_FIELDS.map((field) => ({
        contract_id,
        field_name: field,
        extracted_value: fields[field] != null ? String(fields[field]) : null,
        confirmed_value: null,
        confidence,
        was_edited: false,
      }));
      await adminClient.from("contract_extractions").upsert(rows, {
        onConflict: "contract_id,field_name",
      });
    }

    await adminClient.from("contracts").update({
      extraction_status: extractionStatus,
      extraction_confidence: failed ? null : confidence,
      status: "draft",
      updated_at: new Date().toISOString(),
    }).eq("id", contract_id);

    await adminClient.from("activity_log").insert({
      user_id: userId,
      contract_id,
      event_type: "extraction_complete",
      metadata: {
        pipeline_version: "langgraph_v2",
        extraction_engine: extractionEngine,
        model: normalizeScalar(extractionResult.model),
        confidence: failed ? null : confidence,
        raw_text_length: toNumber(extractionResult.raw_text_length),
        extraction_status: extractionStatus,
        error: normalizeScalar(extractionResult.error),
        status_message: statusMessage,
        v2_thread_id: normalizeScalar(extractionResult.v2_thread_id),
        v2_status: normalizeScalar(extractionResult.v2_status),
        uncertain_fields: extractionResult.uncertain_fields ?? [],
        legacy_fields_snapshot: legacyFieldsSnapshot,
        langgraph_fields_snapshot: langgraphFieldsSnapshot,
        field_comparison: fieldComparison,
      },
    });

  });

  return NextResponse.json({ status: "processing", contract_id });
}
