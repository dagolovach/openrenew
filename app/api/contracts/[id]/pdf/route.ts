import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { readPdf } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!contract?.filePath) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const bytes = await readPdf(contract.filePath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${contract.fileName ?? "contract.pdf"}"`,
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }
}
