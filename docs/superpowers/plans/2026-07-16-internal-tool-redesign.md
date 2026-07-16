# OpenRenew Internal-Tool Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the SaaS-style dashboard with a triage-queue-first internal-tool home screen, add an iCal deadline feed, and finish the Renewl→OpenRenew rename.

**Architecture:** Pure derivation functions (`lib/triage.ts`, `lib/ical.ts`) feed thin server pages and small client components; two nullable columns (`snoozed_until`, `renewal_decision`) added to `contracts`; one token-authenticated public route for the calendar feed. No auth/alert/lifecycle changes.

**Tech Stack:** Next.js 16 (App Router), Drizzle ORM, jest; inline styles, dark theme (`#0A0F1E`/`#111827`/`#10B981`), fonts via `var(--font-jetbrains)`/`var(--font-inter)`; `setTimeout` chains only, never `setInterval`.

**Spec:** `docs/superpowers/specs/2026-07-16-internal-tool-redesign-design.md`
**Working dir:** `~/code/openrenew` (all tasks). Baseline: jest 131/131, pytest 54/54, tsc zero errors — keep green after every task. JSON payloads stay snake_case at API/component boundaries; DB layer is camelCase Drizzle.

---

### Task 1: Rename sweep + SaaS shell strip

**Files:**
- Delete: `components/dashboard/DashboardMetrics.tsx`, `app/opengraph-image.tsx`, `app/twitter-image.tsx`, `app/api/og/` (whole dir), `app/sitemap.ts`, `app/robots.ts`, `docs/renewl_project_handoff.md`, `docs/renewly_build_bible.md`, all `docs/superpowers/plans/2026-03-*` + `2026-04-*`, all `docs/superpowers/specs/2026-03-*` + `2026-04-*`
- Modify: `app/layout.tsx`, `components/dashboard/upload-zone.tsx`, `app/(dashboard)/dashboard/page.tsx`, `python-service/generate_test_contract.py`, `.gitignore`
- Untrack: `.claude/settings.local.json`

- [ ] **Step 1: Delete files** — `git rm` everything in the Delete list. In `app/(dashboard)/dashboard/page.tsx` remove the `DashboardMetrics` import, the `<DashboardMetrics metrics={metrics} />` JSX, and the now-unused parts of `getDashboardMetrics()` — keep ONLY the spend computation, renamed:

```ts
async function getSpendStat() {
  const todayStr = new Date().toISOString().split("T")[0];
  const activeContracts = await db.query.contracts.findMany({
    where: and(
      eq(contracts.status, "active"),
      or(isNull(contracts.expiryDate), gte(contracts.expiryDate, todayStr))
    ),
    columns: { annualValue: true },
  });
  const values = activeContracts
    .map((c) => c.annualValue)
    .filter((v): v is number => v != null && v > 0);
  return { totalSpend: values.reduce((a, b) => a + b, 0), trackedCount: values.length };
}
```

(The result is threaded to the contract table header in Task 6; for now compute it and pass nothing — leave a `const spend = await getSpendStat();` in place with `void spend;` so tsc stays clean, or wire it directly if Task 6's prop already exists. Simplest: leave the function defined but uncalled; eslint allows unused exported? It's local — so call it and pass to ContractsFeed only in Task 6. For THIS task: delete the metrics usage entirely and do NOT keep dead code — re-add the helper in Task 6 instead. Choose that.)

- [ ] **Step 2: `app/layout.tsx`** — remove `keywords`, `openGraph`, `twitter`, `authors` (and any `alternates`/`verification` SEO blocks). Keep `metadataBase`, `title` (default+template), `description`, icons.

- [ ] **Step 3: `components/dashboard/upload-zone.tsx`** — remove the bulk-import sentence and its `mailto:` link entirely. Compact the zone's copy to: primary line "Drop a contract PDF here or click to browse", secondary "· PDF only · max 20MB", keep the "Add contract manually →" link. Do not restyle beyond removing the deleted text's elements (full demotion to a slim strip happens in Task 6).

