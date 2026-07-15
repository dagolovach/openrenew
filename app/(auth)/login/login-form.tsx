'use client'

import { useState } from 'react'
import { Logo } from '@/components/ui/Logo'
import { authStyles, focusInput, blurInput } from '../styles'

export default function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (res.ok) {
      window.location.href = '/dashboard'
      return
    }

    if (res.status === 401) {
      setError('Invalid email or password.')
    } else {
      setError('Something went wrong. Please try again.')
    }
    setIsLoading(false)
  }

  return (
    <div style={authStyles.root}>
      {/* Subtle dot-grid background */}
      <div style={authStyles.grid} />

      <div style={authStyles.card}>
        {/* Logo */}
        <div style={{ marginBottom: 8 }}>
          <Logo theme="dark" size="md" />
        </div>

        <div style={{ marginBottom: 28 }}>
          <h1 style={authStyles.heading}>Sign in</h1>
          <p style={authStyles.sub}>Track contract renewals before they track you.</p>
        </div>

        {error && (
          <div style={authStyles.errorBox}>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="email" style={authStyles.label}>Email address</label>
            <input
              id="email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={authStyles.input}
              onFocus={focusInput}
              onBlur={blurInput}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="password" style={authStyles.label}>Password</label>
            <input
              id="password"
              type="password"
              placeholder="••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={authStyles.input}
              onFocus={focusInput}
              onBlur={blurInput}
            />
          </div>
          <button type="submit" disabled={isLoading} style={authStyles.primaryBtn}>
            {isLoading ? <span style={{ opacity: 0.7 }}>Signing in…</span> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
