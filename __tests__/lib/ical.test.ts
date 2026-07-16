import { buildCalendar, type IcalContract } from "@/lib/ical";

function c(overrides: Partial<IcalContract>): IcalContract {
  return { id: "abc", name: "Acme", expiry_date: null, renewal_date: null, notice_period_days: null, ...overrides };
}

describe("buildCalendar", () => {
  it("emits a valid empty calendar", () => {
    const cal = buildCalendar([]);
    expect(cal.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(cal.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(cal).toContain("VERSION:2.0");
    expect(cal).not.toContain("BEGIN:VEVENT");
  });
  it("emits expiry, notice-deadline, and distinct renewal events", () => {
    const cal = buildCalendar([c({ expiry_date: "2026-08-29", notice_period_days: 30, renewal_date: "2026-09-15" })]);
    expect(cal).toContain("UID:abc-expiry@openrenew");
    expect(cal).toContain("UID:abc-notice_deadline@openrenew");
    expect(cal).toContain("UID:abc-renewal@openrenew");
    expect(cal).toContain("DTSTART;VALUE=DATE:20260829");
    expect(cal).toContain("DTSTART;VALUE=DATE:20260730");
    expect(cal).toContain("SUMMARY:Acme expires");
  });
  it("skips renewal when equal to expiry, and uses CRLF endings only", () => {
    const cal = buildCalendar([c({ expiry_date: "2026-08-29", renewal_date: "2026-08-29" })]);
    expect(cal).not.toContain("abc-renewal@");
    expect(cal.replace(/\r\n/g, "").includes("\n")).toBe(false);
  });
  it("escapes special characters in summaries", () => {
    const cal = buildCalendar([c({ name: "Acme; GmbH, Ltd", expiry_date: "2026-08-29" })]);
    expect(cal).toContain("SUMMARY:Acme\\; GmbH\\, Ltd expires");
  });
  it("folds lines longer than 75 octets", () => {
    const longName = "X".repeat(100);
    const cal = buildCalendar([c({ name: longName, expiry_date: "2026-08-29" })]);
    for (const line of cal.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });
});