- [ ] **Step 4: fixtures + untracking** — in `python-service/generate_test_contract.py` replace every `Renewly Ltd`/`Renewl` occurrence with `Meridian Software Ltd`. Add `.claude/settings.local.json` to `.gitignore`; `git rm --cached .claude/settings.local.json`.

- [ ] **Step 5: Verify + commit**

```bash
grep -ri renewl --exclude-dir=node_modules --exclude-dir=.next --exclude=DECISIONS.md \
  --exclude-dir=.git . | grep -v "docs/superpowers/.*2026-07"
# expect: no output
npx tsc --noEmit && npx jest 2>&1 | tail -3   # green (a metrics-related test may need deleting if one exists — check __tests__)
git add -A && git commit -m "Strip SaaS shell and finish OpenRenew rename" && git push
```

### Task 2: Schema migration — snooze + decision columns

**Files:**
- Modify: `lib/db/schema.ts`
- Generated: `drizzle/0001_*.sql`

- [ ] **Step 1:** In `lib/db/schema.ts` `contracts` table, after `contractVersion`, add:

```ts
  snoozedUntil: date("snoozed_until"),
  renewalDecision: text("renewal_decision"),
```

- [ ] **Step 2:** Generate + apply:

```bash
export DATABASE_URL=postgres://openrenew:openrenew@localhost:5432/openrenew
docker compose up -d postgres && npm run db:generate && npm run db:migrate
docker compose exec postgres psql -U openrenew -c '\d contracts' | grep -E "snoozed|renewal_decision"
```

Expected: both columns listed. (If local postgres port is not exposed, temporarily uncomment the ports lines in docker-compose.yml — revert before committing.)

- [ ] **Step 3:** `npx tsc --noEmit` green; commit "Add snoozed_until and renewal_decision columns" + push.

### Task 3: `lib/triage.ts` (TDD)

**Files:**
- Create: `lib/triage.ts`
- Test: `__tests__/lib/triage.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// __tests__/lib/triage.test.ts
import { buildTriageQueue, type TriageContract } from "@/lib/triage";

const TODAY = new Date("2026-07-16T12:00:00Z");

function contract(overrides: Partial<TriageContract>): TriageContract {
  return {
    id: "c1", name: "Acme", party_a: "Acme Inc.", party_b: "Us LLC",
    status: "active", annual_value: 12000,
    expiry_date: null, renewal_date: null, notice_period_days: null,
    snoozed_until: null, renewal_decision: null,
    ...overrides,
  };
}

describe("buildTriageQueue", () => {
  it("prefers the notice deadline over expiry", () => {
    const q = buildTriageQueue(
      [contract({ expiry_date: "2026-08-20", notice_period_days: 30 })], TODAY);
    expect(q).toHaveLength(1);
    expect(q[0].decision_kind).toBe("notice_deadline");
    expect(q[0].decision_date).toBe("2026-07-21");
    expect(q[0].days_left).toBe(5);
    expect(q[0].urgency).toBe("critical");
  });
  it("uses expiry when no notice period", () => {
    const q = buildTriageQueue([contract({ expiry_date: "2026-08-01" })], TODAY);
    expect(q[0].decision_kind).toBe("expiry");
    expect(q[0].days_left).toBe(16);
    expect(q[0].urgency).toBe("warning");
  });
  it("uses renewal date when set and distinct from expiry", () => {
    const q = buildTriageQueue(
      [contract({ expiry_date: "2026-12-01", renewal_date: "2026-08-01" })], TODAY);
    expect(q[0].decision_kind).toBe("renewal");
    expect(q[0].decision_date).toBe("2026-08-01");
  });
  it("excludes contracts more than 30 days out", () => {
    expect(buildTriageQueue([contract({ expiry_date: "2026-08-16" })], TODAY)).toHaveLength(1); // 31d? -> exactly 31 excluded
    expect(buildTriageQueue([contract({ expiry_date: "2026-08-15" })], TODAY)).toHaveLength(1); // 30d included
    expect(buildTriageQueue([contract({ expiry_date: "2026-08-17" })], TODAY)).toHaveLength(0); // 32d excluded
  });
  it("includes overdue and pins most-overdue first", () => {
    const q = buildTriageQueue([
      contract({ id: "a", expiry_date: "2026-07-10" }),
      contract({ id: "b", expiry_date: "2026-07-01" }),
      contract({ id: "c", expiry_date: "2026-07-20" }),
    ], TODAY);
    expect(q.map((i) => i.contract_id)).toEqual(["b", "a", "c"]);
    expect(q[0].urgency).toBe("overdue");
  });
  it("excludes snoozed (today or future) but includes past snoozes", () => {
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", snoozed_until: "2026-07-16" })], TODAY)).toHaveLength(0);
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", snoozed_until: "2026-07-15" })], TODAY)).toHaveLength(1);
  });
  it("excludes decided and non-active and dateless contracts", () => {
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", renewal_decision: "canceling" })], TODAY)).toHaveLength(0);
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", status: "expired" })], TODAY)).toHaveLength(0);
    expect(buildTriageQueue([contract({})], TODAY)).toHaveLength(0);
  });
  it("nextUp returns the nearest future decision point beyond the queue window", () => {
    const { nextUp } = require("@/lib/triage");
    const item = nextUp([contract({ expiry_date: "2026-10-01" })], TODAY);
    expect(item?.decision_date).toBe("2026-10-01");
    expect(item?.days_left).toBe(77);
  });
});
```

