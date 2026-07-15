"use client";

import { useState, useEffect } from "react";
import { HERO_EXPIRY_DATE } from "@/lib/hero-dates";

function padTwo(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDisplayDate(d: Date): string {
  return d
    .toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase(); // e.g. "20 APR 2026"
}

export { HERO_EXPIRY_DATE, HERO_NOTICE_DATE, HERO_EXPIRY_SHORT, HERO_NOTICE_SHORT } from "@/lib/hero-dates";

export default function HeroCard() {
  const [ticker, setTicker] = useState({ h: "00", m: "00", s: "00" });
  const [clientState, setClientState] = useState<{ expiryDisplay: string; daysLeft: number } | null>(null);

  useEffect(() => {
    const daysLeft = Math.ceil(
      (HERO_EXPIRY_DATE.getTime() - Date.now()) / 86400000
    );

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClientState({
      expiryDisplay: formatDisplayDate(HERO_EXPIRY_DATE),
      daysLeft,
    });

    function tick() {
      const now = new Date();
      const diff = Math.max(0, HERO_EXPIRY_DATE.getTime() - now.getTime());
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTicker({ h: padTwo(h), m: padTwo(m), s: padTwo(s) });
    }

    tick();
    let id: ReturnType<typeof setTimeout>;
    function schedule() {
      id = setTimeout(() => { tick(); schedule(); }, 1000);
    }
    schedule();
    return () => clearTimeout(id);
  }, []);

  const fadeIn: React.CSSProperties = {
    opacity: clientState ? 1 : 0,
    transition: "opacity 0.3s ease",
  };

  const daysColor =
    (clientState?.daysLeft ?? 999) > 60 ? "#10B981" :
    (clientState?.daysLeft ?? 999) >= 30 ? "#F59E0B" :
    "#EF4444";

  return (
    <div>
      {/* ── Element A: Headline card ── */}
      <div
        style={{
          borderTop: "1px solid rgba(255,255,255,0.06)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          borderLeft: `3px solid ${daysColor}`,
          borderRadius: "0 6px 6px 0",
          background: "#111827",
          padding: "24px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "16px",
          }}
        >
          {/* Left: name + parties + notice badge */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: "17px",
                fontWeight: 600,
                color: "#F9FAFB",
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                lineHeight: 1.3,
              }}
            >
              Salesforce Enterprise License
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "#6B7280",
                fontFamily: "var(--font-inter), system-ui, sans-serif",
                marginTop: "4px",
              }}
            >
              Salesforce Inc. ↔ Meridian Technology Group
            </div>
            {/* Notice badge */}
            <div
              style={{
                marginTop: "12px",
                display: "inline-flex",
                alignItems: "center",
                background: "rgba(245,158,11,0.10)",
                border: "1px solid rgba(245,158,11,0.25)",
                borderRadius: "4px",
                padding: "5px 10px",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "11px",
                color: "#F59E0B",
                fontWeight: 600,
              }}
            >
              ⚡ Notice by 1 NOV 2026 · 60d notice
            </div>
          </div>

          {/* Right: days number + expires date */}
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "4px",
                justifyContent: "flex-end",
              }}
            >
              <span
                style={{
                  fontSize: "42px",
                  fontWeight: 700,
                  color: daysColor,
                  fontFamily: "var(--font-jetbrains), monospace",
                  lineHeight: 1,
                }}
              >
                <span style={fadeIn}>{clientState ? clientState.daysLeft : "—"}</span>
              </span>
              <span
                style={{
                  fontSize: "16px",
                  fontWeight: 500,
                  color: daysColor,
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                days
              </span>
            </div>
            <div
              style={{
                fontSize: "10px",
                color: "#6B7280",
                fontFamily: "var(--font-jetbrains), monospace",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginTop: "4px",
                ...fadeIn,
              }}
            >
              {clientState ? `EXPIRES ${clientState.expiryDisplay}` : "EXPIRES —"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Element B: Live ticker ── */}
      <div
        style={{
          background: "rgba(239,68,68,0.04)",
          border: "1px solid rgba(239,68,68,0.12)",
          borderTop: "none",
          borderRadius: "0 0 6px 6px",
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {/* Pulsing dot + TRACKING label */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#10B981",
              flexShrink: 0,
              animation: "pulse 2s ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#10B981",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            Tracking
          </span>
        </div>

        {/* h:m:s ticker */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "2px",
            ...fadeIn,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: "#9CA3AF",
            }}
          >
            {ticker.h}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
            }}
          >
            h
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              color: "#374151",
              margin: "0 2px",
            }}
          >
            :
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: "#9CA3AF",
            }}
          >
            {ticker.m}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
            }}
          >
            m
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "11px",
              color: "#374151",
              margin: "0 2px",
            }}
          >
            :
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              fontWeight: 700,
              color: "#9CA3AF",
            }}
          >
            {ticker.s}
          </span>
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "10px",
              color: "#4B5563",
            }}
          >
            s
          </span>
        </div>
      </div>

      {/* ── Element C: Ghost UI hints ── */}
      <div style={{ marginTop: "8px" }}>
        {/* Collapsed details row */}
        <div
          style={{
            padding: "10px 24px",
            cursor: "default",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <span style={{ fontSize: "11px", color: "#4B5563" }}>▸</span>
          <span
            style={{
              fontSize: "13px",
              color: "#6B7280",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
            }}
          >
            Contract details
          </span>
        </div>

        {/* Contract Intelligence teaser */}
        <div
          style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: "6px",
            padding: "14px 24px",
            cursor: "default",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "11px",
                color: "#10B981",
                textTransform: "uppercase",
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              Analysis
            </span>
            <span
              style={{
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "10px",
                color: "#4B5563",
              }}
            >
              ▸ SHOW
            </span>
          </div>
          <p
            style={{
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: "10px",
              color: "#4B5563",
              margin: "8px 0 0",
              lineHeight: 1.4,
            }}
          >
            For informational purposes only. Not legal advice.
          </p>
        </div>
      </div>
    </div>
  );
}
