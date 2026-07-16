// app/api/upload/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { savePdf } from "@/lib/storage";
import { aiEnabled } from "@/lib/ai";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8000";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  const filePath = `${contractId}/original.pdf`;
  const fileName = file.name;

  try {
    await savePdf(filePath, await file.arrayBuffer());
  } catch (e) {
    console.error("Storage write error:", e);
    return NextResponse.json({ error: "File upload failed" }, { status: 500 });
  }

  const aiOn = aiEnabled();

  let contractName = fileName.replace(/\.pdf$/i, "");
  let contractVersion = 1;
  if (parentContractId) {
    const parent = await db.query.contracts.findFirst({
      where: eq(contracts.id, parentContractId),
    });
    if (parent) {
      contractVersion = (parent.contractVersion ?? 1) + 1;
      const baseName = (parent.name ?? "Contract").replace(/\s*\(v\d+\)\s*$/i, "").trim();
      contractName = `${baseName} (v${contractVersion})`;
    }
  }

  // Without AI, there is no party-detection/anonymization/extraction pipeline to run —
  // land the contract straight in the same "manual entry" state used when extraction
  // fails, so the review page shows the PDF with empty, freely-editable fields.
  try {
    await db.insert(contracts).values({
      id: contractId,
      createdBy: user.id,
      name: contractName,
      category: "other",
      status: aiOn ? "party_review" : "draft",
      extractionStatus: aiOn ? "pending" : "manual",
      filePath,
      fileName,
      fileSizeBytes: file.size,
      parentContractId: parentContractId || null,
      contractVersion,
    });
  } catch (e) {
    console.error("DB insert error:", e);
    return NextResponse.json({ error: "Failed to create contract record" }, { status: 500 });
  }

  // Party detection — requires ANTHROPIC_API_KEY; non-blocking either way
  let detectedParties: { party_a: string | null; party_b: string | null; confidence: number } = {
    party_a: null, party_b: null, confidence: 0,
  };
  if (aiOn) {
    try {
      const detectRes = await fetch(`${PYTHON_SERVICE_URL}/detect-parties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
        },
        body: JSON.stringify({ file_path: filePath }),
        signal: AbortSignal.timeout(15000),
      });
      if (detectRes.ok) detectedParties = await detectRes.json();
    } catch (e) {
      console.error("[upload] Party detection failed (non-blocking):", e);
    }
  }

  return NextResponse.json({ contract_id: contractId, detected_parties: detectedParties, contracts_remaining: null });
}