NOTE on the 30-day-window test above: compute expected values carefully — days between 2026-07-16 and 2026-08-15 is 30 (included), 2026-08-16 is 31 (**excluded**). Fix the first assertion accordingly: `2026-08-15` → length 1, `2026-08-16` → length 0. Write the test with correct expectations before running.

Run: `npx jest __tests__/lib/triage` — expect FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// lib/triage.ts
// Pure triage-queue derivation — the home screen's "what needs action now?" logic.
export type TriageContract = {
  id: string; name: string;
  party_a: string | null; party_b: string | null;
  status: string; annual_value: number | null;
  expiry_date: string | null; renewal_date: string | null;
  notice_period_days: number | null;
  snoozed_until: string | null; renewal_decision: string | null;
};

export type TriageItem = {
  contract_id: string; name: string;
  party_a: string | null; party_b: string | null;
  annual_value: number | null;
  decision_date: string;
  decision_kind: "notice_deadline" | "expiry" | "renewal";
  days_left: number;
  urgency: "overdue" | "critical" | "warning";
};

const QUEUE_WINDOW_DAYS = 30;
const MS_PER_DAY = 86_400_000;

function utcMidnight(d: Date): number {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c.getTime();
}

function dateMs(dateStr: string): number | null {
  const t = new Date(dateStr + "T00:00:00Z").getTime();
  return Number.isNaN(t) ? null : t;
}

function decisionPoint(c: TriageContract):
  { date: string; kind: TriageItem["decision_kind"] } | null {
  if (c.expiry_date && c.notice_period_days != null && c.notice_period_days > 0) {
    const ms = dateMs(c.expiry_date);
    if (ms != null) {
      const d = new Date(ms - c.notice_period_days * MS_PER_DAY);
      return { date: d.toISOString().slice(0, 10), kind: "notice_deadline" };
    }
  }
  if (c.renewal_date && c.renewal_date !== c.expiry_date && dateMs(c.renewal_date) != null) {
    return { date: c.renewal_date, kind: "renewal" };
  }
  if (c.expiry_date && dateMs(c.expiry_date) != null) {
    return { date: c.expiry_date, kind: "expiry" };
  }
  return null;
}

