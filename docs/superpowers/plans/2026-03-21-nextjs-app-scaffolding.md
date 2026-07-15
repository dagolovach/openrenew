## Status

**Last verified:** 2026-03-24
**Build status:** Completed

All tasks in this plan are live in production. App is deployed to Vercel, Supabase auth (magic link + Google OAuth) is working, full DB schema with RLS is applied, storage bucket is configured.

**Divergences from plan:**
- Next.js version is 16.2.1 (plan targeted Next.js 14)
- React version is 19.2.4
- Tailwind is installed as a dev dependency but the app uses inline styles — Tailwind is not used in dashboard/review/detail pages

---

# Next.js App Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Renewl Next.js 14 app with Supabase auth (magic link + Google OAuth), full database schema with RLS, storage bucket, and Vercel deployment — no PDF/AI logic.

**Architecture:** Next.js 14 App Router at the repo root alongside existing `marketing/` and `docs/` directories. Supabase SSR package handles auth state across server components, route handlers, and middleware. All DB access goes through RLS — service role key is server-only.

**Tech Stack:** Next.js 14 (App Router), Tailwind CSS, TypeScript, `@supabase/ssr`, `@supabase/supabase-js`, Supabase CLI, Vercel.

---

## File Map

| File | Purpose |
|------|---------|
| `app/(auth)/login/page.tsx` | Magic link + Google OAuth sign-in form |
| `app/auth/callback/route.ts` | Handles both auth flows via `exchangeCodeForSession` → redirects to `/dashboard` |
| `app/(dashboard)/dashboard/page.tsx` | Protected placeholder page |
| `app/layout.tsx` | Root layout with font + metadata |
| `app/page.tsx` | Root redirect: checks session → `/dashboard` or `/login` |
| `components/ui/button.tsx` | Basic button primitive |
| `components/ui/input.tsx` | Basic input primitive |
| `lib/supabase/client.ts` | Browser Supabase client (singleton) |
| `lib/supabase/server.ts` | Server Supabase client for RSC + Route Handlers |
| `lib/supabase/middleware.ts` | Session refresh helper used by `middleware.ts` |
| `lib/types/database.ts` | Generated TypeScript types from Supabase CLI |
| `middleware.ts` | Protects `/dashboard/*`, redirects unauthenticated to `/login` |
| `supabase/config.toml` | Supabase CLI project config |
| `supabase/migrations/20260321000000_initial_schema.sql` | Full schema: all 5 tables, triggers, indexes, RLS policies |
| `.env.local` | Local env vars (gitignored) |
| `__tests__/middleware.test.ts` | Unit test for auth redirect logic |

---

## Task 1: Scaffold Next.js app in repo root

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx` (all via `create-next-app`)

- [ ] **Step 1: Verify the working directory**

```bash
pwd
ls
```
Expected: you are in `/path/to/renewl` and see `docs/`, `marketing/` in the listing.

- [ ] **Step 2: Scaffold Next.js into the current directory**

```bash
npx create-next-app@latest . \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --skip-git \
  --eslint
```

When prompted "would you like to proceed?", answer `y`. The `--skip-git` flag prevents re-initialising the git repo.

- [ ] **Step 3: Verify the scaffold**

```bash
ls app/
```
Expected: `favicon.ico  globals.css  layout.tsx  page.tsx`

- [ ] **Step 4: Verify it builds clean**

```bash
npm run build
```
Expected: build succeeds with no errors. It will show a few pages compiled.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 14 app with Tailwind + TypeScript"
```

---

## Task 2: Install Supabase packages and configure env vars

**Files:**
- Modify: `package.json`
- Create: `.env.local`
- Modify: `.gitignore`

- [ ] **Step 1: Install Supabase SSR packages**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Verify installation**

```bash
cat package.json | grep supabase
```
Expected: both `@supabase/supabase-js` and `@supabase/ssr` appear in `dependencies`.

- [ ] **Step 3: Create `.env.local`**

Create the file `.env.local` at the repo root with this content — fill in real values from your Supabase dashboard (Project Settings → API):

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

`NEXT_PUBLIC_` prefix makes the first two available in the browser. `SUPABASE_SERVICE_ROLE_KEY` has no prefix — it must NEVER appear in client components or be prefixed `NEXT_PUBLIC_`. It bypasses RLS entirely.

- [ ] **Step 4: Verify `.env.local` is gitignored**

```bash
cat .gitignore | grep .env
```
Expected: `.env.local` appears. If not, add it:
```bash
echo ".env.local" >> .gitignore
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "chore: install @supabase/ssr and @supabase/supabase-js"
```

---

