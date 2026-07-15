import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "./password";
import { randomBytes } from "crypto";

export const SESSION_COOKIE = "openrenew_session";
const SESSION_DAYS = 30;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (>=32 chars)");
  return new TextEncoder().encode(s);
}

export async function signSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export type SessionUser = { id: string; email: string; isAdmin: boolean };

/** AUTH_DISABLED mode: use (or create) a local default user so FKs stay valid. */
async function ensureLocalUser(): Promise<SessionUser> {
  const existing = await db.query.users.findFirst({ orderBy: asc(users.createdAt) });
  if (existing) return { id: existing.id, email: existing.email, isAdmin: existing.isAdmin };
  const [created] = await db.insert(users).values({
    email: "admin@localhost",
    passwordHash: await hashPassword(randomBytes(32).toString("hex")),
    isAdmin: true,
  }).returning();
  return { id: created.id, email: created.email, isAdmin: created.isAdmin };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  if (process.env.AUTH_DISABLED === "true") return ensureLocalUser();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifySessionToken(token);
  if (!userId) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  return user ? { id: user.id, email: user.email, isAdmin: user.isAdmin } : null;
}

/** For API routes. */
export async function requireUser(): Promise<SessionUser | null> {
  return getSessionUser();
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.APP_URL?.startsWith("https://") ?? false,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