function toItem(c: TriageContract, today: Date):
  (TriageItem & { _sortMs: number }) | null {
  const point = decisionPoint(c);
  if (!point) return null;
  const pointMs = dateMs(point.date)!;
  const daysLeft = Math.round((pointMs - utcMidnight(today)) / MS_PER_DAY);
  return {
    contract_id: c.id, name: c.name,
    party_a: c.party_a, party_b: c.party_b,
    annual_value: c.annual_value,
    decision_date: point.date, decision_kind: point.kind,
    days_left: daysLeft,
    urgency: daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "critical" : "warning",
    _sortMs: pointMs,
  };
}

function eligible(c: TriageContract, today: Date): boolean {
  if (c.status !== "active") return false;
  if (c.renewal_decision) return false;
  if (c.snoozed_until) {
    const ms = dateMs(c.snoozed_until);
    if (ms != null && ms >= utcMidnight(today)) return false;
  }
  return true;
}

export function buildTriageQueue(contracts: TriageContract[], today: Date = new Date()): TriageItem[] {
  return contracts
    .filter((c) => eligible(c, today))
    .map((c) => toItem(c, today))
    .filter((i): i is TriageItem & { _sortMs: number } => i != null && i.days_left <= QUEUE_WINDOW_DAYS)
    .sort((a, b) => a._sortMs - b._sortMs)
    .map(({ _sortMs, ...item }) => item);
}

/** Nearest decision point beyond the queue (for the empty-state "next up" line). */
export function nextUp(contracts: TriageContract[], today: Date = new Date()): TriageItem | null {
  const future = contracts
    .filter((c) => eligible(c, today))
    .map((c) => toItem(c, today))
    .filter((i): i is TriageItem & { _sortMs: number } => i != null && i.days_left > QUEUE_WINDOW_DAYS)
    .sort((a, b) => a._sortMs - b._sortMs);
  if (!future.length) return null;
  const { _sortMs, ...item } = future[0];
  return item;
}
```

- [ ] **Step 3:** `npx jest __tests__/lib/triage` PASS; `npx tsc --noEmit` green; commit "Add triage queue derivation" + push.

### Task 4: Decision API (TDD)

**Files:**
- Create: `app/api/contracts/[id]/decision/route.ts`
- Test: `__tests__/api/decision.test.ts`

- [ ] **Step 1: Failing tests** — follow the established mock pattern in `__tests__/api/confirm.test.ts` (mock `@/lib/auth/session` and `@/lib/db` keyed on table identity). Cases: 401 unauth; 404 unknown contract; 400 invalid body (`{}`, bad decision string, `snooze_days: 0`); `{decision:"canceling"}` → update called with `{ renewalDecision: "canceling", snoozedUntil: null }`; `{decision:null}` → `{ renewalDecision: null }`; `{snooze_days:7}` → `snoozedUntil` set to today+7 (YYYY-MM-DD); all success responses `{ok:true}`.

- [ ] **Step 2: Implement**

```ts
// app/api/contracts/[id]/decision/route.ts
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
```

- [ ] **Step 3:** tests PASS, tsc green, commit "Add contract decision/snooze API" + push.

### Task 5: Triage queue UI + home rewiring

**Files:**
- Create: `components/dashboard/triage-queue.tsx`
- Modify: `app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: `triage-queue.tsx`** — `"use client"` component, props `{ items: TriageItem[]; next: TriageItem | null; aiFindingsByContract: Record<string, boolean>; aiEnabled: boolean }` (import `TriageItem` type from `@/lib/triage`). Rendering (all inline styles, dark theme, no Tailwind):
  - Non-empty: section heading `NEEDS ACTION` (12px, letter-spacing, `#9CA3AF`, `var(--font-jetbrains)`), then one row per item on `#111827` cards: 3px left border (`#dc2626` overdue, `#f59e0b` critical, `#d97706`→use `#eab308` warning — pick `#dc2626`/`#f59e0b`/`#eab308`), contract name as `<Link href={/dashboard/contracts/${id}}>`, muted `party_a ↔ party_b` line, the sentence (`Notice window closes {formatDate} — {N} days left` / `{N} days overdue`; kind wording: notice_deadline → "Notice window closes", expiry → "Expires", renewal → "Renews"), value chip when `annual_value` (`~$Nk/yr`). Buttons: `Renewing` `Canceling` `Negotiating` `Snooze 7d` — quiet secondary style (transparent bg, `1px solid #374151`, hover border `#10B981`), and when `aiEnabled && aiFindingsByContract[contract_id]` a `Draft email →` link to `/dashboard/contracts/${id}#draft-email`.
  - Actions: `PATCH /api/contracts/${id}/decision` with `{decision}` or `{snooze_days:7}`; disable that row's buttons while pending; on ok `router.refresh()` (import `useRouter` from `next/navigation`). Errors: brief inline red text on the row, re-enable.
  - Empty: card with `Nothing needs action.` (15px, `#9CA3AF`) and, when `next` present, second line `Next up: {name} — {kind sentence} {formatDate(decision_date)} ({days_left} days)`. Date formatting: `toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })` on `date + "T00:00:00Z"`.