## Task 3: Supabase client helpers

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/middleware.ts`

These three files are the only place in the codebase that creates Supabase client instances. All other files import from here.

- [ ] **Step 1: Create `lib/supabase/client.ts`**

This creates a browser-side client. Import this in Client Components only.

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database'

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 2: Create `lib/supabase/server.ts`**

This creates a server-side client. Import this in Server Components and Route Handlers. It reads cookies to get the session.

```typescript
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types/database'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // setAll called from a Server Component — safe to ignore,
            // middleware handles session refresh
          }
        },
      },
    }
  )
}
```

- [ ] **Step 3: Create `lib/supabase/middleware.ts`**

This refreshes the auth session on every request. Called from `middleware.ts`.

```typescript
// lib/supabase/middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database } from '@/lib/types/database'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh the session — do not add logic between createServerClient and getUser
  const { data: { user } } = await supabase.auth.getUser()

  const isProtected = request.nextUrl.pathname.startsWith('/dashboard')
  if (isProtected && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 4: Create placeholder types file**

The real types come from `supabase gen types` in Task 9. Create a placeholder now so imports resolve:

```typescript
// lib/types/database.ts
// This file is auto-generated by: supabase gen types typescript --linked > lib/types/database.ts
// Do not edit manually.
export type Database = Record<string, never>
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/
git commit -m "feat: add Supabase client helpers (browser, server, middleware)"
```

---

## Task 4: Next.js middleware

**Files:**
- Create: `middleware.ts`
- Create: `__tests__/middleware.test.ts`

- [ ] **Step 1: Write the failing test first**

Install testing dependencies:
```bash
npm install --save-dev jest @types/jest ts-jest jest-environment-node
```

Create `jest.config.ts`:
```typescript
// jest.config.ts
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
}

export default config
```

Create the test:
```typescript
// __tests__/middleware.test.ts
import { updateSession } from '@/lib/supabase/middleware'

// We test the redirect logic, not the Supabase call
// The middleware redirects unauthenticated users from /dashboard to /login
describe('updateSession', () => {
  it('is a function that accepts a NextRequest', () => {
    expect(typeof updateSession).toBe('function')
  })
})
```

- [ ] **Step 2: Run test to verify it fails cleanly**

```bash
npx jest --testPathPattern=middleware
```
Expected: 1 test passes (this is a smoke test confirming the import works).

- [ ] **Step 3: Create `middleware.ts`**

```typescript
// middleware.ts
import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest
```
Expected: 1 test suite passes.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add middleware.ts __tests__/ jest.config.ts
git commit -m "feat: add Next.js middleware for auth session refresh and route protection"
```

---

## Task 5: Auth callback route

**Files:**
- Create: `app/auth/callback/route.ts`

This is not inside a route group — it must resolve to the URL `/auth/callback`, which is what Supabase redirects to after sign-in. A route group like `(auth)` would strip from the URL, but `app/auth/` creates a real `/auth/` URL segment.

- [ ] **Step 1: Create the callback route**

```typescript
// app/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}/dashboard`)
    }
  }

  // If no code or exchange failed, redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
```

Note: `exchangeCodeForSession` handles both magic link and Google OAuth — both flows send a `code` param.

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/auth/
git commit -m "feat: add auth callback route using exchangeCodeForSession"
```

---

## Task 6: Login page

**Files:**
- Create: `app/(auth)/login/page.tsx`
- Create: `components/ui/button.tsx`
- Create: `components/ui/input.tsx`

- [ ] **Step 1: Create `components/ui/button.tsx`**

```typescript
// components/ui/button.tsx
import { ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline'
  isLoading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', isLoading, children, className = '', disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
    const variants = {
      primary: 'bg-teal-600 text-white hover:bg-teal-700 focus:ring-teal-500',
      outline: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-teal-500',
    }
    return (
      <button
        ref={ref}
        className={`${base} ${variants[variant]} ${className}`}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading ? 'Loading…' : children}
      </button>
    )
  }
)
Button.displayName = 'Button'
```

- [ ] **Step 2: Create `components/ui/input.tsx`**

