// app/api/settings/slack/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const slackSchema = z.object({
  slack_webhook_url: z.string().url().nullable().optional(),
})

export async function PATCH(request: Request) {
  const sessionClient = await createClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rawBody = await request.json()
  const parsed = slackSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 })
  }
  const { slack_webhook_url } = parsed.data

  if (slack_webhook_url) {
    // SSRF guard: only allow real Slack webhook URLs
    try {
      const url = new URL(slack_webhook_url)
      if (url.hostname !== 'hooks.slack.com') {
        return NextResponse.json({ error: 'invalid_webhook_url' }, { status: 400 })
      }
      if (url.protocol !== 'https:') {
        return NextResponse.json({ error: 'invalid_webhook_url' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'invalid_webhook_url' }, { status: 400 })
    }

    try {
      const testRes = await fetch(slack_webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '✓ OpenRenew is connected to this Slack channel.' }),
      })
      if (!testRes.ok) {
        return NextResponse.json({ error: 'webhook_unreachable' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'webhook_unreachable' }, { status: 400 })
    }
  }

  await sessionClient
    .from('profiles')
    .update({ slack_webhook_url: slack_webhook_url ?? null })
    .eq('id', user.id)

  return NextResponse.json({ ok: true })
}
