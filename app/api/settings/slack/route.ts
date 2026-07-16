// app/api/settings/slack/route.ts
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/auth/session'
import { setSetting } from '@/lib/db/settings'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const slackSchema = z.object({
  slack_webhook_url: z.string().url().nullable().optional(),
})

export async function PATCH(request: Request) {
  const user = await requireUser()
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

  await setSetting('slack_webhook_url', slack_webhook_url ?? null)

  return NextResponse.json({ ok: true })
}