- [ ] **Step 2: rewire `app/(dashboard)/dashboard/page.tsx`** — add a query + derivation:

```ts
import { buildTriageQueue, nextUp, type TriageContract } from "@/lib/triage";
import { contractAnalysis } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";

async function getTriageData() {
  const rows = await db.query.contracts.findMany({
    where: eq(contracts.status, "active"),
    columns: {
      id: true, name: true, partyA: true, partyB: true, status: true,
      annualValue: true, expiryDate: true, renewalDate: true,
      noticePeriodDays: true, snoozedUntil: true, renewalDecision: true,
    },
  });
  const mapped: TriageContract[] = rows.map((r) => ({
    id: r.id, name: r.name, party_a: r.partyA, party_b: r.partyB,
    status: r.status, annual_value: r.annualValue,
    expiry_date: r.expiryDate, renewal_date: r.renewalDate,
    notice_period_days: r.noticePeriodDays,
    snoozed_until: r.snoozedUntil, renewal_decision: r.renewalDecision,
  }));
  const items = buildTriageQueue(mapped);
  const next = nextUp(mapped);
  const ids = items.map((i) => i.contract_id);
  const findings = ids.length
    ? await db.query.contractAnalysis.findMany({
        where: inArray(contractAnalysis.contractId, ids),
        columns: { contractId: true },
      })
    : [];
  const aiFindingsByContract = Object.fromEntries(findings.map((f) => [f.contractId, true]));
  return { items, next, aiFindingsByContract };
}
```

Render `<TriageQueue items={items} next={next} aiFindingsByContract={aiFindingsByContract} aiEnabled={aiEnabled()} />` directly below the delivery banner, above everything else. Keep the banner, ContractsFeed, and UploadZone (upload moves in Task 6).

- [ ] **Step 3:** `npx tsc --noEmit` + `npx jest` green; visual check `npm run dev` or rebuilt container; commit "Add triage queue home section" + push.

### Task 6: Home layout order, spend stat, decision badges, horizon timeline

**Files:**
- Create: `components/dashboard/horizon-timeline.tsx`
- Modify: `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/dashboard/contracts-feed.tsx`, `components/dashboard/contract-list.tsx`, `components/dashboard/contract-card.tsx` (row badge), `components/contracts/ContractDetailClient.tsx` (badge + clear control), `components/dashboard/upload-zone.tsx`

