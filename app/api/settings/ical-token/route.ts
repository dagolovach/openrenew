// app/api/settings/ical-token/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireUser } from "@/lib/auth/session";
import { setSetting } from "@/lib/db/settings";

export async function POST() {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "admin_only" }, { status: 403 });
  const token = randomBytes(32).toString("hex");
  await setSetting("ical_token", token);
  return NextResponse.json({ ok: true, token });
}
