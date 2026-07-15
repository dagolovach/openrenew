import { NextRequest, NextResponse } from "next/server";
import { eq, and, gte } from "drizzle-orm";
import { promises as fs } from "fs";
import { db } from "@/lib/db";
import { contracts, alerts as alertsTable } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { pdfAbsolutePath } from "@/lib/storage";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;

  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch contract to get file_path and parent_contract_id
  const contract = await db.query.contracts.findFirst({
    where: eq(contracts.id, contractId),
    columns: { id: true, filePath: true, parentContractId: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "Contract not found" }, { status: 404 });
  }

  // Delete DB row — cascades to contract_extractions, contract_analysis,
  // contract_comparisons, alerts, activity_log via FK
  try {
    await db.delete(contracts).where(eq(contracts.id, contractId));
  } catch (dbError) {
    console.error("DB delete error:", dbError);
    return NextResponse.json({ error: "Failed to delete contract" }, { status: 500 });
  }

  // Best-effort delete the PDF from disk — don't fail the request if this fails
  if (contract.filePath) {
    try {
      await fs.unlink(pdfAbsolutePath(contract.filePath));
    } catch (fileError) {
      console.error("Failed to delete PDF file:", fileError);
    }
  }

  // If this was a renewal, restore the parent contract to active
  // and re-activate its future alerts (those not yet past their scheduled_for date)
  if (contract.parentContractId) {
    await db.update(contracts).set({ status: "active" }).where(eq(contracts.id, contract.parentContractId));

    const today = new Date().toISOString().split("T")[0];
    await db.update(alertsTable).set({ status: "pending" }).where(
      and(
        eq(alertsTable.contractId, contract.parentContractId),
        eq(alertsTable.status, "skipped"),
        gte(alertsTable.scheduledFor, today)
      )
    );
  }

  return new Response(null, { status: 204 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: contractId } = await params;
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Only allow updating specific safe fields
  const allowed: Record<string, unknown> = {};
  if (typeof body.annual_value === "number") allowed.annualValue = body.annual_value;

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  try {
    await db.update(contracts).set(allowed).where(eq(contracts.id, contractId));
  } catch (error) {
    console.error("Update error:", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
