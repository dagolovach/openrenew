import { NextResponse, after } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, contractExtractions, activityLog } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { z } from "zod";

const extractSchema = z.object({
  contract_id: z.string().uuid("contract_id must be a valid UUID"),
  party_a: z.string().max(200).nullable().optional(),
  party_b: z.string().max(200).nullable().optional(),
});

export const dynamic = "force-dynamic";

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

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

function clampConfidence(value: unknown): number {
  const n = toNumber(value);
  if (n === null) return 0;
  return Math.max(0, Math.min(1, n));
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

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = user.id;

  const body = await request.json();
  const parsed = extractSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const { contract_id, party_a, party_b } = parsed.data;

  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, contract_id) });
  if (!contract) return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  if (["draft", "active"].includes(contract.status)) {
    return NextResponse.json({ error: "Already processed" }, { status: 409 });
  }
  if (!contract.filePath) return NextResponse.json({ error: "No file attached" }, { status: 422 });

  const filePath = contract.filePath;

  await db.update(contracts).set({
    partyA: party_a ?? contract.partyA ?? null,
    partyB: party_b ?? contract.partyB ?? null,
    status: "processing",
  }).where(eq(contracts.id, contract_id));

  const resolvedPartyA = party_a ?? contract.partyA ?? null;
  const resolvedPartyB = party_b ?? contract.partyB ?? null;

  after(async () => {
    const legacyResult = await callPythonExtraction("/extract", {
      file_path: filePath,
      contract_id,
      party_a: resolvedPartyA,
      party_b: resolvedPartyB,
    });

    const extractionResult: JsonObject = legacyResult.ok
      ? { ...legacyResult.json, engine: "legacy_fallback" }
      : { error: normalizeScalar(legacyResult.json.error) ?? "extraction_failed" };

    const failed = "error" in extractionResult && !("fields" in extractionResult);
    const isScanned = extractionResult.error === "no_text_extracted";
    const fields = asObject(extractionResult.fields);
    const confidence = clampConfidence(fields.confidence);

    const extractionStatus = failed ? "manual" : "review";
    const statusMessage = isScanned
      ? "This looks like a scanned PDF. Please enter the dates manually."
      : failed
      ? "Extraction failed. Please enter dates manually."
      : null;

    if (!failed) {
      const rows = UPSERT_FIELDS.map((field) => ({
        contractId: contract_id,
        fieldName: field,
        extractedValue: fields[field] != null ? String(fields[field]) : null,
        confirmedValue: null,
        confidence,
        wasEdited: false,
      }));
      // On re-extraction, refresh extractedValue only — user-confirmed values survive
      // (deliberate change from the SaaS version, which reset the whole row)
      await db.insert(contractExtractions).values(rows).onConflictDoUpdate({
        target: [contractExtractions.contractId, contractExtractions.fieldName],
        set: { extractedValue: sql`excluded.extracted_value` },
      });
    }

    await db.update(contracts).set({
      extractionStatus: extractionStatus,
      extractionConfidence: failed ? null : confidence,
      status: "draft",
      updatedAt: new Date(),
    }).where(eq(contracts.id, contract_id));

    await db.insert(activityLog).values({
      userId: userId,
      contractId: contract_id,
      eventType: "extraction_complete",
      metadata: {
        pipeline_version: "legacy",
        extraction_engine: "legacy_fallback",
        model: normalizeScalar(extractionResult.model),
        confidence: failed ? null : confidence,
        raw_text_length: toNumber(extractionResult.raw_text_length),
        extraction_status: extractionStatus,
        error: normalizeScalar(extractionResult.error),
        status_message: statusMessage,
      },
    });
  });

  return NextResponse.json({ status: "processing", contract_id });
}
