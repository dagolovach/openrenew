// app/api/compare/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerComparison } from "@/lib/comparison";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/compare?contract_id=...
// Returns existing comparison or { comparison: null } if not yet run
export async function GET(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ comparison: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json({ comparison: null }, { status: 400 });
  }

  const { data } = await sessionClient
    .from("contract_comparisons")
    .select("field_changes, clause_changes, summary, created_at")
    .eq("contract_id", contractId)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ comparison: null });
  }

  return NextResponse.json({ comparison: data });
}

// POST /api/compare
// Triggers a new comparison between a contract and its parent
const compareSchema = z.object({
  contract_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = compareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { contract_id } = parsed.data;

  // Verify ownership and get parent_contract_id (RLS ensures user owns contract)
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id, parent_contract_id")
    .eq("id", contract_id)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  if (!contract.parent_contract_id) {
    return NextResponse.json(
      { error: "Contract has no parent — nothing to compare" },
      { status: 400 }
    );
  }

  try {
    const result = await triggerComparison(
      contract_id,
      contract.parent_contract_id,
      user.id
    );
    return NextResponse.json({ comparison: result });
  } catch (err) {
    console.error("[POST /api/compare] Comparison failed:", err);
    return NextResponse.json({ comparison: null, error: "comparison_failed" });
  }
}
