# Next.js App Scaffolding — Design Spec

**Date:** 2026-03-21
**Scope:** Scaffold the Renewl Next.js app with Supabase (auth + DB + storage), full schema, and Vercel deployment. No PDF/AI logic — that is Week 2.
**Approach:** Option B — `create-next-app` from scratch + Supabase CLI for migrations and type generation.

---

## Project Structure

```
renewl/
├── app/
│   ├── (auth)/
│   │   └── login/page.tsx          # Magic link + Google OAuth sign-in
│   ├── auth/
│   │   └── callback/route.ts       # Auth callback handler — resolves to /auth/callback
│   ├── (dashboard)/
│   │   └── dashboard/page.tsx      # Protected placeholder
│   ├── layout.tsx
│   └── page.tsx                    # Root redirect: /dashboard or /login
├── components/
│   └── ui/                         # Shared UI primitives
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client
│   │   ├── server.ts               # Server Supabase client (RSC + Route Handlers)
│   │   └── middleware.ts           # Session refresh helper
│   └── types/
│       └── database.ts             # Generated types (supabase gen types)
├── supabase/
│   ├── config.toml
│   └── migrations/
│       └── 20260321000000_initial_schema.sql
├── middleware.ts                   # Protects /dashboard/* routes
└── .env.local
```

**Note on route groups vs URL paths:** The `(auth)` route group is purely organisational — it does not appear in the URL. The callback route must resolve to `/auth/callback` (the URL registered in Supabase's redirect allowlist), so it lives at `app/auth/callback/route.ts` outside any route group.

---

## Auth

**Methods:** Magic link (email) + Google OAuth
**Package:** `@supabase/ssr` — NOT the deprecated `@supabase/auth-helpers-nextjs`

**Callback route (`app/auth/callback/route.ts` → URL: `/auth/callback`):**
- Uses `exchangeCodeForSession` for both magic link and Google OAuth flows
- Never uses the older `setSession` pattern
- Must match exactly the URL registered in Supabase's redirect allowlist

**Post-auth redirect logic:**
- Callback always redirects to `/dashboard` for now
- `profiles.onboarding_completed` flag is created but not yet acted on — Week 2 will add onboarding flow routing (`false` → `/onboarding`, `true` → `/dashboard`)
- Profile existence is NOT used as the new/returning signal (profile is created instantly via trigger before callback runs)

**Middleware (`middleware.ts`):**
- Runs on all `/dashboard/*` routes
- No session → redirect to `/login`
- Valid session → refresh if needed, continue

---

## Database Schema

All tables have RLS enabled with explicit `CREATE POLICY` statements. Enabling RLS without policies locks everyone out — both steps are required.

### `profiles`
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  timezone TEXT DEFAULT 'UTC',
  slack_webhook_url TEXT,
  onboarding_completed BOOLEAN NOT NULL DEFAULT false,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Stripe columns are nullable placeholders — not used until Week 4, but added now to avoid a migration that touches a core table later.

**Auto-creation trigger:**
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

**`updated_at` trigger (reusable, applied to `profiles` and `contracts`):**
```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### `contracts`

Two status columns with distinct meanings:
- `status` — overall contract lifecycle: `processing → review → confirmed → expired`. Driven by the upload/review/confirmation flow.
- `extraction_status` — AI extraction pipeline state: `pending → processing → review → confirmed → manual`. Tracks where the extraction is in the pipeline independently of the contract record itself. A contract can be `status: confirmed` with `extraction_status: manual` if the user skipped AI and entered dates by hand.

```sql
CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('saas', 'lease', 'vendor', 'employment', 'other')),
  counterparty_name TEXT,
  effective_date DATE,
  expiry_date DATE,
  renewal_date DATE,
  auto_renew BOOLEAN,
  notice_period_days INTEGER,
  notice_period_text TEXT,
  contract_value TEXT,
  extraction_confidence NUMERIC(3,2),
  extraction_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (extraction_status IN ('pending', 'processing', 'review', 'confirmed', 'manual')),
  file_path TEXT,
  file_name TEXT,
  file_size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'review', 'confirmed', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER set_contracts_updated_at
  BEFORE UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### `contract_extractions`

