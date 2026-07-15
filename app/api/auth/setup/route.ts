import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

const setupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
});

export async function POST(request: Request) {
  const existing = await db.query.users.findFirst();
  if (existing) return NextResponse.json({ error: "already_configured" }, { status: 409 });

  const parsed = setupSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.flatten() }, { status: 400 });
  }

  const [admin] = await db.insert(users).values({
    email: parsed.data.email.toLowerCase(),
    passwordHash: await hashPassword(parsed.data.password),
    isAdmin: true,
  }).returning();

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSessionToken(admin.id), sessionCookieOptions());
  return res;
}