- [ ] **Step 1: horizon timeline** — server-renderable component (no client hooks needed) taking `{ entries: Array<{ id: string; name: string; decision_date: string; days_left: number; urgency: "overdue" | "critical" | "warning" }> }`. Page computes entries from the SAME `TriageContract` mapping: run `buildTriageQueue` items PLUS `nextUp`-style future items within 365 days — simplest: export a third helper from `lib/triage.ts` in this task, `horizonEntries(contracts, today, horizonDays = 365)` returning all eligible contracts' decision points with `days_left <= horizonDays`, sorted ascending (reuse `toItem`/`eligible`; add 2-3 jest cases to `__tests__/lib/triage.test.ts` for it: includes queue+future, caps at horizon, sorted). Render: section heading `NEXT 12 MONTHS`; a horizontal band (`position: relative`, height ~`{entries*28}px`, month tick labels along the top computed for the next 12 months); each entry a row with the name label (truncated, 12px mono) and a dot positioned `left: ${(days_left/365)*100}%` colored by urgency (`#dc2626`/`#f59e0b`/`#10B981` for >30d entries — use green for anything beyond 30 days), linking to the contract. Hide the section entirely when `entries.length === 0`.
- [ ] **Step 2: layout order in page.tsx** — banner → TriageQueue → HorizonTimeline → ContractsFeed → UploadZone (moved to bottom, after the feed).
- [ ] **Step 3: spend stat** — add `getSpendStat()` (code in Task 1 Step 1) to page, pass `{ totalSpend, trackedCount }` through `ContractsFeed` → `ContractList` as a `spend` prop; render in the table's header row area (right-aligned, muted 12px): `~$12k/yr tracked across 8 contracts` using the existing `$Nk` formatter in `contract-card.tsx`/`RenewalTimeline.tsx` (reuse, don't duplicate — export it from one place if needed). Hidden when `trackedCount === 0`.
- [ ] **Step 4: decision badges** — `ContractsFeed`'s contract query must now also select `renewalDecision`; thread to `contract-card.tsx` rows: small badge after the name when set — `Renewing` (`#10B981` border/text), `Canceling` (`#dc2626`), `Negotiating` (`#f59e0b`), transparent bg, 10px mono, 2px 6px padding. Same badge on the detail page header in `ContractDetailClient.tsx`, plus a muted `clear` button next to it calling `PATCH /api/contracts/${id}/decision` with `{decision: null}` then refreshing. Detail page's server component must pass `renewalDecision` (and the contract id is already there).
- [ ] **Step 5: upload strip demotion** — in `upload-zone.tsx`, reduce the dropzone's vertical padding to a slim strip (~20px padding, single row: icon + "Drop a contract PDF or click to browse · PDF only · max 20MB" + "Add manually →" right-aligned). Keep ALL existing drag/drop/click/progress/party-confirm behavior untouched — style-only change to the idle state.
- [ ] **Step 6:** jest (incl. new horizon tests) + tsc green; commit "Rework home layout: timeline, spend stat, decision badges" + push.

### Task 7: iCal feed (TDD)

**Files:**
- Create: `lib/ical.ts`, `app/api/calendar/feed.ics/route.ts` (folder literally named `feed.ics`), `app/api/settings/ical-token/route.ts`
- Modify: `app/(dashboard)/dashboard/settings/page.tsx`, `components/dashboard/settings-client.tsx`
- Test: `__tests__/lib/ical.test.ts`, `__tests__/api/ical-feed.test.ts`

- [ ] **Step 1: failing lib tests**

```ts
// __tests__/lib/ical.test.ts
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
  it("skips renewal when equal to expiry, and uses CRLF endings", () => {
    const cal = buildCalendar([c({ expiry_date: "2026-08-29", renewal_date: "2026-08-29" })]);
    expect(cal).not.toContain("abc-renewal@");
    expect(cal.includes("\n") && !cal.replace(/\r\n/g, "").includes("\n")).toBe(true);
  });
  it("folds lines longer than 75 octets", () => {
    const longName = "X".repeat(100);
    const cal = buildCalendar([c({ name: longName, expiry_date: "2026-08-29" })]);
    for (const line of cal.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  });
});
```

Run — FAIL.

- [ ] **Step 2: `lib/ical.ts`**