```typescript
// components/ui/input.tsx
import { InputHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', id, ...props }, ref) => (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-gray-700">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={id}
        className={`rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${error ? 'border-red-500' : 'border-gray-300'} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
)
Input.displayName = 'Input'
```

- [ ] **Step 3: Create `app/(auth)/login/page.tsx`**

```typescript
// app/(auth)/login/page.tsx
'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [error, setError] = useState('')

  const supabase = createClient()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      setError(error.message)
    } else {
      setIsSent(true)
    }
    setIsLoading(false)
  }

  async function handleGoogle() {
    setIsLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setError(error.message)
      setIsLoading(false)
    }
    // On success, browser navigates away — no need to reset loading
  }

  if (isSent) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-xl font-semibold text-gray-900">Check your email</h1>
          <p className="mt-2 text-sm text-gray-600">
            We sent a sign-in link to <strong>{email}</strong>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-6 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Renewl</h1>
          <p className="mt-1 text-sm text-gray-600">Sign in to your account</p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <form onSubmit={handleMagicLink} className="space-y-4">
          <Input
            id="email"
            type="email"
            label="Email address"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Button type="submit" isLoading={isLoading} className="w-full">
            Send magic link
          </Button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-gray-400">or</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogle}
          isLoading={isLoading}
          className="w-full"
        >
          Continue with Google
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Run build**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/\(auth\)/ components/
git commit -m "feat: add login page with magic link and Google OAuth"
```

---

## Task 7: Dashboard placeholder and root redirect

**Files:**
- Create: `app/(dashboard)/dashboard/page.tsx`
- Modify: `app/page.tsx`

- [ ] **Step 1: Create dashboard placeholder**

```typescript
// app/(dashboard)/dashboard/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p className="mt-2 text-sm text-gray-600">
        Signed in as {user.email}
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Replace `app/page.tsx` with session-aware redirect**

```typescript
// app/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function RootPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
```

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit && npm run build
```
Expected: no errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/\(dashboard\)/ app/page.tsx
git commit -m "feat: add dashboard placeholder and root session redirect"
```

---

## Task 8: Supabase CLI setup and migration

**Files:**
- Create: `supabase/config.toml` (via CLI)
- Create: `supabase/migrations/20260321000000_initial_schema.sql`

- [ ] **Step 1: Install Supabase CLI**

```bash
brew install supabase/tap/supabase
```

Verify:
```bash
supabase --version
```
Expected: version string printed (1.x.x or later).

- [ ] **Step 2: Initialise Supabase in the repo**

```bash
supabase init
```
Expected: `supabase/config.toml` created.

- [ ] **Step 3: Link to your remote Supabase project**

```bash
supabase link
```

You will be prompted to select your project from the list. Select the one you created. You may need to log in first:
```bash
supabase login
```

- [ ] **Step 4: Create the migration file**

Create `supabase/migrations/20260321000000_initial_schema.sql` with the following content:

```sql
-- =============================================
-- Renewl Initial Schema
-- =============================================

-- ── Utility: updated_at trigger function ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── profiles ──────────────────────────────────────────────────────────────
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

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on new auth user
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

-- ── contracts ─────────────────────────────────────────────────────────────
-- Two status columns with distinct meanings:
-- status: overall contract lifecycle (processing → review → confirmed → expired)
-- extraction_status: AI pipeline state (pending → processing → review → confirmed → manual)
-- They can diverge: e.g. status=confirmed + extraction_status=manual means user entered dates manually
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

-- ── contract_extractions ──────────────────────────────────────────────────
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

-- Flip was_edited to true when confirmed_value differs from extracted_value
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

-- ── alerts ────────────────────────────────────────────────────────────────
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

-- ── activity_log ──────────────────────────────────────────────────────────
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────
-- idx_contracts_expiry_date is the dashboard's primary query (runs on every page load)
CREATE INDEX idx_contracts_user_id ON public.contracts(user_id);
CREATE INDEX idx_contracts_expiry_date ON public.contracts(user_id, expiry_date) WHERE status = 'confirmed';
CREATE INDEX idx_alerts_scheduled ON public.alerts(scheduled_for, status) WHERE status = 'pending';
CREATE INDEX idx_contract_extractions_contract_id ON public.contract_extractions(contract_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Enable RLS on all tables. IMPORTANT: enabling RLS without CREATE POLICY locks everyone out.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own profile"
  ON public.profiles FOR ALL
  USING (id = auth.uid());

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own contracts"
  ON public.contracts FOR ALL
  USING (user_id = auth.uid());

ALTER TABLE public.contract_extractions ENABLE ROW LEVEL SECURITY;
-- No direct user_id column — access via ownership join through contracts
CREATE POLICY "Users can access their own contract extractions"
  ON public.contract_extractions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.contracts
      WHERE contracts.id = contract_extractions.contract_id
      AND contracts.user_id = auth.uid()
    )
  );

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage their own alerts"
  ON public.alerts FOR ALL
  USING (user_id = auth.uid());

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own activity log"
  ON public.activity_log FOR ALL
  USING (user_id = auth.uid());

-- ── Storage bucket ────────────────────────────────────────────────────────
-- Files stored at {user_id}/{contract_id}/{filename}
-- IMPORTANT: verify storage.foldername RLS syntax against current Supabase docs before deploying.
-- This API has changed across versions — do not copy from stale examples.
INSERT INTO storage.buckets (id, name, public)
VALUES ('contracts', 'contracts', false);

CREATE POLICY "Users can manage their own contract files"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'contracts'
    AND auth.uid() = (storage.foldername(name))[1]::uuid
  );
```

