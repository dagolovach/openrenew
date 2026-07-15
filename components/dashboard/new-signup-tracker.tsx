'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { Analytics } from '@/lib/analytics'

export default function NewSignupTracker() {
  const params = useSearchParams()

  useEffect(() => {
    if (params.get('new_signup') === '1') {
      Analytics.accountCreated()
      window.history.replaceState({}, '', '/dashboard')
    }
  }, [params])

  return null
}