```ts
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
  let budget = 75;
  while (Buffer.byteLength(rest, "utf8") > budget) {
    let cut = budget;
    while (Buffer.byteLength(rest.slice(0, cut), "utf8") > budget) cut--;
    out.push(rest.slice(0, cut));
    rest = " " + rest.slice(cut);
    budget = 75;
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
```

Run lib tests — PASS.

- [ ] **Step 3: feed route + token route (test-first per `__tests__/api/` patterns)**

```ts
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
```

```ts
// app/api/settings/ical-token/route.ts — regenerate (admin only)
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
```

Feed route tests: 404 when no stored token / wrong token / missing param; 200 + `text/calendar` + `BEGIN:VCALENDAR` with correct token (mock `@/lib/db/settings` + `@/lib/db`).

- [ ] **Step 4: Settings UI** — in `app/(dashboard)/dashboard/settings/page.tsx`: read token via `getSetting<string>("ical_token")`; if absent, generate once server-side (`randomBytes(32).toString("hex")` + `setSetting`) so the URL always exists; pass `icalUrl = \`${process.env.APP_URL}/api/calendar/feed.ics?token=${token}\`` and `isAdmin` to `SettingsClient`. In `settings-client.tsx`, add a "Calendar feed" section below Slack (match existing section styling): explainer line ("Subscribe in Google Calendar or Outlook to see every deadline"), read-only input with the URL, `Copy` button (`navigator.clipboard.writeText`, flips to "Copied" for 2s via setTimeout), and for admins a `Regenerate` button (confirm via inline "This invalidates the old URL — regenerate?" two-step click) calling `POST /api/settings/ical-token`, then updating the shown URL from the response.
- [ ] **Step 5:** all jest + tsc green; commit "Add iCal deadline feed with token auth" + push.

### Task 8: Verification, docs, DECISIONS entry

**Files:**
- Modify: `DECISIONS.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: full gates**

```bash
npx tsc --noEmit && npx jest 2>&1 | tail -3
docker compose up -d --build web && sleep 8 && docker compose ps
```

All green, container healthy.

- [ ] **Step 2: browser smoke (controller does this or verify via curl):** dashboard shows triage queue with the smoke-test contract (its notice deadline is within 30 days), decision buttons work (pick Negotiating → item leaves queue, badge appears on the table row, clear it from the detail page), empty state shows "Next up", Settings shows the feed URL, and `curl -s "$APP_URL/api/calendar/feed.ics?token=<token>" | head -5` returns `BEGIN:VCALENDAR`.

- [ ] **Step 3: docs** — README: add "Calendar feed" bullet under Features and a line in Configuration notes ("iCal feed URL lives in Settings"); replace the dashboard description if it mentions metric cards. CLAUDE.md: note the triage/`lib/triage.ts` + `lib/ical.ts` modules and the two new contract columns. DECISIONS.md: entry `### 025 — Triage-first home screen and iCal feed` (Active, July 2026; context: internal tool ≠ SaaS dashboard; decision: queue+timeline+table home, decision/snooze columns, instance-wide token feed; alternatives: keep metrics dashboard — rejected as SaaS vanity; per-user feeds — rejected, shared workspace; consequences: home screen depends on `lib/triage.ts` rules, feed token is a capability URL). Update the index table.

- [ ] **Step 4:** commit "Docs and DECISIONS entry for triage redesign" + push.

---

## Self-review notes (applied)

- Spec coverage: shell strip + rename (T1), schema (T2), triage lib (T3), decision API (T4), queue UI + empty state (T5), layout order + timeline + spend + badges + upload demotion (T6), ical lib/routes/settings (T7), docs/verification (T8). Error handling covered in T4/T7 route code; testing per task.
- Type consistency: `TriageItem`/`TriageContract`/`buildTriageQueue`/`nextUp`/`horizonEntries` (added T6), `IcalContract`/`buildCalendar`, decision API body shapes — consistent across tasks.
- Judgment delegated: exact inline-style values may adapt to surrounding components; behavior contracts above are fixed.
