"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

const navLinks = [
  { href: "/blog", label: "Blog", prefix: "/blog" },
  { href: "/resources", label: "Resources", prefix: "/resources" },
  { href: "/pricing", label: "Pricing", prefix: "/pricing" },
  { href: "/faq", label: "FAQ", prefix: "/faq" },
];

export default function MarketingNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 768) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  const ctaHref = "/login";
  const ctaText = "Get started free";

  return (
    <>
      <nav>
        <div className="wrap">
          <div className="nav-inner">
            <Link href="/" className="logo">
              <Logo theme="dark" size="md" />
            </Link>

            <div className="nav-links">
              {navLinks.map((link) => (
                <a
                  key={link.prefix}
                  href={link.href}
                  className="nav-link"
                  style={pathname.startsWith(link.prefix) ? { color: "var(--accent)" } : undefined}
                >
                  {link.label}
                </a>
              ))}
            </div>

            <a
              href={ctaHref}
              className="nav-cta-desktop"
              style={{
                display: "inline-block",
                background: "#10B981",
                color: "#0A0F1E",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "13px",
                fontWeight: "700",
                padding: "10px 20px",
                borderRadius: "6px",
                textDecoration: "none",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}
            >
              {ctaText}
            </a>

            {/* Mobile hamburger */}
            <button
              className="mobile-nav-toggle"
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
            >
              <span className={`hamburger ${menuOpen ? "open" : ""}`}>
                <span />
                <span />
                <span />
              </span>
            </button>
          </div>
        </div>
      </nav>

      {menuOpen && (
        <div className="mobile-nav-overlay" onClick={() => setMenuOpen(false)}>
          <div className="mobile-nav-menu" onClick={(e) => e.stopPropagation()}>
            {navLinks.map((link) => (
              <a
                key={link.prefix}
                href={link.href}
                className="mobile-nav-link"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <a
              href={ctaHref}
              className="mobile-nav-cta"
              onClick={() => setMenuOpen(false)}
              style={{
                display: "block",
                textAlign: "center",
                background: "#10B981",
                color: "#0A0F1E",
                fontFamily: "var(--font-jetbrains), monospace",
                fontSize: "15px",
                fontWeight: "700",
                padding: "14px 24px",
                borderRadius: "8px",
                textDecoration: "none",
                border: "none",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {ctaText}
            </a>
          </div>
        </div>
      )}
    </>
  );
}
