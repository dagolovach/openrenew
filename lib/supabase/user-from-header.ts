import { headers } from 'next/headers'

export type HeaderUser = { id: string; email: string }

export async function getUserFromHeader(): Promise<HeaderUser | null> {
  const headerStore = await headers()
  const id = headerStore.get('x-user-id')
  const email = headerStore.get('x-user-email') ?? ''
  if (!id) return null
  return { id, email }
}
