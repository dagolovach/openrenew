// app/(dashboard)/dashboard/settings/page.tsx
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getUserFromHeader } from '@/lib/supabase/user-from-header'
import SettingsClient from '@/components/dashboard/settings-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Settings — OpenRenew' }

export default async function SettingsPage() {
  const user = await getUserFromHeader()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, email, slack_webhook_url')
    .eq('id', user.id)
    .single()

  return (
    <SettingsClient
      plan={profile?.plan ?? 'free'}
      email={profile?.email ?? user.email ?? ''}
      slackWebhookUrl={profile?.slack_webhook_url ?? null}
    />
  )
}
