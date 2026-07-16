// lib/ical.ts — RFC 5545 calendar of contract deadlines. Pure.
export type IcalContract = {
  id: string; name: string;
  expiry_date: string | null; renewal_date: string | null;
  notice_period_days: number | null;
};

const CRLF = "\r\n";

function fold(line: string): string {
  // RFC 5545 §3.1: max 75 octets per line; continuation lines start with a space.
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, "utf8") > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
  }
  out.push(rest);
  return out.join(CRLF);
}

function esc(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function dateStamp(dateStr: string): string {
  return dateStr.replace(/-/g, "");
}

function vevent(uid: string, date: string, summary: string): string[] {
  return [
    "BEGIN:VEVENT",
    fold(`UID:${uid}`),
    `DTSTART;VALUE=DATE:${dateStamp(date)}`,
    fold(`SUMMARY:${esc(summary)}`),
    "END:VEVENT",
  ];
}

export function buildCalendar(contracts: IcalContract[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenRenew//Contract Deadlines//EN",
    "CALSCALE:GREGORIAN",
    fold("X-WR-CALNAME:OpenRenew deadlines"),
  ];
  for (const c of contracts) {
    if (c.expiry_date) {
      lines.push(...vevent(`${c.id}-expiry@openrenew`, c.expiry_date, `${c.name} expires`));
      if (c.notice_period_days != null && c.notice_period_days > 0) {
        const d = new Date(new Date(c.expiry_date + "T00:00:00Z").getTime() - c.notice_period_days * 86_400_000);
        lines.push(...vevent(`${c.id}-notice_deadline@openrenew`, d.toISOString().slice(0, 10), `${c.name} — notice deadline`));
      }
    }
    if (c.renewal_date && c.renewal_date !== c.expiry_date) {
      lines.push(...vevent(`${c.id}-renewal@openrenew`, c.renewal_date, `${c.name} renews`));
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
