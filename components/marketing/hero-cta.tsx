"use client";

import { useState } from "react";

export default function HeroCta() {
  const [hovered, setHovered] = useState(false);

  return (
    <a
      href="/login"
      className="hero-cta-btn"
      style={{
        display: "inline-block",
        background: "#10B981",
        color: "#0A0F1E",
        fontFamily: "var(--font-jetbrains), monospace",
        fontSize: "18px",
        fontWeight: "700",
        padding: "18px 44px",
        borderRadius: "10px",
        textDecoration: "none",
        border: "none",
        cursor: "pointer",
        letterSpacing: "-0.01em",
        transition: "opacity 150ms ease, transform 100ms ease",
        opacity: hovered ? 0.88 : 1,
        transform: hovered ? "translateY(-2px)" : "translateY(0)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Get started free →
    </a>
  );
}
