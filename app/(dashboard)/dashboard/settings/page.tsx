// app/(dashboard)/dashboard/settings/page.tsx
import { redirect } from 'next/navigation'
import { randomBytes } from 'crypto'
import { getSessionUser } from '@/lib/auth/session'
import { getSetting, setSetting } from '@/lib/db/settings'
import SettingsClient from '@/components/dashboard/settings-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const slackWebhookUrl = await getSetting<string>('slack_webhook_url')

  let icalToken = await getSetting<string>('ical_token')
  if (!icalToken) {
    icalToken = randomBytes(32).toString('hex')
    await setSetting('ical_token', icalToken)
  }
  const icalUrl = `${process.env.APP_URL ?? 'http://localhost:3000'}/api/calendar/feed.ics?token=${icalToken}`

  return (
    <SettingsClient
      email={user.email ?? ''}
      slackWebhookUrl={slackWebhookUrl}
      icalUrl={icalUrl}
      isAdmin={user.isAdmin}
    />
  )
}
