'use client'

import { useState } from 'react'
import { Logo } from '@/components/ui/Logo'
import { authStyles, focusInput, blurInput } from '../styles'

export default function SetupForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (password.length < 10) {
      setError('Password must be at least 10 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setIsLoading(true)

    const res = await fetch('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    if (res.ok) {
      window.location.href = '/dashboard'
      return
    }

    if (res.status === 409) {
      window.location.href = '/login'
      return
    }

    setError('Something went wrong. Please try again.')
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
          <h1 style={authStyles.heading}>Create your admin account</h1>
          <p style={authStyles.sub}>One-time setup for this OpenRenew instance.</p>
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
              placeholder="At least 10 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              style={authStyles.input}
              onFocus={focusInput}
              onBlur={blurInput}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label htmlFor="confirmPassword" style={authStyles.label}>Confirm password</label>
            <input
              id="confirmPassword"
              type="password"
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={10}
              style={authStyles.input}
              onFocus={focusInput}
              onBlur={blurInput}
            />
          </div>
          <button type="submit" disabled={isLoading} style={authStyles.primaryBtn}>
            {isLoading ? <span style={{ opacity: 0.7 }}>Creating account…</span> : 'Create admin account'}
          </button>
        </form>
      </div>
    </div>
  )
}
