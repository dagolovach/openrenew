# OpenRenew Self-Hosted Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Renewl SaaS into OpenRenew — a self-hosted, AGPL-licensed, `docker compose up` contract-renewal tracker with local auth, plain Postgres, disk storage, and Slack/SMTP alerts.

**Architecture:** Keep the two-service shape (Next.js 16 orchestrator + Python FastAPI for PDF/AI) but replace every SaaS dependency: Supabase→Postgres+Drizzle, Supabase Auth→local email/password with signed JWT cookie, Supabase Storage→shared Docker volume, Resend/Vercel cron→Slack webhook + optional SMTP + cron sidecar. Strip Stripe, PostHog, Upstash, marketing pages.

**Tech Stack:** Next.js 16 / React 19, Drizzle ORM + `pg`, `jose` (JWT), `bcryptjs`, `nodemailer`, Python FastAPI + pdfplumber + anthropic SDK, Postgres 16, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-07-15-openrenew-self-hosted-design.md`

**IMPORTANT — working directory:** Task 1 creates `~/code/openrenew`. Every task from Task 2 onward runs inside `~/code/openrenew`, NOT in `~/code/renewl`. The repo will not fully compile between Phases 2–4 (expected during a migration); each task's own tests must pass, and Task 22 restores a fully green build.

**Naming contract (used consistently across all tasks):**
- `db` — Drizzle instance from `lib/db/index.ts`
- Tables in `lib/db/schema.ts`: `users`, `contracts`, `contractExtractions`, `contractAnalysis`, `contractComparisons`, `alerts`, `activityLog`, `appSettings`
- `requireUser()` / `getSessionUser()` from `lib/auth/session.ts`
- `hashPassword()` / `verifyPassword()` from `lib/auth/password.ts`
- `savePdf()` / `pdfAbsolutePath()` from `lib/storage.ts`
- `getSetting()` / `setSetting()` from `lib/db/settings.ts`
- `sendSlackMessage()` from `lib/slack.ts`
- `isSmtpConfigured()` / `sendEmail()` from `lib/email-smtp.ts`
- Session cookie name: `openrenew_session`
- Env vars: `DATABASE_URL`, `SESSION_SECRET`, `EXTRACTION_SERVICE_SECRET`, `CRON_SECRET`, `APP_URL`, `DATA_DIR` (default `/data/contracts`), optional `ANTHROPIC_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `ALERT_RECIPIENTS`, `AUTH_DISABLED`

---

## Phase 0 — Repo bootstrap & SaaS strip

### Task 1: Copy tree, strip excluded files, init fresh repo

**Files:**
- Create: `~/code/openrenew/` (entire tree), `LICENSE`

- [ ] **Step 1: Copy the working tree (no git history)**

```bash
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' \
  --exclude='.env*.local' --exclude='.env' \
  ~/code/renewl/ ~/code/openrenew/
cd ~/code/openrenew
```

- [ ] **Step 2: Delete SaaS-only files**

```bash
rm -rf \
  'app/(marketing)' \
  app/api/stripe app/api/webhooks app/api/waitlist \
  app/auth \
  lib/stripe.ts lib/subscription.ts lib/ratelimit.ts \
  lib/posthog.ts lib/analytics.ts \
  components/PostHogProvider.tsx components/PostHogPageView.tsx \
  python-service/contract_extraction_agent.py \
  __tests__/lib/stripe.test.ts __tests__/lib/subscription.test.ts \
  supabase vercel.json \
  docs/renewly_landing_page_prompt.md
```

Also delete the `/extract-v2/start`, `/extract-v2/resume` endpoints and their request models (`ExtractV2StartRequest`, `ExtractV2ResumeRequest`, `_run_extraction_v2_from_pdf_path`, `_resume_extraction_v2_thread`) from `python-service/main.py`, and any `extract-v2` tests in `python-service/tests/`. Remove `langchain*`, `langgraph`, `langsmith` lines from `python-service/requirements.txt` if present.

- [ ] **Step 3: Rename branding**

```bash
grep -rl --exclude-dir=node_modules --exclude-dir=.next -i 'renewl' \
  app components lib python-service package.json README.md 2>/dev/null
```

Replace user-facing "Renewl"/"Renewly" strings with "OpenRenew" (page titles, email templates in `lib/email.ts`, FastAPI title, `package.json` name → `openrenew`). Change `EMAIL_FROM` in `lib/email.ts:3-4` to `'OpenRenew <alerts@localhost>'` placeholder (Task 19 makes it env-driven). Do NOT bulk-sed blindly — review each hit; internal identifiers like DB names don't matter but user-visible strings do.

- [ ] **Step 4: Add AGPL-3.0 license**

Download the canonical text into `LICENSE`:

```bash
curl -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
```

Set `"license": "AGPL-3.0-only"` in `package.json`.

- [ ] **Step 5: Init repo and push**

```bash
git init -b main
git add -A
git commit -m "Initial import of OpenRenew (from Renewl, SaaS code stripped)"
git remote add origin git@github.com:dagolovach/openrenew.git
git push -u origin main
```

### Task 2: Remove PostHog/Stripe/ratelimit references from surviving code

**Files:**
- Modify: `app/api/upload/route.ts`, `app/api/confirm/route.ts`, `app/api/cron/send-alerts/route.ts`, `app/api/cron/send-weekly-digest/route.ts`, `app/layout.tsx`, `next.config.ts`, `package.json`, any other file `grep` finds

- [ ] **Step 1: Find all dangling references**

```bash
grep -rn --exclude-dir=node_modules "posthog\|PostHog\|stripe\|Stripe\|ratelimit\|uploadLimiter\|waitlist\|getUserTier" app components lib __tests__
```

- [ ] **Step 2: Remove them**

