// components/dashboard/settings-client.tsx
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Logo } from '@/components/ui/Logo'
import LogoutButton from '@/components/dashboard/logout-button'

interface Props {
  plan: string
  email: string
  slackWebhookUrl: string | null
}

export default function SettingsClient({ plan, email, slackWebhookUrl }: Props) {
  const searchParams = useSearchParams()
  const [slackUrl, setSlackUrl] = useState(slackWebhookUrl ?? '')
  const [slackStatus, setSlackStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [slackError, setSlackError] = useState('')
  const [billingLoading, setBillingLoading] = useState(false)
  const [showUpgradeBanner, setShowUpgradeBanner] = useState(
    searchParams.get('upgraded') === 'true'
  )

  async function handleManage() {
    setBillingLoading(true)
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setBillingLoading(false)
  }

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

  const isPro = plan === 'pro'

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

  const cardStyle = (active: boolean): React.CSSProperties => ({
    border: `1.5px solid ${active ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.08)'}`,
    borderRadius: '8px',
    padding: '16px 20px',
    flex: 1,
    background: active ? 'rgba(16,185,129,0.05)' : 'transparent',
  })

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

        {/* Upgrade success banner */}
        {showUpgradeBanner && (
          <div
            onClick={() => setShowUpgradeBanner(false)}
            style={{
              background: 'rgba(16,185,129,0.1)',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '24px',
              fontSize: '14px',
              color: '#10B981',
              cursor: 'pointer',
            }}
          >
            ✓ Welcome to Pro. All limits removed.
          </div>
        )}

        {/* Account */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Account</p>
          <p style={{ fontSize: '14px', color: '#9CA3AF' }}>
            <span style={{ color: '#6B7280' }}>Email: </span>{email}
          </p>
        </div>

        {/* Billing */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Billing</p>
          <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
            {/* Free card */}
            <div style={cardStyle(!isPro)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>Free</span>
                {!isPro && <span style={{ fontSize: '11px', color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '4px' }}>Current plan</span>}
              </div>
              <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '4px' }}>Up to 20 contracts</p>
              <p style={{ fontSize: '13px', color: '#6B7280' }}>Email alerts</p>
            </div>
            {/* Pro card */}
            <div style={{ ...cardStyle(isPro), opacity: isPro ? 1 : 0.4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 600 }}>Pro — $49/month</span>
                {isPro
                  ? <span style={{ fontSize: '11px', color: '#10B981', background: 'rgba(16,185,129,0.1)', padding: '2px 8px', borderRadius: '4px' }}>Current plan</span>
                  : <span style={{ fontSize: '11px', color: '#6B7280', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '4px' }}>Coming soon</span>
                }
              </div>
              <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '4px' }}>Unlimited contracts</p>
              <p style={{ fontSize: '13px', color: '#6B7280' }}>Email + Slack alerts</p>
            </div>
          </div>
          {!isPro ? (
            <button
              disabled
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: '#6B7280',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'not-allowed',
                opacity: 0.5,
              }}
            >
              Upgrade to Pro — Coming soon
            </button>
          ) : (
            <button
              onClick={handleManage}
              disabled={billingLoading}
              style={{
                background: 'transparent',
                color: '#9CA3AF',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '6px',
                padding: '8px 20px',
                fontSize: '14px',
                cursor: billingLoading ? 'not-allowed' : 'pointer',
                opacity: billingLoading ? 0.7 : 1,
              }}
            >
              {billingLoading ? 'Redirecting…' : 'Manage subscription →'}
            </button>
          )}
        </div>

        {/* Notifications / Slack */}
        <div style={sectionStyle}>
          <p style={labelStyle}>Notifications</p>
          <p style={{ fontSize: '13px', color: '#6B7280', marginBottom: '12px' }}>
            Slack webhook URL
            {!isPro && <span style={{ color: '#4B5563', marginLeft: '8px' }}>(Pro only)</span>}
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              type="url"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              disabled={!isPro}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '13px',
                color: '#F9FAFB',
                outline: 'none',
                opacity: !isPro ? 0.4 : 1,
              }}
            />
            <button
              onClick={handleSlackSave}
              disabled={!isPro || slackStatus === 'saving'}
              style={{
                background: 'rgba(255,255,255,0.06)',
                color: '#F9FAFB',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '13px',
                cursor: !isPro || slackStatus === 'saving' ? 'not-allowed' : 'pointer',
                opacity: !isPro ? 0.4 : 1,
              }}
            >
              {slackStatus === 'saving' ? 'Saving…' : slackStatus === 'saved' ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          {slackStatus === 'error' && (
            <p style={{ fontSize: '12px', color: '#EF4444' }}>{slackError}</p>
          )}
          {isPro && (
            <a
              href="https://api.slack.com/messaging/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '12px', color: '#4B5563', textDecoration: 'none' }}
            >
              How to get a webhook URL ↗
            </a>
          )}
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
