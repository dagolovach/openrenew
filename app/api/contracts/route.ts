// app/api/contracts/route.ts
import { NextRequest, NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { contractExtractions, contracts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

// GET /api/contracts?ids=<uuid>,<uuid>,...
// Used by the dashboard's client-side polling loop (components/dashboard/contract-list.tsx)
// to check on in-progress extraction/analysis status. Returns the same snake_case shape
// (including nested contract_extractions) the component previously received from Supabase.
export async function GET(request: NextRequest) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const idsParam = request.nextUrl.searchParams.get("ids");
  if (!idsParam) return NextResponse.json({ error: "ids required" }, { status: 400 });

  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return NextResponse.json([]);

  const rows = await db.query.contracts.findMany({
    where: inArray(contracts.id, ids),
    columns: {
      id: true,
      status: true,
      extractionStatus: true,
      extractionConfidence: true,
      expiryDate: true,
      renewalDate: true,
      partyA: true,
      partyB: true,
      contractValue: true,
      noticePeriodDays: true,
      category: true,
      annualValue: true,
      updatedAt: true,
      createdAt: true,
      name: true,
      fileName: true,
      parentContractId: true,
    },
  });

  const extractionRows = await db.query.contractExtractions.findMany({
    where: inArray(contractExtractions.contractId, ids),
    columns: { contractId: true, confidence: true, confirmedValue: true, wasEdited: true, fieldName: true },
  });

  const extractionsByContract = new Map<string, typeof extractionRows>();
  for (const e of extractionRows) {
    const list = extractionsByContract.get(e.contractId) ?? [];
    list.push(e);
    extractionsByContract.set(e.contractId, list);
  }

  const result = rows.map((c) => ({
    id: c.id,
    status: c.status,
    extraction_status: c.extractionStatus,
    extraction_confidence: c.extractionConfidence,
    expiry_date: c.expiryDate,
    renewal_date: c.renewalDate,
    party_a: c.partyA,
    party_b: c.partyB,
    contract_value: c.contractValue,
    notice_period_days: c.noticePeriodDays,
    category: c.category,
    annual_value: c.annualValue,
    updated_at: c.updatedAt.toISOString(),
    created_at: c.createdAt.toISOString(),
    name: c.name,
    file_name: c.fileName,
    parent_contract_id: c.parentContractId,
    contract_extractions: (extractionsByContract.get(c.id) ?? []).map((e) => ({
      confidence: e.confidence,
      confirmed_value: e.confirmedValue,
      was_edited: e.wasEdited,
      field_name: e.fieldName,
    })),
  }));

  return NextResponse.json(result);
}
