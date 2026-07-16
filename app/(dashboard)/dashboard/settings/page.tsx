// app/(dashboard)/dashboard/settings/page.tsx
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth/session'
import { getSetting } from '@/lib/db/settings'
import SettingsClient from '@/components/dashboard/settings-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings — OpenRenew' }

export default async function SettingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const slackWebhookUrl = await getSetting<string>('slack_webhook_url')

  return (
    <SettingsClient
      email={user.email ?? ''}
      slackWebhookUrl={slackWebhookUrl}
    />
  )
}
