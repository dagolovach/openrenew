import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  contract_id: z.string().uuid(),
});

type ComparisonRow = {
  field: string;
  legacy: string | null;
  langgraph: string | null;
  changed: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function GET(request: Request) {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({ contract_id: url.searchParams.get("contract_id") });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { contract_id } = parsed.data;

  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contract_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const { data: activity } = await sessionClient
    .from("activity_log")
    .select("metadata, created_at")
    .eq("contract_id", contract_id)
    .eq("event_type", "extraction_complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!activity) {
    return NextResponse.json({ comparison: null });
  }

  const metadata = asRecord(activity.metadata);
  const fieldComparison = asRecord(metadata.field_comparison);
  const rowsRaw = Array.isArray(fieldComparison.rows) ? fieldComparison.rows : [];
  const rows: ComparisonRow[] = rowsRaw
    .map((r) => asRecord(r))
    .map((r) => ({
      field: typeof r.field === "string" ? r.field : "",
      legacy: typeof r.legacy === "string" ? r.legacy : null,
      langgraph: typeof r.langgraph === "string" ? r.langgraph : null,
      changed: Boolean(r.changed),
    }))
    .filter((r) => r.field.length > 0);

  return NextResponse.json({
    comparison: {
      pipeline_version: typeof metadata.pipeline_version === "string" ? metadata.pipeline_version : null,
      extraction_engine: typeof metadata.extraction_engine === "string" ? metadata.extraction_engine : null,
      changed_count: typeof fieldComparison.changed_count === "number" ? fieldComparison.changed_count : rows.filter((r) => r.changed).length,
      total_count: typeof fieldComparison.total_count === "number" ? fieldComparison.total_count : rows.length,
      rows,
      created_at: activity.created_at,
    },
  });
}