For each hit: delete the import, the `posthogClient.capture/identify` + `shutdownPosthog` blocks, the `uploadLimiter.limit` check (and its 429 response), tier-gating branches (treat every install as unlimited — delete the free-tier 20-contract check in `app/api/upload/route.ts:23-48` entirely), and Stripe/PostHog bits in `app/layout.tsx` and `next.config.ts` (drop the PostHog `rewrites()` block and remove Stripe/PostHog/Supabase/Google hosts from the CSP — keep `https://api.anthropic.com` in `connect-src` only if the browser ever calls it directly; it doesn't, so the CSP `connect-src` becomes `'self'`).

- [ ] **Step 3: Remove dropped dependencies**

```bash
npm uninstall stripe posthog-js posthog-node @upstash/ratelimit @upstash/redis resend
npm install
```

(`resend` is replaced by nodemailer in Task 19; the email *templates* in `lib/email.ts` stay.)

- [ ] **Step 4: Verify no references remain and commit**

```bash
grep -rn --exclude-dir=node_modules "posthog\|stripe\|upstash\|resend" app components lib | grep -v "email.ts"
```

Expected: no output (template comments in `lib/email.ts` are fine).

```bash
git add -A && git commit -m "Strip Stripe, PostHog, Upstash, tiers, waitlist"
```

---

## Phase 1 — Data layer (Postgres + Drizzle)

### Task 3: Postgres via docker-compose + env scaffolding

**Files:**
- Create: `docker-compose.yml` (minimal version — extended in Task 21), `.env.example`
- Modify: `.gitignore` (ensure `.env` ignored)

- [ ] **Step 1: Write minimal compose file**

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: openrenew
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openrenew}
      POSTGRES_DB: openrenew
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openrenew"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  pgdata:
```

- [ ] **Step 2: Write `.env.example`**

```bash
# ── Required ─────────────────────────────────────────
POSTGRES_PASSWORD=change-me
DATABASE_URL=postgres://openrenew:change-me@localhost:5432/openrenew
SESSION_SECRET=            # openssl rand -hex 32
EXTRACTION_SERVICE_SECRET= # openssl rand -hex 32
CRON_SECRET=               # openssl rand -hex 32
APP_URL=http://localhost:3000

# ── Optional: AI features ────────────────────────────
ANTHROPIC_API_KEY=

# ── Optional: email alerts (Slack is configured in-app) ──
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="OpenRenew <alerts@example.com>"
ALERT_RECIPIENTS=          # comma-separated emails

# ── Dev only ─────────────────────────────────────────
AUTH_DISABLED=false        # true = no login (localhost POC ONLY)
DATA_DIR=./data/contracts  # in Docker this is /data/contracts
```

- [ ] **Step 3: Verify Postgres starts, commit**

```bash
docker compose up -d postgres
docker compose ps   # expect postgres healthy
git add -A && git commit -m "Add postgres compose service and env scaffolding"
```

### Task 4: Drizzle schema, client, migrations

**Files:**
- Create: `lib/db/schema.ts`, `lib/db/index.ts`, `lib/db/settings.ts`, `drizzle.config.ts`, `drizzle/` (generated)
- Modify: `package.json` (scripts), `jest.config.ts` if needed

- [ ] **Step 1: Install dependencies**

```bash
npm install drizzle-orm pg && npm install -D drizzle-kit @types/pg
```

- [ ] **Step 2: Write the schema**

```ts
// lib/db/schema.ts
import {
  pgTable, uuid, text, boolean, integer, real, timestamp, date, jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("party_review"),
  extractionStatus: text("extraction_status").notNull().default("pending"),
  extractionConfidence: real("extraction_confidence"),
  filePath: text("file_path"),
  fileName: text("file_name"),
  fileSizeBytes: integer("file_size_bytes"),
  partyA: text("party_a"),
  partyB: text("party_b"),
  effectiveDate: date("effective_date"),
  expiryDate: date("expiry_date"),
  renewalDate: date("renewal_date"),
  autoRenew: boolean("auto_renew"),
  noticePeriodDays: integer("notice_period_days"),
  noticePeriodText: text("notice_period_text"),
  contractValue: text("contract_value"),
  annualValue: real("annual_value"),
  parentContractId: uuid("parent_contract_id"),
  contractVersion: integer("contract_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contractExtractions = pgTable("contract_extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  fieldName: text("field_name").notNull(),
  extractedValue: text("extracted_value"),
  confirmedValue: text("confirmed_value"),
  confidence: real("confidence"),
  wasEdited: boolean("was_edited").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("extractions_contract_field").on(t.contractId, t.fieldName)]);

