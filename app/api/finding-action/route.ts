// app/api/finding-action/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  contract_id: z.string().uuid(),
  findings: z
    .array(
      z.object({
        category: z.enum([
          "auto_renewal", "notice_period", "liability", "payment_terms",
          "termination", "ip_ownership", "data_privacy", "price_escalation",
          "exclusivity", "governing_law", "other",
        ]),
        title: z.string().max(100),
        explanation: z.string().max(500),
        action: z.string().max(300).nullable(),
      })
    )
    .min(1),
  contract_context: z.object({
    name: z.string(),
    party_a: z.string().nullable(),
    party_b: z.string().nullable(),
    expiry_date: z.string().nullable(),
    renewal_date: z.string().nullable(),
    notice_period_days: z.number().nullable(),
    contract_value: z.string().nullable(),
    category: z.string(),
    notice_window_closed: z.boolean(),
  }),
});

export async function POST(request: Request) {
  const sessionClient = await createClient();
  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { contract_id, findings, contract_context } = parsed.data;

  // Verify the authenticated user owns this contract (defence in depth alongside RLS)
  const { data: contract } = await sessionClient
    .from("contracts")
    .select("id")
    .eq("id", contract_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  const pythonUrl = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";
  const secret = process.env.EXTRACTION_SERVICE_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Service not configured" }, { status: 500 });
  }

  const payload = {
    contract_name: contract_context.name,
    party_a: contract_context.party_a,
    party_b: contract_context.party_b,
    expiry_date: contract_context.expiry_date,
    renewal_date: contract_context.renewal_date,
    notice_period_days: contract_context.notice_period_days,
    contract_value: contract_context.contract_value,
    category: contract_context.category,
    notice_window_closed: contract_context.notice_window_closed,
    findings: findings.map((f) => ({
      category: f.category,
      title: f.title,
      explanation: f.explanation,
      action: f.action,
    })),
  };

  try {
    const res = await fetch(`${pythonUrl}/draft-action-email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[finding-action] Python draft failed:", res.status, err);
      return NextResponse.json({ error: "Draft generation failed" }, { status: 502 });
    }

    const draft = await res.json();
    return NextResponse.json(draft);
  } catch (e) {
    console.error("[finding-action] Python service unreachable:", e);
    return NextResponse.json({ error: "Draft generation failed" }, { status: 502 });
  }
}
