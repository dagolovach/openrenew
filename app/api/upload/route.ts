// app/api/upload/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { uploadLimiter } from "@/lib/ratelimit";
import { posthogClient, shutdownPosthog } from "@/lib/posthog";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function POST(request: Request) {
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success: rateLimitOk } = await uploadLimiter.limit(user.id);
  if (!rateLimitOk) {
    return NextResponse.json({ error: "Too many uploads. Please wait before uploading again." }, { status: 429 });
  }

  // Free tier: check contract count
  const { data: profile, error: profileError } = await sessionClient
    .from('profiles')
    .select('plan')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    console.error('Failed to fetch profile for free tier check:', profileError)
    return NextResponse.json({ error: 'Failed to verify account status' }, { status: 500 })
  }

  if (profile.plan === 'free') {
    const { count } = await sessionClient
      .from('contracts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('status', 'in', '("expired","renewed")')

    if ((count ?? 0) >= 20) {
      return NextResponse.json(
        { error: 'free_tier_limit', message: 'Free plan is limited to 20 contracts. Upgrade to Pro for unlimited contracts.' },
        { status: 403 }
      )
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 413 });
  }

  const parentContractId = formData.get("parent_contract_id") as string | null;

  const contractId = randomUUID();
  const filePath = `${user.id}/${contractId}/original.pdf`;
  const fileName = file.name;

  // Admin client for storage (service role — Storage RLS requires service role for server-side uploads)
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { error: uploadError } = await adminClient.storage
    .from("contracts")
    .upload(filePath, await file.arrayBuffer(), { contentType: "application/pdf" });

  if (uploadError) {
    console.error("Storage upload error:", uploadError);
    return NextResponse.json({ error: "File upload failed" }, { status: 500 });
  }

  // Determine contract version and name
  // name = filename minus extension (NOT NULL in schema; overwritten on confirm)
  // category = 'other' (NOT NULL in schema; overwritten on confirm)
  let contractName = fileName.replace(/\.pdf$/i, "");
  let contractVersion = 1;

  if (parentContractId) {
    const { data: parent } = await sessionClient
      .from("contracts")
      .select("contract_version, name")
      .eq("id", parentContractId)
      .eq("user_id", user.id)
      .single();

    if (parent) {
      contractVersion = (parent.contract_version ?? 1) + 1;
      // Strip any existing version suffix so we don't get "Name (V2) (v3)"
      const baseName = (parent.name ?? "Contract").replace(/\s*\(v\d+\)\s*$/i, "").trim();
      contractName = `${baseName} (v${contractVersion})`;
    }
  }

  const { error: dbError } = await sessionClient.from("contracts").insert({
    id: contractId,
    user_id: user.id,
    name: contractName,
    category: "other",
    status: "party_review",
    extraction_status: "pending",
    file_path: filePath,
    file_name: fileName,
    parent_contract_id: parentContractId || null,
    contract_version: contractVersion,
  });

  if (dbError) {
    console.error("DB insert error:", dbError);
    return NextResponse.json({ error: "Failed to create contract record" }, { status: 500 });
  }

  // Detect party names from PDF text (pdfplumber + regex only, no AI)
  let detectedParties: { party_a: string | null; party_b: string | null; confidence: number } = {
    party_a: null,
    party_b: null,
    confidence: 0,
  };
  try {
    const { data: signedData } = await adminClient.storage
      .from("contracts")
      .createSignedUrl(filePath, 60);

    if (signedData) {
      const detectRes = await fetch(`${PYTHON_SERVICE_URL}/detect-parties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
        },
        body: JSON.stringify({ file_url: signedData.signedUrl }),
        signal: AbortSignal.timeout(15000),
      });
      if (detectRes.ok) {
        detectedParties = await detectRes.json();
      }
    }
  } catch (e) {
    console.error("[upload] Party detection failed (non-blocking):", e);
  }

  try {
    posthogClient.capture({
      distinctId: user.id,
      event: 'contract_uploaded',
      properties: {
        contract_id: contractId,
        file_size_kb: Math.round(file.size / 1024),
      },
    })
    posthogClient.identify({
      distinctId: user.id,
      properties: { email: user.email ?? undefined },
    })
    await shutdownPosthog()
  } catch (e) {
    console.error('[upload] PostHog capture failed:', e)
  }

  // Compute contracts_remaining for free-tier banner
  let contracts_remaining: number | null = null;
  if (profile.plan === 'free') {
    const { count: newCount } = await sessionClient
      .from('contracts')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('status', 'in', '("expired","renewed")');
    contracts_remaining = Math.max(0, 20 - (newCount ?? 0));
  }

  return NextResponse.json({ contract_id: contractId, detected_parties: detectedParties, contracts_remaining });
}