```sql
CREATE TABLE public.contract_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  extracted_value TEXT,
  confirmed_value TEXT,
  confidence NUMERIC(3,2),
  was_edited BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`was_edited` trigger** — flips to `true` when `confirmed_value` is set and differs from `extracted_value`:
```sql
CREATE OR REPLACE FUNCTION public.set_was_edited()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confirmed_value IS NOT NULL AND NEW.confirmed_value IS DISTINCT FROM NEW.extracted_value THEN
    NEW.was_edited = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER check_was_edited
  BEFORE INSERT OR UPDATE ON public.contract_extractions
  FOR EACH ROW EXECUTE FUNCTION public.set_was_edited();
```

### `alerts`

```sql
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('day_60', 'day_30', 'day_7')),
  scheduled_for DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### `activity_log`

```sql
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Indexes

```sql
CREATE INDEX idx_contracts_user_id ON public.contracts(user_id);
CREATE INDEX idx_contracts_expiry_date ON public.contracts(user_id, expiry_date) WHERE status = 'confirmed';
CREATE INDEX idx_alerts_scheduled ON public.alerts(scheduled_for, status) WHERE status = 'pending';
CREATE INDEX idx_contract_extractions_contract_id ON public.contract_extractions(contract_id);
```

`idx_contracts_expiry_date` is the query the dashboard runs on every page load — it must be in the initial migration, not added later.

### RLS Policies

All five tables have RLS enabled. Policy patterns:

**`profiles`, `contracts`, `alerts`, `activity_log`** — direct `user_id = auth.uid()` check. Example:
```sql
CREATE POLICY "Users can manage their own contracts"
ON public.contracts FOR ALL
USING (user_id = auth.uid());
```

**`contract_extractions`** — no direct `user_id` column; access via ownership join through `contracts`:
```sql
CREATE POLICY "Users can access their own contract extractions"
ON public.contract_extractions FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.contracts
    WHERE contracts.id = contract_extractions.contract_id
    AND contracts.user_id = auth.uid()
  )
);
```

---

## Storage

- Bucket name: `contracts`
- Visibility: **private** (not public)
- File path convention: `{user_id}/{contract_id}/{filename}`
- RLS policy: `auth.uid() = (storage.foldername(name))[1]::uuid`

**Note:** `storage.foldername` returns path directory components as an array. Index `[1]` extracts the first segment (the `user_id`). **When implementing this policy, check the current Supabase Storage RLS documentation rather than copying from an old example — this API has changed across versions and a copy-paste from a stale source will silently fail.** Do not assume the syntax is stable.

---

## Environment Variables

### Local (`.env.local`)
```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

### Vercel dashboard
Same three vars set for production + preview environments. Additionally:
```
ANTHROPIC_API_KEY=your-anthropic-key
```
`ANTHROPIC_API_KEY` is set in Vercel now so it is not forgotten, but it will be used by the Python microservice on Railway (Week 2), not by the Next.js app directly. Set it in Railway's env vars as well when the microservice is deployed.

**Critical:** `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed `NEXT_PUBLIC_` and must never appear in client-side code or React components. It bypasses RLS entirely. Restrict to Route Handlers (`app/api/`) and server-only functions.

---

## Vercel Deployment

- GitHub repo connected to Vercel project
- Auto-deploy on push to `main`
- All env vars set in Vercel dashboard

**Supabase redirect URL allowlist (manual step in Supabase dashboard → Authentication → URL Configuration):**
```
http://localhost:3000/**
https://*.vercel.app/**
https://getrenewl.com/**
```

The `*.vercel.app` wildcard is required for preview deployments. Without it, every preview deployment breaks auth. All three entries use `/**` not just the root.

---

## Out of Scope

- PDF upload UI
- Claude extraction pipeline
- Python microservice
- Alert cron job
- Stripe integration
- Dashboard UI beyond a placeholder
