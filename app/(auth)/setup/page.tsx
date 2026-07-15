import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import SetupForm from './setup-form'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const anyUser = await db.query.users.findFirst()
  if (anyUser) redirect('/login')

  return <SetupForm />
}
