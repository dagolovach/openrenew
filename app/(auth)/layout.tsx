import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Sign in — OpenRenew',
  description: 'Sign in to your OpenRenew account.',
  robots: { index: false },
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#0A0F1E' }}>
      {children}
    </div>
  )
}