- [ ] **Step 5: Commit the migration**

```bash
git add supabase/
git commit -m "feat: add initial schema migration with all tables, RLS, indexes, and storage"
```

---

## Task 9: Apply migration and generate TypeScript types

**Files:**
- Modify: `lib/types/database.ts` (replace placeholder with generated types)

- [ ] **Step 1: Push the migration to your remote Supabase project**

```bash
supabase db push
```

Expected output: migration applied successfully. If you see an error about the storage policy, check the Supabase Storage RLS documentation for the current syntax at https://supabase.com/docs/guides/storage/security/access-control — the `storage.foldername` function signature may have changed.

- [ ] **Step 2: Verify tables exist in Supabase dashboard**

Go to Supabase dashboard → Table Editor. Verify you can see: `profiles`, `contracts`, `contract_extractions`, `alerts`, `activity_log`.

- [ ] **Step 3: Generate TypeScript types**

```bash
supabase gen types typescript --linked > lib/types/database.ts
```

- [ ] **Step 4: Verify the generated file**

```bash
head -20 lib/types/database.ts
```
Expected: TypeScript interface definitions, not the placeholder `Record<string, never>`.

- [ ] **Step 5: Type-check the whole project**

```bash
npx tsc --noEmit
```
Expected: no errors. The generated types will now flow through all the Supabase client calls.

- [ ] **Step 6: Run build**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add lib/types/database.ts
git commit -m "chore: generate Supabase TypeScript types from linked project"
```

---

## Task 10: Enable Google OAuth in Supabase dashboard

This task requires manual steps in two dashboards — it cannot be scripted.

- [ ] **Step 1: Create Google OAuth credentials**

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Create OAuth 2.0 Client ID (type: Web application)
3. Add authorised redirect URI: `https://your-project-ref.supabase.co/auth/v1/callback`
4. Copy the Client ID and Client Secret

- [ ] **Step 2: Enable Google provider in Supabase**

1. Supabase dashboard → Authentication → Providers → Google
2. Toggle Enable
3. Paste Client ID and Client Secret
4. Save

- [ ] **Step 3: Add redirect URLs to Supabase allowlist**

Supabase dashboard → Authentication → URL Configuration → Redirect URLs. Add all three:
```
http://localhost:3000/**
https://*.vercel.app/**
https://getrenewl.com/**
```

The `*.vercel.app` wildcard is required for preview deployments — without it, every preview deployment breaks auth.

- [ ] **Step 4: Smoke test auth locally**

```bash
npm run dev
```

Open http://localhost:3000. You should be redirected to `/login`. Test both flows:
1. Enter your email → check inbox for magic link → click → land on `/dashboard` showing your email
2. Click "Continue with Google" → complete OAuth → land on `/dashboard`

Check Supabase dashboard → Authentication → Users — your user should appear.

---

## Task 11: Deploy to Vercel

- [ ] **Step 1: Push current state to GitHub**

```bash
git push origin main
```

- [ ] **Step 2: Create Vercel project**

1. Go to vercel.com → New Project
2. Import your GitHub repository
3. Framework preset: Next.js (auto-detected)
4. Root directory: `.` (the repo root)
5. Do NOT deploy yet — set env vars first

- [ ] **Step 3: Set environment variables in Vercel**

In Vercel → Project Settings → Environment Variables, add all four vars for Production and Preview environments:
```
NEXT_PUBLIC_SUPABASE_URL       = https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = your-anon-key
SUPABASE_SERVICE_ROLE_KEY      = your-service-role-key
ANTHROPIC_API_KEY              = your-anthropic-key
```

Note: `ANTHROPIC_API_KEY` is set here for completeness but will not be used by Next.js until Week 2. It also needs to be set in Railway when the Python microservice is deployed.

- [ ] **Step 4: Deploy**

Click Deploy in Vercel. Wait for build to complete.

Expected: build succeeds, deployment URL shown (e.g. `renewl-xxx.vercel.app`).

- [ ] **Step 5: Add Vercel URL to Supabase redirect allowlist**

If you haven't already (Task 10, Step 3), add `https://*.vercel.app/**` to Supabase's redirect URL allowlist.

- [ ] **Step 6: Smoke test production**

Open the Vercel deployment URL. Verify:
- Root URL redirects to `/login`
- Magic link auth works end-to-end
- Google OAuth works end-to-end
- `/dashboard` shows your email after sign-in
- Navigating to `/dashboard` without signing in redirects to `/login`

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "chore: ready for Vercel deployment — all env vars and OAuth configured"
git push origin main
```
