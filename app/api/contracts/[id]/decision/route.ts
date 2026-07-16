import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";

const bodySchema = z.union([
  z.object({ decision: z.enum(["renewing", "canceling", "negotiating"]).nullable() }),
  z.object({ snooze_days: z.number().int().min(1).max(90) }),
]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const contract = await db.query.contracts.findFirst({ where: eq(contracts.id, id) });
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if ("decision" in parsed.data) {
    await db.update(contracts)
      .set({ renewalDecision: parsed.data.decision, snoozedUntil: null, updatedAt: new Date() })
      .where(eq(contracts.id, id));
  } else {
    const until = new Date();
    until.setUTCHours(0, 0, 0, 0);
    until.setUTCDate(until.getUTCDate() + parsed.data.snooze_days);
    await db.update(contracts)
      .set({ snoozedUntil: until.toISOString().slice(0, 10), updatedAt: new Date() })
      .where(eq(contracts.id, id));
  }
  return NextResponse.json({ ok: true });
}
