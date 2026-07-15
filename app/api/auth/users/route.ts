import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";

const createSchema = z.object({ email: z.string().email(), password: z.string().min(10) });

export async function POST(request: Request) {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isAdmin) return NextResponse.json({ error: "admin_only" }, { status: 403 });

  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [created] = await db.insert(users).values({
    email: parsed.data.email.toLowerCase(),
    passwordHash: await hashPassword(parsed.data.password),
    isAdmin: false,
  }).onConflictDoNothing().returning();
  if (!created) return NextResponse.json({ error: "email_exists" }, { status: 409 });
  return NextResponse.json({ ok: true, id: created.id });
}

export async function GET() {
  const me = await requireUser();
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const list = await db.query.users.findMany({
    columns: { id: true, email: true, isAdmin: true, createdAt: true },
  });
  return NextResponse.json({ users: list });
}
