interface LogoProps {
  theme?: 'dark' | 'light'
  size?: 'sm' | 'md' | 'lg'
}

export function Logo({ theme = 'dark', size = 'md' }: LogoProps) {
  const sizes = {
    sm: { block: 20, blockFont: 13, font: 18 },
    md: { block: 26, blockFont: 16, font: 22 },
    lg: { block: 34, blockFont: 22, font: 30 },
  }

  const s = sizes[size]
  const textColor = theme === 'dark' ? '#F9FAFB' : '#111827'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
      <div style={{
        width: `${s.block}px`,
        height: `${s.block}px`,
        borderRadius: '4px',
        background: '#10B981',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: `${s.blockFont}px`,
        fontWeight: '700',
        color: '#0A0F1E',
        flexShrink: 0,
      }}>
        R
      </div>
      <span style={{
        fontFamily: 'var(--font-jetbrains), monospace',
        fontSize: `${s.font}px`,
        fontWeight: '700',
        color: textColor,
        letterSpacing: '-0.02em',
      }}>
        enewl
      </span>
    </div>
  )
}
