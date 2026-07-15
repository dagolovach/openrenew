import { ImageResponse } from 'next/og'

export const runtime = 'edge'

export const alt = 'OpenRenew — contract renewal tracking for ops and finance teams'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '1200px',
          height: '630px',
          background: '#0A0F1E',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          padding: '80px',
          fontFamily: 'monospace',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '40px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '8px',
              background: '#10B981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              fontWeight: '700',
              color: '#0A0F1E',
              marginRight: '8px',
            }}
          >
            O
          </div>
          <span style={{ fontSize: '40px', fontWeight: '700', color: '#F9FAFB' }}>penRenew</span>
        </div>
        <div
          style={{
            fontSize: '56px',
            fontWeight: '700',
            color: '#F9FAFB',
            lineHeight: '1.1',
            marginBottom: '24px',
            maxWidth: '900px',
          }}
        >
          Stop getting surprised by vendor renewals.
        </div>
        <div style={{ fontSize: '24px', color: '#9CA3AF', maxWidth: '700px' }}>
          AI-powered contract tracking for ops and finance teams.
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '80px',
            right: '80px',
            fontSize: '18px',
            color: '#10B981',
          }}
        >
          OpenRenew
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
