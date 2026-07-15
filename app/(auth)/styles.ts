// Shared inline style objects for the (auth) route group.
// Inline styles only — no Tailwind classes (Decision 004).
export const authStyles: Record<string, React.CSSProperties> = {
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
}

export function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = '#10B981'
  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(16,185,129,0.12)'
}

export function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
  e.currentTarget.style.boxShadow = 'none'
}
