// components/dashboard/settings-client.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import LogoutButton from '@/components/dashboard/logout-button'

interface Props {
  email: string
  slackWebhookUrl: string | null
}

export default function SettingsClient({ email, slackWebhookUrl }: Props) {
  const [slackUrl, setSlackUrl] = useState(slackWebhookUrl ?? '')
  const [slackStatus, setSlackStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [slackError, setSlackError] = useState('')

  async function handleSlackSave() {
    setSlackStatus('saving')
    setSlackError('')
    const res = await fetch('/api/settings/slack', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slack_webhook_url: slackUrl || null }),
    })
    if (res.ok) {
      setSlackStatus('saved')
      setTimeout(() => setSlackStatus('idle'), 2000)
    } else {
      const data = await res.json()
      setSlackStatus('error')
      setSlackError(
        data.error === 'webhook_unreachable'
          ? 'Could not reach that webhook URL. Please check it and try again.'
          : data.error === 'invalid_webhook_url'
          ? 'Only Slack webhook URLs (hooks.slack.com) are accepted.'
          : 'Failed to save. Please try again.'
      )
    }
  }

  const sectionStyle: React.CSSProperties = {
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    paddingBottom: '32px',
    marginBottom: '32px',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: '#4B5563',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    marginBottom: '16px',
  }

  return (
    <div style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif', color: '#F9FAFB', minHeight: '100vh', background: '#0A0F1E' }}>
      {/* Header */}
      <header style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '0 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '56px' }}>
            <Link href="/dashboard" style={{ textDecoration: 'none' }}>
              <Logo theme="dark" size="md" />
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Link href="/dashboard" style={{ fontSize: '13px', color: '#6B7280', textDecoration: 'none' }}>Dashboard</Link>
              <Link href="/dashboard/calendar" style={{ fontSize: '13px', color: '#6B7280', textDecoration: 'none' }}>Calendar</Link>
              <Link href="/dashboard/settings" style={{ fontSize: '13px', color: '#F9FAFB', textDecoration: 'none' }}>Settings</Link>
              <span style={{ fontSize: '13px', color: '#4B5563' }}>{email}</span>
              <LogoutButton />
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: '680px', margin: '0 auto', padding: '40px 24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: 600, marginBottom: '32px' }}>Settings</h1>

        {/* Account */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Account</p>
          <p style={{ fontSize: '14px', color: '#9CA3AF' }}>
            <span style={{ color: '#6B7280' }}>Email: </span>{email}
          </p>
        </div>

        {/* Notifications / Slack */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Notifications</p>
          <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
            Slack webhook URL
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="url"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                color: '#F9FAFB',
                outline: 'none',
              }}
            />
            <button
              onClick={handleSlackSave}
              disabled={slackStatus === 'saving'}
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: '#F9FAFB',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                cursor: slackStatus === 'saving' ? 'not-allowed' : 'pointer',
              }}
            >
              {slackStatus === 'saving' ? 'Saving…' : slackStatus === 'saved' ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          {slackStatus === 'error' && (
            <p style={{ fontSize: '12px', color: '#EF4444' }}>{slackError}</p>
          )}
          <a
            href="https://api.slack.com/messaging/webhooks"
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: '12px', color: '#4B5563', textDecoration: 'none' }}
          >
            How to get a webhook URL ↗
          </a>
        </div>

        {/* Danger zone */}
        <div>
          <p style={labelStyle}>Danger Zone</p>
          <button
            disabled
            style={{
              background: 'transparent',
              color: '#4B5563',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '6px',
              padding: '8px 16px',
              fontSize: '13px',
              cursor: 'not-allowed',
            }}
          >
            Delete account — coming soon
          </button>
        </div>
      </main>
    </div>
  )
}