export const contractAnalysis = pgTable("contract_analysis", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by"),
  findings: jsonb("findings").notNull().default([]),
  model: text("model").notNull().default(""),
  analysisVersion: integer("analysis_version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("analysis_contract_version").on(t.contractId, t.analysisVersion)]);

export const contractComparisons = pgTable("contract_comparisons", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull().unique()
    .references(() => contracts.id, { onDelete: "cascade" }),
  parentContractId: uuid("parent_contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  createdBy: uuid("created_by"),
  fieldChanges: jsonb("field_changes").notNull().default([]),
  clauseChanges: jsonb("clause_changes").notNull().default([]),
  summary: text("summary"),
  model: text("model").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: uuid("contract_id").notNull()
    .references(() => contracts.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  scheduledFor: date("scheduled_for").notNull(),
  targetDate: date("target_date").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("alerts_contract_type_target").on(t.contractId, t.alertType, t.targetDate)]);

export const activityLog = pgTable("activity_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id"),
  contractId: uuid("contract_id"),
  eventType: text("event_type").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

Notes: no `profiles`/`waitlist` tables; `user_id` is now `created_by` (nullable) everywhere except `activity_log.userId`; `alerts` has no user column (delivery is instance-level).

- [ ] **Step 3: Write the client and settings helper**

```ts
// lib/db/index.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });
export * as tables from "./schema";
```

```ts
// lib/db/settings.ts
import { eq } from "drizzle-orm";
import { db } from "./index";
import { appSettings } from "./schema";

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.key, key) });
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
```

- [ ] **Step 4: Drizzle config + migration generation**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Add to `package.json` scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`.

```bash
export DATABASE_URL=postgres://openrenew:change-me@localhost:5432/openrenew
npm run db:generate && npm run db:migrate
```

Expected: one migration SQL file in `drizzle/`, applied cleanly.

- [ ] **Step 5: Verify tables exist, commit**

```bash
docker compose exec postgres psql -U openrenew -c '\dt'
```

Expected: 8 tables. Then:

```bash
git add -A && git commit -m "Add Drizzle schema, client, and initial migration"
```

### Task 5: Drop `user_id` from alert generation

**Files:**
- Modify: `lib/alerts.ts`, `__tests__/lib/alerts.test.ts`

- [ ] **Step 1: Update the failing tests first** — in `__tests__/lib/alerts.test.ts`, remove `user_id` from every `buildAlerts()` input object and every expected `AlertRow`. Run `npx jest __tests__/lib/alerts` — expect FAIL (type errors / mismatched objects).

- [ ] **Step 2: Update `lib/alerts.ts`** — remove `user_id` from `AlertRow` and `ContractDateData` types, the `tierAlerts()` signature/output, and the `buildAlerts()` destructure and both push sites. Field names stay snake_case (`contract_id`, `alert_type`, `scheduled_for`, `target_date`, `status`) — the cron/confirm routes map them to Drizzle camelCase at the insert site.

- [ ] **Step 3: Run and commit**

```bash
npx jest __tests__/lib/alerts   # expect PASS
git add -A && git commit -m "Remove user_id from alert generation"
```

---

## Phase 2 — Local auth

### Task 6: Password hashing

**Files:**
- Create: `lib/auth/password.ts`, `__tests__/lib/password.test.ts`

- [ ] **Step 1: Install** `npm install bcryptjs && npm install -D @types/bcryptjs`

- [ ] **Step 2: Write failing test**

```ts
// __tests__/lib/password.test.ts
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("produces unique salted hashes", async () => {
    expect(await hashPassword("x")).not.toEqual(await hashPassword("x"));
  });
});
```

Run: `npx jest __tests__/lib/password` — expect FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// lib/auth/password.ts
import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 4: Run test (PASS), commit** `git add -A && git commit -m "Add bcrypt password helpers"`

### Task 7: Session tokens + server-side user lookup

**Files:**
- Create: `lib/auth/session.ts`, `__tests__/lib/session.test.ts`

- [ ] **Step 1: Install** `npm install jose`

- [ ] **Step 2: Write failing test for the pure token functions**

```ts
// __tests__/lib/session.test.ts
import { signSessionToken, verifySessionToken } from "@/lib/auth/session";

describe("session tokens", () => {
  beforeAll(() => { process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!"; });

  it("round-trips a user id", async () => {
    const token = await signSessionToken("11111111-1111-1111-1111-111111111111");
    expect(await verifySessionToken(token)).toBe("11111111-1111-1111-1111-111111111111");
  });
  it("rejects a tampered token", async () => {
    const token = await signSessionToken("11111111-1111-1111-1111-111111111111");
    expect(await verifySessionToken(token + "x")).toBeNull();
  });
  it("rejects garbage", async () => {
    expect(await verifySessionToken("not-a-token")).toBeNull();
  });
});
```

Run: `npx jest __tests__/lib/session` — expect FAIL.

- [ ] **Step 3: Implement**

```ts
// lib/auth/session.ts
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

/** For API routes: returns the user or a thrown 401-style null-check convenience. */
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
```

- [ ] **Step 4: Run test (PASS), commit** `git add -A && git commit -m "Add JWT session helpers"`

### Task 8: Auth API routes (setup, login, logout, add-user)

**Files:**
- Create: `app/api/auth/setup/route.ts`, `app/api/auth/login/route.ts`, `app/api/auth/logout/route.ts`, `app/api/auth/users/route.ts`

- [ ] **Step 1: Setup route (first-run admin creation)**

```ts
// app/api/auth/setup/route.ts
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
```

- [ ] **Step 2: Login route**

```ts
// app/api/auth/login/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { signSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const user = await db.query.users.findFirst({
    where: eq(users.email, parsed.data.email.toLowerCase()),
  });
  // Same error for unknown email and wrong password — no user enumeration
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await signSessionToken(user.id), sessionCookieOptions());
  return res;
}
```

- [ ] **Step 3: Logout + admin add-user routes**

```ts
// app/api/auth/logout/route.ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
```

```ts
// app/api/auth/users/route.ts
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
```

- [ ] **Step 4: Commit** `git add -A && git commit -m "Add auth API routes: setup, login, logout, users"`

### Task 9: Setup + login pages, logout button

**Files:**
- Create: `app/(auth)/setup/page.tsx`
- Modify: `app/(auth)/login/page.tsx` (full rewrite), `components/dashboard/logout-button.tsx`

- [ ] **Step 1: Rewrite login page.** Replace the Supabase OAuth/magic-link UI with an email+password form, keeping the existing visual style (inline style objects, dark theme `#0A0F1E`/`#111827`/`#10B981`, `var(--font-jetbrains)` / `var(--font-inter)` — copy style objects from the current page). Behavior: client component; on submit `POST /api/auth/login`; on 200 `router.push("/dashboard")`; on 401 show "Invalid email or password." The page is a server component wrapper that first checks `db.query.users.findFirst()` — if no users exist, `redirect("/setup")`.

- [ ] **Step 2: Create setup page.** Same visual language. Fields: email, password, confirm password (client-side match check). Submits to `POST /api/auth/setup`; on 200 `router.push("/dashboard")`; on 409 redirect to `/login`. Heading: "Create your admin account"; sub-text: "This is a one-time setup for this OpenRenew instance."

- [ ] **Step 3: Rewrite logout button** — replace the Supabase `signOut()` call with `await fetch("/api/auth/logout", { method: "POST" }); window.location.href = "/login";`. Keep existing styling.

- [ ] **Step 4: Verify manually later (Task 22 smoke test); commit** `git add -A && git commit -m "Add setup/login pages and logout for local auth"`

### Task 10: Middleware rewrite

**Files:**
- Modify: `proxy.ts` (full rewrite)
- Delete: `lib/supabase/middleware.ts` reference (file deleted in Task 18)
- Modify: `__tests__/middleware.test.ts`

- [ ] **Step 1: Rewrite `proxy.ts`**

```ts
// proxy.ts
import { type NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "openrenew_session";
const PUBLIC_PATHS = ["/login", "/setup"];

async function verifiedUserId(request: NextRequest): Promise<string | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET!);
    const { payload } = await jwtVerify(token, secret);
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.AUTH_DISABLED === "true") {
    if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  const userId = await verifiedUserId(request);

  if (pathname === "/") {
    return NextResponse.redirect(new URL(userId ? "/dashboard" : "/login", request.url));
  }
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    if (userId) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }
  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

Note: middleware does NOT hit the DB (edge-safe) — it only verifies the JWT. API routes do their own `requireUser()`. The `/setup`-when-no-users redirect lives in the login page (Task 9), not here.

- [ ] **Step 2: Update `__tests__/middleware.test.ts`** — rewrite cases: unauthenticated `/dashboard` → redirect `/login`; valid-cookie `/login` → redirect `/dashboard`; `/` → login or dashboard based on cookie; `AUTH_DISABLED=true` passes through. Sign test tokens with `signSessionToken` from Task 7 (set `SESSION_SECRET` in the test).

- [ ] **Step 3: Run and commit**

```bash
npx jest __tests__/middleware   # expect PASS
git add -A && git commit -m "Replace Supabase middleware with JWT session middleware"
```

---

## Phase 3 — Storage + Python file-path mode

### Task 11: Disk storage helper + PDF-serving route

**Files:**
- Create: `lib/storage.ts`, `__tests__/lib/storage.test.ts`, `app/api/contracts/[id]/pdf/route.ts`

- [ ] **Step 1: Write failing tests**

```ts
// __tests__/lib/storage.test.ts
import { pdfAbsolutePath } from "@/lib/storage";
import path from "path";

