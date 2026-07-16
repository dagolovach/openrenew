// app/api/calendar/feed.ics/route.ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { getSetting } from "@/lib/db/settings";
import { buildCalendar } from "@/lib/ical";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const stored = await getSetting<string>("ical_token");
  if (!stored || !token) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const a = Buffer.from(token);
  const b = Buffer.from(stored);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const rows = await db.query.contracts.findMany({
    where: eq(contracts.status, "active"),
    columns: { id: true, name: true, expiryDate: true, renewalDate: true, noticePeriodDays: true },
  });
  const cal = buildCalendar(rows.map((r) => ({
    id: r.id, name: r.name, expiry_date: r.expiryDate,
    renewal_date: r.renewalDate, notice_period_days: r.noticePeriodDays,
  })));
  return new NextResponse(cal, { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
}
