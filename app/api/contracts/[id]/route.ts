// app/api/contracts/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { posthogClient, shutdownPosthog } from "@/lib/posthog";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch contract to get file_path and parent_contract_id — also verifies ownership via RLS + explicit eq
  const { data: contract, error: fetchError } = await supabase
    .from("contracts")
    .select("id, file_path, parent_contract_id")
    .eq("id", contractId)
    .eq("user_id", user.id)
    .single();

  if (fetchError || !contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Delete from Storage first (only if a file exists — manual contracts have no file)
  if (contract.file_path) {
    const adminClient = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { error: storageError } = await adminClient.storage
      .from("contracts")
      .remove([contract.file_path]);

    if (storageError) {
      console.error("Storage delete error:", storageError);
      return NextResponse.json({ error: "Failed to delete file" }, { status: 500 });
    }
  }

  // Delete DB row — cascades to contract_extractions, alerts, activity_log
  const { error: dbError } = await supabase
    .from("contracts")
    .delete()
    .eq("id", contractId)
    .eq("user_id", user.id);

  if (dbError) {
    console.error("DB delete error:", dbError);
    return NextResponse.json({ error: "Failed to delete contract" }, { status: 500 });
  }

  // If this was a renewal, restore the parent contract to active
  // and re-activate its future alerts (those not yet past their scheduled_for date)
  if (contract.parent_contract_id) {
    await supabase
      .from("contracts")
      .update({ status: "active" })
      .eq("id", contract.parent_contract_id)
      .eq("user_id", user.id);

    const today = new Date().toISOString().split("T")[0];
    await supabase
      .from("alerts")
      .update({ status: "pending" })
      .eq("contract_id", contract.parent_contract_id)
      .eq("user_id", user.id)
      .eq("status", "skipped")
      .gte("scheduled_for", today);
  }

  try {
    posthogClient.capture({
      distinctId: user.id,
      event: 'contract_deleted',
      properties: { contract_id: contractId },
    })
    await shutdownPosthog()
  } catch (e) {
    console.error('[contracts/delete] PostHog capture failed:', e)
  }

  return new Response(null, { status: 204 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow updating specific safe fields
  const allowed: Record<string, unknown> = {};
  if (typeof body.annual_value === "number") allowed.annual_value = body.annual_value;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { error } = await supabase
    .from("contracts")
    .update(allowed)
    .eq("id", contractId)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  try {
    posthogClient.capture({
      distinctId: user.id,
      event: 'contract_updated',
      properties: { contract_id: contractId, updated_fields: Object.keys(allowed) },
    })
    await shutdownPosthog()
  } catch (e) {
    console.error('[contracts/patch] PostHog capture failed:', e)
  }

  return NextResponse.json({ ok: true });
}