describe("pdfAbsolutePath", () => {
  beforeAll(() => { process.env.DATA_DIR = "/data/contracts"; });

  it("resolves a relative path under DATA_DIR", () => {
    expect(pdfAbsolutePath("user1/c1/original.pdf"))
      .toBe(path.join("/data/contracts", "user1/c1/original.pdf"));
  });
  it("rejects path traversal", () => {
    expect(() => pdfAbsolutePath("../../etc/passwd")).toThrow();
    expect(() => pdfAbsolutePath("/etc/passwd")).toThrow();
  });
});
```

Run: `npx jest __tests__/lib/storage` — expect FAIL.

- [ ] **Step 2: Implement**

```ts
// lib/storage.ts
import { promises as fs } from "fs";
import path from "path";

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "/data/contracts");
}

/** Resolve a stored relative file_path to an absolute path, refusing traversal. */
export function pdfAbsolutePath(relPath: string): string {
  const abs = path.resolve(dataDir(), relPath);
  if (!abs.startsWith(dataDir() + path.sep)) {
    throw new Error(`Path escapes DATA_DIR: ${relPath}`);
  }
  return abs;
}

export async function savePdf(relPath: string, bytes: ArrayBuffer | Buffer): Promise<void> {
  const abs = pdfAbsolutePath(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, Buffer.from(bytes as ArrayBuffer));
}

export async function readPdf(relPath: string): Promise<Buffer> {
  return fs.readFile(pdfAbsolutePath(relPath));
}
```

- [ ] **Step 3: PDF route (replaces signed URLs for the review-screen iframe)**

```ts
// app/api/contracts/[id]/pdf/route.ts
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
        // Allow same-origin iframe embedding for this route only
        "X-Frame-Options": "SAMEORIGIN",
      },
    });
  } catch {
    return NextResponse.json({ error: "file_missing" }, { status: 404 });
  }
}
```

Note: `next.config.ts` sets a global `X-Frame-Options: DENY`; add an override for this exact path in `headers()` (`source: "/api/contracts/:id/pdf"`, value `SAMEORIGIN`) — Next.js applies the most specific match last, verify the response header in Task 22.

- [ ] **Step 4: Run tests, commit**

```bash
npx jest __tests__/lib/storage   # expect PASS
git add -A && git commit -m "Add disk storage helper and PDF serving route"
```

### Task 12: Python service — accept file paths

**Files:**
- Modify: `python-service/main.py`
- Test: `python-service/tests/test_main.py`

- [ ] **Step 1: Write failing tests** (add to `python-service/tests/test_main.py`, following its existing fixture/style — it uses FastAPI `TestClient` with auth headers from `conftest.py`):

```python
def test_validate_file_path_rejects_traversal():
    from main import validate_file_path
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        validate_file_path("../../etc/passwd")
    with pytest.raises(HTTPException):
        validate_file_path("/etc/passwd")

