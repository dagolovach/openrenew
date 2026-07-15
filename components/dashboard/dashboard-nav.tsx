"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { Logo } from "@/components/ui/Logo";
import LogoutButton from "@/components/dashboard/logout-button";

interface DashboardNavProps {
  userEmail: string;
  userId: string;
}

const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/dashboard/calendar", label: "Calendar", exact: false },
  { href: "/dashboard/settings", label: "Settings", exact: false },
];

export default function DashboardNav({ userEmail, userId }: DashboardNavProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 640) setMenuOpen(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [menuOpen]);

  useEffect(() => {
    if (userId) {
      posthog.identify(userId, { email: userEmail });
    }
  }, [userId, userEmail]);

  function isActive(href: string, exact: boolean) {
    return exact ? pathname === href : pathname.startsWith(href);
  }

  return (
    <>
      <header className="dash-header">
        <div className="dash-header-inner">
          <Logo theme="dark" size="md" />

          {/* Desktop nav items */}
          <div className="dash-nav-desktop">
            {NAV_LINKS.map(({ href, label, exact }) => (
              <Link
                key={href}
                href={href}
                className="dash-nav-link"
                style={isActive(href, exact) ? { color: "#F9FAFB" } : undefined}
              >
                {label}
              </Link>
            ))}
            <span className="dash-nav-email">{userEmail}</span>
            <LogoutButton />
          </div>

          {/* Mobile hamburger */}
          <button
            className="dash-mobile-toggle"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
          >
            <span className={`dash-hamburger ${menuOpen ? "open" : ""}`}>
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </header>

      {/* Mobile overlay */}
      {menuOpen && (
        <div className="dash-mobile-overlay" onClick={() => setMenuOpen(false)}>
          <div className="dash-mobile-menu" onClick={(e) => e.stopPropagation()}>
            <div className="dash-mobile-email">{userEmail}</div>
            {NAV_LINKS.map(({ href, label, exact }) => (
              <Link
                key={href}
                href={href}
                className="dash-mobile-link"
                style={isActive(href, exact) ? { color: "#F9FAFB" } : undefined}
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </Link>
            ))}
            <div className="dash-mobile-logout">
              <LogoutButton />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
