// app/api/compare/route.ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, contractComparisons } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { triggerComparison } from "@/lib/comparison";
import { aiEnabled } from "@/lib/ai";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET /api/compare?contract_id=...
// Returns existing comparison or { comparison: null } if not yet run
export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    return NextResponse.json({ comparison: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json({ comparison: null }, { status: 400 });
  }

  const data = await db.query.contractComparisons.findFirst({
    where: eq(contractComparisons.contractId, contractId),
  });

  if (!data) {
    return NextResponse.json({ comparison: null });
  }

  return NextResponse.json({
    comparison: {
      field_changes: data.fieldChanges,
      clause_changes: data.clauseChanges,
      summary: data.summary,
      created_at: data.createdAt,
    },
  });
}

// POST /api/compare
// Triggers a new comparison between a contract and its parent
const compareSchema = z.object({
  contract_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!aiEnabled()) {
    return NextResponse.json(
      { error: "ai_disabled", message: "Set ANTHROPIC_API_KEY to enable AI features." },
      { status: 503 }
    );
  }

  const body = await request.json();
  const parsed = compareSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { contract_id } = parsed.data;

  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, contract_id),
    columns: { id: true, parentContractId: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  if (!contract.parentContractId) {
    return NextResponse.json(
      { error: "Contract has no parent — nothing to compare" },
      { status: 400 }
    );
  }

  try {
    const result = await triggerComparison(
      contract_id,
      contract.parentContractId,
      user.id
    );
    return NextResponse.json({ comparison: result });
  } catch (err) {
    console.error("[POST /api/compare] Comparison failed:", err);
    return NextResponse.json({ comparison: null, error: "comparison_failed" });
  }
}
