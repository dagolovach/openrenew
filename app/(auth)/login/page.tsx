// app/(auth)/login/page.tsx
'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/ui/Logo'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [error, setError] = useState('')

  const supabase = useMemo(() => createClient(), [])

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
  }

  if (isSent) {
    return (
      <div style={styles.root}>
        <div style={styles.grid} />
        <div style={{ ...styles.card, textAlign: 'center', gap: 12 }}>
          <div style={styles.iconWrap}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 style={styles.heading}>Check your email</h1>
          <p style={styles.sub}>
            We sent a sign-in link to<br />
            <span style={{ color: '#10B981', fontFamily: 'var(--font-jetbrains), monospace' }}>{email}</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.root}>
      {/* Subtle dot-grid background */}
      <div style={styles.grid} />

      <div style={styles.card}>
        {/* Logo */}
        <div style={{ marginBottom: 8 }}>
          <Logo theme="dark" size="md" />
        </div>

        <div style={{ marginBottom: 28 }}>
          <h1 style={styles.heading}>Sign in</h1>
          <p style={styles.sub}>Track contract renewals before they track you.</p>
        </div>

        {error && (
          <div style={styles.errorBox}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleMagicLink} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="email" style={styles.label}>Email address</label>
            <input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={styles.input}
              onFocus={e => { e.currentTarget.style.borderColor = '#10B981'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.12)' }}
              onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; e.currentTarget.style.boxShadow = 'none' }}
            />
          </div>
          <button type="submit" disabled={isLoading} style={styles.primaryBtn}>
            {isLoading ? (
              <span style={{ opacity: 0.7 }}>Sending…</span>
            ) : (
              'Send magic link'
            )}
          </button>
        </form>

        <div style={styles.dividerWrap}>
          <div style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <div style={styles.dividerLine} />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          disabled={isLoading}
          style={styles.outlineBtn}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    position: 'relative',
    overflow: 'hidden',
  },
  grid: {
    position: 'absolute',
    inset: 0,
    backgroundImage: `radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)`,
    backgroundSize: '28px 28px',
    pointerEvents: 'none',
  },
  card: {
    position: 'relative',
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    background: 'rgba(10,15,30,0.85)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: '16px',
    padding: '36px 32px',
  },
  heading: {
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: '22px',
    fontWeight: 700,
    color: '#F9FAFB',
    margin: '8px 0 4px',
    letterSpacing: '-0.02em',
  },
  sub: {
    fontFamily: 'var(--font-inter), sans-serif',
    fontSize: '13px',
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.5,
  },
  label: {
    fontFamily: 'var(--font-inter), sans-serif',
    fontSize: '12px',
    fontWeight: 500,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: '#F9FAFB',
    fontFamily: 'var(--font-inter), sans-serif',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
    boxSizing: 'border-box',
  },
  primaryBtn: {
    width: '100%',
    padding: '11px 16px',
    background: '#10B981',
    border: 'none',
    borderRadius: '8px',
    color: '#0A0F1E',
    fontFamily: 'var(--font-jetbrains), monospace',
    fontSize: '13px',
    fontWeight: 700,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  outlineBtn: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '10px 16px',
    background: 'transparent',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '8px',
    color: 'rgba(255,255,255,0.7)',
    fontFamily: 'var(--font-inter), sans-serif',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'background 0.15s',
    boxSizing: 'border-box',
  },
  dividerWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    margin: '20px 0',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'rgba(255,255,255,0.08)',
  },
  dividerText: {
    fontFamily: 'var(--font-inter), sans-serif',
    fontSize: '11px',
    color: 'rgba(255,255,255,0.25)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  },
  errorBox: {
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.25)',
    borderRadius: '8px',
    color: '#FCA5A5',
    fontFamily: 'var(--font-inter), sans-serif',
    fontSize: '13px',
    marginBottom: '16px',
  },
  iconWrap: {
    width: '48px',
    height: '48px',
    background: 'rgba(16,185,129,0.1)',
    border: '1px solid rgba(16,185,129,0.2)',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 8px',
  },
}