def test_validate_file_path_accepts_relative(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib, main
    importlib.reload(main)
    p = main.validate_file_path("user1/c1/original.pdf")
    assert str(p).startswith(str(tmp_path))
```

Run: `cd python-service && pytest tests/ -k file_path -v` — expect FAIL.

- [ ] **Step 2: Implement in `main.py`.** Add near `validate_file_url`:

```python
import pathlib

DATA_DIR = pathlib.Path(os.getenv("DATA_DIR", "/data/contracts")).resolve()

def validate_file_path(rel_path: str) -> pathlib.Path:
    """Resolve a relative contract path inside DATA_DIR; reject traversal/absolute paths."""
    if not rel_path or rel_path.startswith(("/", "\\")):
        raise HTTPException(status_code=422, detail="file_path must be relative")
    abs_path = (DATA_DIR / rel_path).resolve()
    if not str(abs_path).startswith(str(DATA_DIR) + os.sep):
        raise HTTPException(status_code=422, detail="file_path escapes data directory")
    return abs_path

async def load_pdf_bytes(file_url: Optional[str], file_path: Optional[str]) -> bytes:
    """Load PDF from a local path (preferred, self-hosted) or an allowlisted URL."""
    if file_path:
        abs_path = validate_file_path(file_path)
        try:
            return await asyncio.to_thread(abs_path.read_bytes)
        except FileNotFoundError:
            raise ExtractionError(422, "file_not_found", file_path)
    if not file_url:
        raise ExtractionError(422, "missing_input", "file_url or file_path is required")
    validate_file_url(file_url)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.get(file_url)
            r.raise_for_status()
            return r.content
    except ExtractionError:
        raise
    except Exception as e:
        raise ExtractionError(422, "file_download_failed", str(e))
```

Then: add `file_path: Optional[str] = None` to `ExtractRequest`, `DetectPartiesRequest`, `AnalyseRequest`; make `file_url` optional (`Optional[str] = None`) on all three; add `current_file_path`/`previous_file_path` to `CompareRequest`. Replace each endpoint's inline download block (`/extract`, `/detect-parties`, `/analyse`, and both fetches inside `/compare`) with `pdf_bytes = await load_pdf_bytes(req.file_url, req.file_path)` (compare uses its respective pair). Also relax `validate_file_url`'s allowlist failure: when `SUPABASE_STORAGE_DOMAIN` is unset AND a URL is used, keep failing closed (unchanged) — self-hosted installs use paths.

- [ ] **Step 3: Run the full Python suite**

```bash
cd python-service && pytest tests/ -v
```

Expected: all PASS (existing URL-mode tests must still pass).

- [ ] **Step 4: Commit** `git add -A && git commit -m "Python service: accept local file paths alongside URLs"`

---

## Phase 4 — Route & page migration (Supabase → Drizzle/local)

**Conversion rules used by every task in this phase:**
1. `const sessionClient = await createClient(); ...auth.getUser()` → `const user = await requireUser(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`
2. Admin client (`createAdminClient(...)`) → just `db` (no RLS to bypass).
3. `.from("x").select(...).eq(...)` → `db.query.x.findFirst/findMany({ where: eq(...) })`; `.insert` → `db.insert(tables.x).values({...})`; `.update` → `db.update(tables.x).set({...}).where(...)`; `.upsert` → `.onConflictDoUpdate` / `.onConflictDoNothing`.
4. Column names: snake_case → the camelCase names from `lib/db/schema.ts` (e.g. `user_id`→`createdBy`, `file_path`→`filePath`, `notice_period_days`→`noticePeriodDays`). JSON payloads to/from the *frontend and Python service keep their existing snake_case shapes* — map at the DB boundary only, so client components and Python contracts don't change.
5. Workspace scoping: DELETE all `.eq("user_id", user.id)` filters — every user sees all contracts. `created_by: user.id` is set on INSERT only.
6. Signed URL generation (`createSignedUrl`) → pass `file_path: contract.filePath` (the relative path) to the Python service instead of `file_url`.
7. Storage upload/download → `savePdf()` / `readPdf()` from `lib/storage.ts`.
8. `maxDuration` exports: delete (no Vercel). `after()` from `next/server` stays — it works self-hosted.

### Task 13: Migrate `/api/upload`

**Files:**
- Modify: `app/api/upload/route.ts` (full rewrite)

- [ ] **Step 1: Rewrite the route**

```ts
// app/api/upload/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contracts } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth/session";
import { savePdf } from "@/lib/storage";

export const dynamic = "force-dynamic";
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://localhost:8001";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
  if (file.type !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 413 });
  }

  const parentContractId = formData.get("parent_contract_id") as string | null;
  const contractId = randomUUID();
  const filePath = `${contractId}/original.pdf`;
  const fileName = file.name;

  try {
    await savePdf(filePath, await file.arrayBuffer());
  } catch (e) {
    console.error("Storage write error:", e);
    return NextResponse.json({ error: "File upload failed" }, { status: 500 });
  }

  let contractName = fileName.replace(/\.pdf$/i, "");
  let contractVersion = 1;
  if (parentContractId) {
    const parent = await db.query.contracts.findFirst({
      where: eq(contracts.id, parentContractId),
    });
    if (parent) {
      contractVersion = (parent.contractVersion ?? 1) + 1;
      const baseName = (parent.name ?? "Contract").replace(/\s*\(v\d+\)\s*$/i, "").trim();
      contractName = `${baseName} (v${contractVersion})`;
    }
  }

  try {
    await db.insert(contracts).values({
      id: contractId,
      createdBy: user.id,
      name: contractName,
      category: "other",
      status: "party_review",
      extractionStatus: "pending",
      filePath,
      fileName,
      fileSizeBytes: file.size,
      parentContractId: parentContractId || null,
      contractVersion,
    });
  } catch (e) {
    console.error("DB insert error:", e);
    return NextResponse.json({ error: "Failed to create contract record" }, { status: 500 });
  }

  // Party detection — requires ANTHROPIC_API_KEY; non-blocking either way
  let detectedParties: { party_a: string | null; party_b: string | null; confidence: number } = {
    party_a: null, party_b: null, confidence: 0,
  };
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const detectRes = await fetch(`${PYTHON_SERVICE_URL}/detect-parties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.EXTRACTION_SERVICE_SECRET}`,
        },
        body: JSON.stringify({ file_path: filePath }),
        signal: AbortSignal.timeout(15000),
      });
      if (detectRes.ok) detectedParties = await detectRes.json();
    } catch (e) {
      console.error("[upload] Party detection failed (non-blocking):", e);
    }
  }

  return NextResponse.json({ contract_id: contractId, detected_parties: detectedParties, contracts_remaining: null });
}
```

Note: file path no longer includes the user id (shared workspace); `contracts_remaining` stays in the response shape as `null` so the upload zone component doesn't break before its own cleanup.

- [ ] **Step 2: Verify it typechecks** — `npx tsc --noEmit 2>&1 | grep upload` — expect no upload-route errors. Commit: `git add -A && git commit -m "Migrate upload route to Drizzle + disk storage"`

### Task 14: Migrate `/api/extract` and `/api/confirm`

**Files:**
- Modify: `app/api/extract/route.ts`, `app/api/confirm/route.ts`, `__tests__/confirm-notice-period.test.ts`

- [ ] **Step 1: `/api/extract`** — apply the conversion rules. Specifics: auth via `requireUser()`; load the contract with `db.query.contracts.findFirst({ where: eq(contracts.id, contract_id) })`; call Python with `body: JSON.stringify({ file_path: contract.filePath, contract_id, party_a, party_b })` instead of a signed URL; write extraction results with `db.insert(tables.contractExtractions).values(rows).onConflictDoUpdate({ target: [contractExtractions.contractId, contractExtractions.fieldName], set: { extractedValue: sql\`excluded.extracted_value\` } })`; status updates via `db.update(contracts).set({ extractionStatus: ... }).where(eq(contracts.id, contract_id))`.

- [ ] **Step 2: `/api/confirm`** — apply the conversion rules to the flow you can read in the current file (it was fully quoted in this plan's source conversation; the file is in the repo). Keep the exact business logic: field upsert, `annual_value` computation with the ÷years fallback, contract update (status `analyzing` when `filePath` present, else `active`), `buildAlerts` (now without `user_id` — map result rows to Drizzle insert values `{ contractId: r.contract_id, alertType: r.alert_type, scheduledFor: r.scheduled_for, targetDate: r.target_date, status: r.status }`) with `.onConflictDoNothing()`, activity-log inserts (use `userId: user.id`), `validateDateOrder` warning logging, `after(() => triggerAnalysis(...))`, and the parent-contract renewed/skip-alerts block. Delete `export const maxDuration = 60` and the PostHog block (already gone from Task 2).

- [ ] **Step 3: Update `__tests__/confirm-notice-period.test.ts`** to mock `@/lib/db` and `@/lib/auth/session` instead of Supabase clients; assert the same notice-deadline behavior.

- [ ] **Step 4: Run and commit**

```bash
npx jest __tests__/confirm-notice-period   # expect PASS
git add -A && git commit -m "Migrate extract and confirm routes to Drizzle"
```

### Task 15: Migrate analysis + comparison libs and their routes

**Files:**
- Modify: `lib/analysis.ts`, `lib/comparison.ts`, `app/api/analyse/route.ts`, `app/api/compare/route.ts`, `app/api/extract-comparison/route.ts`, `app/api/finding-action/route.ts`, `app/api/contracts/[id]/route.ts`

- [ ] **Step 1: `lib/analysis.ts`** — replace the admin client with `db`. `triggerAnalysis(contractId, userId)` keeps its signature. Idempotency query → `db.query.contractAnalysis.findFirst({ where: eq(...), orderBy: desc(contractAnalysis.analysisVersion) })`. Signed URL step → deleted; send `file_path: contract.filePath` to Python `/analyse`. Persist with `db.insert(contractAnalysis).values({ contractId, createdBy: userId, findings, model: modelUsed, analysisVersion: nextVersion }).onConflictDoNothing()` (the unique index gives the same 23505-tolerant behavior).

- [ ] **Step 2: `lib/comparison.ts` + comparison/finding routes** — same rules: `db` queries, `file_path`/`current_file_path`/`previous_file_path` to Python, `contractComparisons` upsert on `contractId` unique. `app/api/finding-action/route.ts` calls Python `/draft-action-email` (no file involved) — only its auth + contract lookup changes.

- [ ] **Step 3: `/api/analyse` GET/POST** — `requireUser()`, `db.query.contractAnalysis.findFirst({ where: eq(contractAnalysis.contractId, contractId), orderBy: desc(contractAnalysis.analysisVersion) })`; response shapes unchanged (snake_case JSON out: `findings`, `analysis_version`, `created_at` — map from camelCase row).

- [ ] **Step 4: `/api/contracts/[id]`** — auth + `db` conversion; DELETE also removes the PDF file via `fs.rm` on `pdfAbsolutePath(contract.filePath)` wrapped in try/catch (best-effort).

- [ ] **Step 5: Typecheck the migrated files, commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "analyse|analysis|compar|finding|contracts" ; git add -A && git commit -m "Migrate analysis and comparison to Drizzle + file paths"
```

### Task 16: Migrate dashboard/review/detail pages and client components

**Files:**
- Modify: `app/(dashboard)/layout.tsx`, `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/dashboard/contracts-feed.tsx`, `app/(dashboard)/dashboard/contracts/[id]/page.tsx`, `app/(dashboard)/dashboard/review/[id]/page.tsx`, `app/(dashboard)/dashboard/review/new/page.tsx`, `app/(dashboard)/dashboard/calendar/page.tsx`, `app/(dashboard)/dashboard/settings/page.tsx`, `components/dashboard/contract-list.tsx`, `components/dashboard/DashboardMetrics.tsx`

- [ ] **Step 1: Server components/pages** — replace `createClient()` + `auth.getUser()` with `getSessionUser()` (redirect to `/login` if null) and Supabase queries with `db.query.*` per the conversion rules (drop all `user_id` scoping). Review pages: replace signed-URL PDF iframe src with `/api/contracts/${id}/pdf`.

- [ ] **Step 2: Client components** (`contract-list.tsx`, `DashboardMetrics.tsx`) — these import the *browser* Supabase client. Convert each to receive its data as props from the server component that renders it (preferred; the queries move up into the page), or fetch from an existing API route. No direct DB access from client components. Preserve the `React.memo` comparators and `setTimeout`-chain polling (Decision 020) exactly as they are.

- [ ] **Step 3: Build to catch stragglers**

```bash
npx tsc --noEmit
```

Fix any remaining Supabase imports this surfaces in dashboard code. Expected at the end of this step: the only remaining Supabase references in the repo are `lib/supabase/*`, cron routes, and `app/api/settings/slack` (migrated next).

- [ ] **Step 4: Commit** `git add -A && git commit -m "Migrate dashboard pages and components to Drizzle"`

---

## Phase 5 — Alert delivery (Slack + SMTP + cron)

### Task 17: Slack helper + instance settings route

**Files:**
- Create: `lib/slack.ts`, `__tests__/lib/slack.test.ts`
- Modify: `app/api/settings/slack/route.ts`, `app/(dashboard)/dashboard/settings/page.tsx`

- [ ] **Step 1: Failing test**

```ts
// __tests__/lib/slack.test.ts
import { sendSlackMessage } from "@/lib/slack";

describe("sendSlackMessage", () => {
  beforeEach(() => { global.fetch = jest.fn(); });

  it("posts text to the webhook", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const ok = await sendSlackMessage("https://hooks.slack.com/services/T/B/x", "hello");
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/x",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "hello" }) })
    );
  });
  it("returns false on non-2xx", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
    expect(await sendSlackMessage("https://hooks.slack.com/services/T/B/x", "hi")).toBe(false);
  });
});
```

Run: `npx jest __tests__/lib/slack` — expect FAIL.

- [ ] **Step 2: Implement**

```ts
// lib/slack.ts
export async function sendSlackMessage(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Rework the settings route** — `app/api/settings/slack/route.ts` keeps its existing validation (hostname `hooks.slack.com`, https, live test-post — change the test message text to "✓ OpenRenew is connected to this Slack channel.") but persists via `setSetting("slack_webhook_url", value)` instead of the `profiles` table, and auth via `requireUser()`. The settings page's Slack section reads it via `getSetting<string>("slack_webhook_url")`.

- [ ] **Step 4: Run tests, commit** `npx jest __tests__/lib/slack && git add -A && git commit -m "Add Slack webhook helper and instance-level setting"`

### Task 18: SMTP helper, cron route rewrite, dashboard fallback banner

**Files:**
- Create: `lib/email-smtp.ts`
- Modify: `lib/email.ts` (from/reply-to become env-driven), `app/api/cron/send-alerts/route.ts`, `app/api/cron/send-weekly-digest/route.ts`, `__tests__/cron-pagination.test.ts`, `app/(dashboard)/dashboard/page.tsx`
- Delete: `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/middleware.ts`, `lib/supabase/user-from-header.ts`, `lib/types/database.ts`

- [ ] **Step 1: SMTP helper**

```bash
npm install nodemailer && npm install -D @types/nodemailer
```

```ts
// lib/email-smtp.ts
import nodemailer from "nodemailer";

export function isSmtpConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function alertRecipients(): string[] {
  return (process.env.ALERT_RECIPIENTS ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT ?? "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transporter.sendMail({ from: process.env.SMTP_FROM, ...opts });
}
```

In `lib/email.ts`, change `EMAIL_FROM`/`EMAIL_REPLY_TO` to read from `process.env.SMTP_FROM` with the old values as comments removed; drop `user_plan`-dependent template branches if any reference tiers.

- [ ] **Step 2: Rewrite `/api/cron/send-alerts`.** Keep: `CRON_SECRET` timing-safe guard, mark-expired-contracts block, pagination loop (PAGE_SIZE 100, MAX 500), per-alert failure handling, activity-log summary. Change:
  - Query: `db.select(...).from(alerts).innerJoin(contracts, eq(alerts.contractId, contracts.id)).where(and(lte(alerts.scheduledFor, today), eq(alerts.status, "pending"))).orderBy(asc(alerts.scheduledFor)).limit(PAGE_SIZE)` — no profiles join.
  - Delivery: read `slackWebhook = await getSetting<string>("slack_webhook_url")` and `recipients = alertRecipients()` once per run. For each alert: build a plain-text Slack line (e.g. `⏰ *${name}* — ${alertLabel(alert_type)} on ${target_date}${auto_renew ? " (auto-renews!)" : ""} · ${APP_URL}/dashboard/contracts/${contract_id}`) and send via `sendSlackMessage`; if SMTP configured, send `buildAlertEmail(alert)` to every recipient via `sendEmail`. An alert is `sent` if at least one channel succeeded; `failed` (with reason) if all configured channels failed; **left `pending` if no channel is configured** (the dashboard banner shows it).
  - Remove PostHog and the `email`/`user_plan` fields from `AlertWithContext` construction (`buildAlertEmail` may need those fields made optional in `lib/email.ts`).

- [ ] **Step 3: Weekly digest** — same treatment: `db` queries, Slack + SMTP delivery of `buildDigestEmail`, skip cleanly if neither channel configured.

- [ ] **Step 4: Dashboard fallback banner** — in `app/(dashboard)/dashboard/page.tsx`, query overdue-pending alerts (`scheduledFor <= today`, `status = "pending"`) joined to contract names; if non-empty AND no Slack webhook AND no SMTP, render an amber inline-styled banner: "N renewal alerts are due but no delivery channel is configured — add a Slack webhook in Settings." List the top 5 with contract links.

- [ ] **Step 5: Update `__tests__/cron-pagination.test.ts`** — mock `@/lib/db`, `@/lib/slack`, `@/lib/email-smtp` instead of Supabase/Resend; assert same pagination + status-marking behavior.

- [ ] **Step 6: Delete the Supabase layer and dependency**

```bash
rm -rf lib/supabase lib/types/database.ts
npm uninstall @supabase/ssr @supabase/supabase-js
npx tsc --noEmit    # expect ZERO Supabase-related errors — fix any stragglers now
npx jest            # full suite: expect PASS
git add -A && git commit -m "Slack/SMTP alert delivery, cron rewrite, remove Supabase"
```

---

## Phase 6 — AI-optional gating

### Task 19: Feature-flag AI features on ANTHROPIC_API_KEY

**Files:**
- Create: `lib/ai.ts`
- Modify: `app/(dashboard)/dashboard/review/new/page.tsx`, `app/(dashboard)/dashboard/contracts/[id]/page.tsx`, upload-zone component (find via `grep -rl "UploadZone\|upload-zone" components app`), `app/api/extract/route.ts`, `app/api/analyse/route.ts`, `app/api/compare/route.ts`, `app/api/finding-action/route.ts`

- [ ] **Step 1: Helper**

```ts
// lib/ai.ts
export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
```

The Python service reads the key from its own env; compose passes the same value to both containers (Task 21).

- [ ] **Step 2: API guards** — at the top of `/api/extract`, `/api/analyse` POST, `/api/compare`, `/api/finding-action`: `if (!aiEnabled()) return NextResponse.json({ error: "ai_disabled", message: "Set ANTHROPIC_API_KEY to enable AI features." }, { status: 503 });`

- [ ] **Step 3: Flow adjustments** — upload route already skips party detection without the key (Task 13). In upload/confirm flow: when AI is disabled, the frontend should route straight to the review screen in manual-entry mode (empty fields) instead of polling extraction. Pass `aiEnabled()` from server pages into the relevant client components as an `aiEnabled` prop; where disabled, hide "Analyzing…" states and render disabled buttons with the hint text "Add ANTHROPIC_API_KEY to enable" for Analyse / Compare / Draft email actions.

- [ ] **Step 4: Verify both modes compile & commit**

```bash
npx tsc --noEmit && npx jest
git add -A && git commit -m "Gate AI features on ANTHROPIC_API_KEY"
```

---

## Phase 7 — Docker, docs, smoke test

### Task 20: Web + Python Dockerfiles

**Files:**
- Create: `Dockerfile` (web), `python-service/Dockerfile`, `.dockerignore`
- Modify: `next.config.ts` (`output: "standalone"`)

- [ ] **Step 1: `next.config.ts`** — add `output: "standalone"` to the config object.

- [ ] **Step 2: Web Dockerfile**

```dockerfile
# Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/drizzle.config.ts ./
COPY --from=build /app/lib/db/schema.ts ./lib/db/schema.ts
COPY --from=build /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY docker/entrypoint.sh ./entrypoint.sh
EXPOSE 3000
CMD ["sh", "./entrypoint.sh"]
```

```sh
# docker/entrypoint.sh — run migrations, then start
set -e
npx drizzle-kit migrate
node server.js
```

(If `drizzle-kit migrate` proves awkward in standalone output, fallback: a tiny `scripts/migrate.mjs` using `drizzle-orm/node-postgres/migrator`'s `migrate(db, { migrationsFolder: "./drizzle" })`, run via `node scripts/migrate.mjs` — implementer picks whichever runs cleanly in the container.)

- [ ] **Step 3: Python Dockerfile**

```dockerfile
# python-service/Dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

- [ ] **Step 4: `.dockerignore`** — `node_modules`, `.next`, `.git`, `data`, `.env*`, `python-service/__pycache__`, `docs`.

- [ ] **Step 5: Build both images, commit**

```bash
docker build -t openrenew-web . && docker build -t openrenew-python python-service/
git add -A && git commit -m "Add web and python Dockerfiles"
```

### Task 21: Full docker-compose + cron sidecar

**Files:**
- Modify: `docker-compose.yml` (full version)
- Create: `docker/cron/Dockerfile`, `docker/cron/crontab`

- [ ] **Step 1: Cron sidecar**

```dockerfile
# docker/cron/Dockerfile
FROM alpine:3.20
RUN apk add --no-cache curl
COPY crontab /etc/crontabs/root
CMD ["crond", "-f", "-l", "2"]
```

```
# docker/cron/crontab
0 8 * * * curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" http://web:3000/api/cron/send-alerts || echo "send-alerts failed"
0 9 * * 1 curl -fsS -H "Authorization: Bearer ${CRON_SECRET}" http://web:3000/api/cron/send-weekly-digest || echo "digest failed"
```

Note: BusyBox crond doesn't expand env vars in crontabs — have the Dockerfile CMD write the crontab at start instead: `CMD sh -c 'echo "0 8 * * * curl -fsS -H \"Authorization: Bearer $CRON_SECRET\" http://web:3000/api/cron/send-alerts" > /etc/crontabs/root && echo "0 9 * * 1 curl -fsS -H \"Authorization: Bearer $CRON_SECRET\" http://web:3000/api/cron/send-weekly-digest" >> /etc/crontabs/root && crond -f -l 2'`. Drop the static crontab COPY if using this form.

- [ ] **Step 2: Full compose file**

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgres://openrenew:${POSTGRES_PASSWORD:-openrenew}@postgres:5432/openrenew
      SESSION_SECRET: ${SESSION_SECRET}
      EXTRACTION_SERVICE_SECRET: ${EXTRACTION_SERVICE_SECRET}
      CRON_SECRET: ${CRON_SECRET}
      APP_URL: ${APP_URL:-http://localhost:3000}
      PYTHON_SERVICE_URL: http://python:8001
      DATA_DIR: /data/contracts
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      SMTP_HOST: ${SMTP_HOST:-}
      SMTP_PORT: ${SMTP_PORT:-587}
      SMTP_USER: ${SMTP_USER:-}
      SMTP_PASS: ${SMTP_PASS:-}
      SMTP_FROM: ${SMTP_FROM:-}
      ALERT_RECIPIENTS: ${ALERT_RECIPIENTS:-}
      AUTH_DISABLED: ${AUTH_DISABLED:-false}
    volumes:
      - contracts-data:/data/contracts
    depends_on:
      postgres:
        condition: service_healthy
      python:
        condition: service_started

  python:
    build: ./python-service
    environment:
      EXTRACTION_SERVICE_SECRET: ${EXTRACTION_SERVICE_SECRET}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      DATA_DIR: /data/contracts
    volumes:
      - contracts-data:/data/contracts:ro

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: openrenew
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-openrenew}
      POSTGRES_DB: openrenew
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U openrenew"]
      interval: 5s
      timeout: 3s
      retries: 10

  cron:
    build: ./docker/cron
    environment:
      CRON_SECRET: ${CRON_SECRET}
    depends_on:
      - web

volumes:
  pgdata:
  contracts-data:
```

Note: python service mounts the volume read-only; no host port for postgres/python (internal only). Remove the Task 3 `ports: 127.0.0.1:5432` mapping (dev can use `docker compose exec postgres psql`).

- [ ] **Step 3: Bring the stack up, commit**

```bash
cp .env.example .env   # fill SESSION_SECRET, EXTRACTION_SERVICE_SECRET, CRON_SECRET
docker compose up -d --build
docker compose ps      # all 4 services running
curl -s localhost:3000 -o /dev/null -w '%{http_code}\n'   # expect 307 (redirect to /login or /setup)
git add -A && git commit -m "Full docker-compose stack with cron sidecar"
```

### Task 22: End-to-end smoke test

**Files:** none (verification task; fix regressions found)

- [ ] **Step 1: Fresh install path** — `docker compose down -v && docker compose up -d --build`. Open `localhost:3000` → redirected to `/login` → redirected to `/setup` (no users). Create admin. Land on dashboard.
- [ ] **Step 2: Manual contract (no AI key)** — with `ANTHROPIC_API_KEY` empty: add a manual contract with an expiry date ~45 days out and a 30-day notice period. Confirm. Verify: contract active; `docker compose exec postgres psql -U openrenew -c "select alert_type, scheduled_for from alerts;"` shows `day_30`, `day_7` rows; dashboard shows the "no delivery channel" banner logic only when an alert is *due*.
- [ ] **Step 3: AI path (if key available)** — set `ANTHROPIC_API_KEY`, `docker compose up -d`, upload a PDF, confirm party names, review extraction, confirm, verify analysis findings render on the detail page and the PDF iframe loads from `/api/contracts/<id>/pdf`.
- [ ] **Step 4: Cron + Slack** — configure a test Slack webhook in Settings (test message arrives). Insert a due alert (`update alerts set scheduled_for = current_date`) then `docker compose exec cron sh -c 'curl -fsS -H "Authorization: Bearer $CRON_SECRET" http://web:3000/api/cron/send-alerts'` — Slack message arrives, alert marked `sent`.
- [ ] **Step 5: Full test suites**

```bash
npx jest && (cd python-service && pytest tests/ -v)
```

Expected: all PASS.

- [ ] **Step 6: Commit any fixes** `git add -A && git commit -m "Smoke test fixes"`

### Task 23: README, CLAUDE.md update, push

**Files:**
- Create/rewrite: `README.md`
- Modify: `CLAUDE.md`, `.env.example` (final review)

- [ ] **Step 1: README.** Sections, in order: logo/name + one-liner ("Self-hosted contract renewal tracking with AI extraction — never miss an auto-renewal again"); screenshot placeholder block; **Quickstart** (`git clone https://github.com/dagolovach/openrenew && cd openrenew && cp .env.example .env` → fill 3 secrets → `docker compose up -d` → open `localhost:3000`); **Features** (AI extraction w/ forced schema, risk analysis, 60/30/7-day + notice-deadline alerts, Slack/SMTP delivery, contract version compare, vendor email drafting); **Privacy** (self-hosted, party-name anonymization before any Claude call, zero telemetry, AI entirely optional); **Architecture** (4-container diagram in a code block); **Configuration** (env var table from `.env.example`); **Roadmap** (OIDC/SSO, Ollama/local models, MS Teams alerts, CSV import/export, per-field confidence); **License** (AGPL-3.0).

- [ ] **Step 2: Update CLAUDE.md** — remove: Supabase/Vercel/Railway/Stripe references, `maxDuration` rule, free-tier cap, `AI_MODEL` env location notes that changed. Add: docker compose commands, Drizzle migration commands (`npm run db:generate` / `db:migrate`), auth model summary, DATA_DIR storage note. Keep: inline-styles rule, setTimeout-chains rule, font variables, forced-tool-call rule, `party_a/party_b`, DECISIONS.md pointer. Add DECISIONS.md entry 024 documenting the OpenRenew conversion (status Active, supersedes the platform-dependent parts of 001/005/008/010/011).

- [ ] **Step 3: Push**

```bash
git add -A && git commit -m "Add README, update CLAUDE.md and DECISIONS for OpenRenew"
git push origin main
```

---

## Self-review notes (already applied)

- Spec coverage: repo bootstrap (T1), AGPL (T1), strip list (T1–2), compose 4 services (T3, T20–21), Drizzle (T4), auth + setup + AUTH_DISABLED (T6–10), shared workspace / scoping removal (Phase 4 rules), storage + file-path mode + SSRF-preserved (T11–12), Slack primary + SMTP optional + dashboard fallback (T17–18), cron sidecar (T21), AI-optional (T13, T19), retired rules & README/roadmap (T23), smoke test gate (T22). Weekly digest kept (T18). No gaps found.
- Type consistency: `requireUser()`/`getSessionUser()`, `sendSlackMessage()`, `getSetting`/`setSetting`, `savePdf`/`readPdf`/`pdfAbsolutePath`, table names per the naming contract — used identically across tasks.
- Known judgment calls delegated to implementer: exact Drizzle query shapes inside large migrated routes (rules + worked examples given), drizzle-kit-in-container vs `migrate()` script (both specified in T20).
