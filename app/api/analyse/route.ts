// app/api/analyse/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { triggerAnalysis } from "@/lib/analysis";
import { z } from "zod";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// GET /api/analyse?contract_id=<uuid>
// Returns existing analysis without triggering a new one. Used by client polling loop.
export async function GET(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    // findings: null signals "keep polling" — reused here for simplicity
    return NextResponse.json({ findings: null }, { status: 401 });
  }

  const url = new URL(request.url);
  const contractId = url.searchParams.get("contract_id");
  if (!contractId) {
    return NextResponse.json({ findings: null }, { status: 400 });
  }

  // RLS on contract_analysis enforces that user can only see their own rows
  const { data } = await sessionClient
    .from("contract_analysis")
    .select("findings, analysis_version, created_at")
    .eq("contract_id", contractId)
    .order("analysis_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    // Analysis not yet run — client should keep polling
    return NextResponse.json({ findings: null });
  }

  return NextResponse.json({
    findings: data.findings,
    analysis_version: data.analysis_version,
    created_at: data.created_at,
  });
}

// POST /api/analyse
// Triggers a new analysis and persists it. Thin route — all logic in triggerAnalysis().
const analyseSchema = z.object({
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
  const parsed = analyseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { contract_id } = parsed.data;

  // Verify contract ownership via session client (RLS enforces this)
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contract_id)
    .maybeSingle();

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
