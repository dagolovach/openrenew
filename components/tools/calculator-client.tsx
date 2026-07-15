'use client'

import { useState, useEffect, useRef } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

type YearData = { year: number; cost: number; saved: number }

type Results = {
  year1Cost: number
  yearData: YearData[]
  totalLeak: number
  totalSaved: number
}

// ─── Formatters ──────────────────────────────────────────────────────────────

function formatExact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US')
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + Math.round(n / 1000) + 'k'
  return '$' + Math.round(n).toString()
}

// ─── AnimatedNumber ───────────────────────────────────────────────────────────

function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const startRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    startRef.current = null
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    function tick(now: number) {
      if (startRef.current === null) startRef.current = now
      const elapsed = now - startRef.current
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(value * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value, duration])

  return <>{formatExact(display)}</>
}

// ─── ProjectionChart ──────────────────────────────────────────────────────────

function ProjectionChart({ data, maxVal }: { data: YearData[]; maxVal: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
      {data.map((d) => {
        const barHeight = Math.max(4, (d.cost / maxVal) * 120)
        const greenHeight = barHeight * 0.7
        const redHeight = barHeight * 0.3

        return (
          <div
            key={d.year}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            {/* Bar container */}
            <div
              style={{
                height: 120,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                width: '100%',
              }}
            >
              <div
                style={{
                  height: barHeight,
                  display: 'flex',
                  flexDirection: 'column',
                  width: '100%',
                  borderRadius: '2px 2px 0 0',
                  overflow: 'hidden',
                }}
              >
                {/* Green top portion (70% = potential savings) */}
                <div
                  style={{
                    height: greenHeight,
                    background: 'linear-gradient(to bottom, #10B981, rgba(16,185,129,0.7))',
                    flexShrink: 0,
                  }}
                />
                {/* Red bottom portion (30% = unavoidable loss) */}
                <div
                  style={{
                    height: redHeight,
                    background: 'linear-gradient(to top, #EF4444, rgba(239,68,68,0.7))',
                    flexShrink: 0,
                  }}
                />
              </div>
            </div>

            {/* Year label */}
            <div
              style={{
                marginTop: 6,
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains), monospace',
                color: '#6B7280',
              }}
            >
              Y{d.year}
            </div>

            {/* Amount label */}
            <div
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains), monospace',
                color: '#9CA3AF',
              }}
            >
              {formatCompact(d.cost)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CalculatorClient() {
  const [contractValue, setContractValue] = useState('')
  const [increase, setIncrease] = useState('')
  const [days, setDays] = useState('')
  const [calculated, setCalculated] = useState(false)
  const [results, setResults] = useState<Results | null>(null)
  const [btnHovered, setBtnHovered] = useState(false)
  const [ctaHovered, setCtaHovered] = useState(false)

  const isEnabled =
    contractValue !== '' &&
    increase !== '' &&
    days !== '' &&
    parseFloat(contractValue) > 0 &&
    parseFloat(increase) > 0 &&
    parseFloat(days) > 0

  function handleCalculate() {
    const cv = parseFloat(contractValue)
    const inc = parseFloat(increase)
    const rate = inc / 100

    const yearData: YearData[] = []
    let totalLeak = 0
    for (let i = 0; i < 5; i++) {
      const cost = cv * Math.pow(1 + rate, i) * rate
      const saved = cost * 0.7
      yearData.push({ year: i + 1, cost, saved })
      totalLeak += cost
    }
    const totalSaved = totalLeak * 0.7

    setResults({ year1Cost: yearData[0].cost, yearData, totalLeak, totalSaved })
    setCalculated(true)
  }

  const daysNum = parseFloat(days)
  const urgencyColor =
    daysNum <= 30 ? '#EF4444' : daysNum <= 60 ? '#F59E0B' : '#10B981'
  const urgencyLabel =
    daysNum <= 30 ? 'URGENT — ACT NOW' : daysNum <= 60 ? 'WINDOW CLOSING' : 'TIME REMAINING'
  const showUrgency = days !== '' && daysNum > 0

  const maxVal = results ? Math.max(...results.yearData.map((d) => d.cost)) : 1

  return (
    <div id="renewal-calc">
      {/* Injected keyframes */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes fadeIn {
              from { opacity: 0; transform: translateY(12px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
            #renewal-calc input:focus { border-color: #10B981 !important; }
            #renewal-calc input::placeholder { color: #4B5563; }
          `,
        }}
      />

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 0, paddingTop: 48 }}>
        <div
          style={{
            fontFamily: 'var(--font-jetbrains), monospace',
            fontSize: 11,
            color: '#10B981',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          FREE TOOL
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-inter), system-ui',
            fontSize: 32,
            fontWeight: 700,
            color: '#F9FAFB',
            margin: '0 0 12px',
          }}
        >
          Hidden Auto-Renewals Calculator
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-inter), system-ui',
            fontSize: 16,
            color: '#9CA3AF',
            maxWidth: 480,
            margin: '0 auto',
            marginBottom: 40,
            lineHeight: 1.6,
          }}
        >
          Find out exactly how much money you&apos;re leaving on the table when you miss a vendor
          renewal window.
        </p>
      </div>

      {/* Input card */}
      <div
        style={{
          background: '#111827',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 8,
          padding: 24,
          maxWidth: 520,
          margin: '0 auto',
        }}
      >
        {/* Field 1: Annual contract value */}
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: '#9CA3AF',
              fontFamily: 'var(--font-inter), system-ui',
              marginBottom: 6,
            }}
          >
            Annual contract value ($)
          </label>
          <input
            type="number"
            placeholder="e.g. 48000"
            value={contractValue}
            onChange={(e) => setContractValue(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: '#F9FAFB',
              fontSize: 15,
              fontFamily: 'var(--font-jetbrains), monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Field 2: Auto-renew price increase */}
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: '#9CA3AF',
              fontFamily: 'var(--font-inter), system-ui',
              marginBottom: 6,
            }}
          >
            Auto-renew price increase (%)
          </label>
          <input
            type="number"
            placeholder="e.g. 8"
            value={increase}
            onChange={(e) => setIncrease(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: '#F9FAFB',
              fontSize: 15,
              fontFamily: 'var(--font-jetbrains), monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <p
            style={{
              fontSize: 11,
              color: '#4B5563',
              fontFamily: 'var(--font-inter), system-ui',
              marginTop: 4,
              margin: '4px 0 0',
            }}
          >
            Typical auto-renew increases: 5–15% for SaaS, 3–8% for services
          </p>
        </div>

        {/* Field 3: Days until notice deadline */}
        <div style={{ marginBottom: 0 }}>
          <label
            style={{
              display: 'block',
              fontSize: 13,
              color: '#9CA3AF',
              fontFamily: 'var(--font-inter), system-ui',
              marginBottom: 6,
            }}
          >
            Days until notice deadline
          </label>
          <input
            type="number"
            placeholder="e.g. 45"
            min={0}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 6,
              color: '#F9FAFB',
              fontSize: 15,
              fontFamily: 'var(--font-jetbrains), monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />

          {/* Urgency badge */}
          {showUrgency && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: urgencyColor,
                  marginRight: 6,
                  flexShrink: 0,
                  animation: daysNum <= 30 ? 'pulse 1.2s infinite' : undefined,
                }}
              />
              <span
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-jetbrains), monospace',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: urgencyColor,
                }}
              >
                {urgencyLabel}
              </span>
            </div>
          )}
        </div>

        {/* Calculate button */}
        <button
          onClick={handleCalculate}
          disabled={!isEnabled}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
          style={{
            width: '100%',
            padding: '12px',
            marginTop: 20,
            background: !isEnabled ? '#4B5563' : btnHovered ? '#0ea572' : '#10B981',
            cursor: !isEnabled ? 'not-allowed' : 'pointer',
            color: '#F9FAFB',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'var(--font-inter), system-ui',
            borderRadius: 6,
            border: 'none',
            transition: 'background 0.15s ease',
          }}
        >
          Calculate my hidden auto-renewals
        </button>
      </div>

      {/* Results section */}
      {calculated && results && (
        <div
          style={{
            animation: 'fadeIn 400ms ease forwards',
            marginTop: 24,
            maxWidth: 520,
            margin: '24px auto 0',
          }}
        >
          {/* Card A — Year 1 Leak */}
          <div
            style={{
              background: 'rgba(239,68,68,0.10)',
              borderLeft: '3px solid #EF4444',
              borderRadius: '0 6px 6px 0',
              padding: 20,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains), monospace',
                color: '#EF4444',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              YEAR 1 — IF YOU MISS THIS WINDOW
            </div>
            <div
              style={{
                fontSize: 42,
                fontWeight: 700,
                color: '#EF4444',
                fontFamily: 'var(--font-jetbrains), monospace',
                lineHeight: 1,
              }}
            >
              <AnimatedNumber value={results.year1Cost} />
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#9CA3AF',
                fontFamily: 'var(--font-inter), system-ui',
                marginTop: 4,
              }}
            >
              locked in at {increase}% above your current {formatExact(parseFloat(contractValue))}
              /yr
            </div>
            {daysNum <= 30 && (
              <div
                style={{
                  fontSize: 12,
                  color: '#EF4444',
                  fontWeight: 600,
                  marginTop: 6,
                  fontFamily: 'var(--font-inter), system-ui',
                }}
              >
                You have {Math.round(daysNum)} days to act.
              </div>
            )}
          </div>

          {/* Card B — 5-Year Projection */}
          <div
            style={{
              background: '#111827',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              padding: 20,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontFamily: 'var(--font-jetbrains), monospace',
                color: '#9CA3AF',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              5-YEAR COMPOUNDING PROJECTION
            </div>

            <ProjectionChart data={results.yearData} maxVal={maxVal} />

            {/* Summary row */}
            <div
              style={{
                marginTop: 16,
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontFamily: 'var(--font-jetbrains), monospace',
                  color: '#9CA3AF',
                }}
              >
                Total leak over 5 years:{' '}
                <span style={{ color: '#EF4444', fontWeight: 700 }}>
                  {formatExact(results.totalLeak)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontFamily: 'var(--font-jetbrains), monospace',
                  color: '#9CA3AF',
                }}
              >
                Potential savings:{' '}
                <span style={{ color: '#10B981', fontWeight: 700 }}>
                  {formatExact(results.totalSaved)}
                </span>
              </div>
            </div>

            {/* Legend row */}
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                gap: 16,
                fontSize: 11,
                color: '#6B7280',
                fontFamily: 'var(--font-inter), system-ui',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: '#EF4444',
                    flexShrink: 0,
                  }}
                />
                Compounding cost
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: 2,
                    background: '#10B981',
                    flexShrink: 0,
                  }}
                />
                If you cancel now
              </div>
            </div>
          </div>

          {/* Card C — Context callout */}
          <div
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 6,
              padding: 16,
            }}
          >
            <p
              style={{
                fontSize: 13,
                color: '#9CA3AF',
                fontFamily: 'var(--font-inter), system-ui',
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              At {increase}%, missing this window costs you{' '}
              {formatExact(results.year1Cost)} in year one and compounds to{' '}
              {formatExact(results.totalLeak)} over five years. Most companies have 10–30 contracts
              like this.
            </p>
          </div>
        </div>
      )}

      {/* CTA section */}
      <div
        style={{
          marginTop: 32,
          maxWidth: 520,
          margin: '32px auto 0',
          textAlign: 'center',
        }}
      >
        <a
          href="/login"
          target="_blank"
          rel="noopener noreferrer"
          onMouseEnter={() => setCtaHovered(true)}
          onMouseLeave={() => setCtaHovered(false)}
          style={{
            display: 'block',
            padding: '14px 24px',
            background: ctaHovered ? '#0ea572' : '#10B981',
            color: '#F9FAFB',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'var(--font-inter), system-ui',
            borderRadius: 6,
            textDecoration: 'none',
            textAlign: 'center',
            transition: 'background 0.15s ease',
          }}
        >
          Stop surprises — try OpenRenew free →
        </a>
        <p
          style={{
            fontSize: 12,
            color: '#4B5563',
            fontFamily: 'var(--font-jetbrains), monospace',
            marginTop: 12,
            margin: '12px 0 0',
          }}
        >
          Don&apos;t let this happen to your contracts.
        </p>
        <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "12px" }}>
          OpenRenew does this automatically — and keeps you ahead of every renewal deadline.
          Free for your first 20 contracts.{" "}
          <a href="/pricing" style={{ color: "#10B981", textDecoration: "underline" }}>
            See pricing →
          </a>
        </p>
      </div>
    </div>
  )
}
