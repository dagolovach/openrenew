// app/api/analyse/route.ts
import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts, contractAnalysis } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { triggerAnalysis } from "@/lib/analysis";
import { aiEnabled } from "@/lib/ai";
import { z } from "zod";

export const dynamic = "force-dynamic";

// GET /api/analyse?contract_id=<uuid>
// Returns existing analysis without triggering a new one. Used by client polling loop.
export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) {
    // findings: null signals "keep polling" — reused here for simplicity
    return NextResponse.json({ findings: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json({ findings: null }, { status: 400 });
  }

  const data = await db.query.contractAnalysis.findFirst({
    where: eq(contractAnalysis.contractId, contractId),
    orderBy: desc(contractAnalysis.analysisVersion),
  });

  if (!data) {
    // Analysis not yet run — client should keep polling
    return NextResponse.json({ findings: null });
  }

  return NextResponse.json({
    findings: data.findings,
    analysis_version: data.analysisVersion,
    created_at: data.createdAt,
  });
}

// POST /api/analyse
// Triggers a new analysis and persists it. Thin route — all logic in triggerAnalysis().
const analyseSchema = z.object({
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
  const parsed = analyseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { contract_id } = parsed.data;

  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, contract_id),
    columns: { id: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  try {
    const { findings } = await triggerAnalysis(contract_id, user.id);
    return NextResponse.json({ findings });
  } catch (err) {
    console.error("[POST /api/analyse] Analysis failed:", err);
    return NextResponse.json({ findings: [], error: "analysis_failed" });
  }
}
