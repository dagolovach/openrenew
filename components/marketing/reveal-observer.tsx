"use client";

import { useEffect } from "react";

export default function RevealObserver() {
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    if (prefersReducedMotion) {
      document.querySelectorAll(".reveal").forEach((el) => {
        el.classList.add("in");
      });
      document.querySelectorAll("[data-hero-stagger]").forEach((el) => {
        (el as HTMLElement).style.opacity = "1";
        (el as HTMLElement).style.transform = "none";
      });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        // Yield to user interactions before applying class changes
        const schedule =
          typeof requestIdleCallback !== "undefined"
            ? requestIdleCallback
            : (cb: () => void) => setTimeout(cb, 0);
        schedule(() => {
          visible.forEach((entry) => {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          });
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );

    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

    // Hero stagger — use requestIdleCallback to avoid competing with interactions
    document.querySelectorAll("[data-hero-stagger]").forEach((el) => {
      const delay = parseInt(
        (el as HTMLElement).dataset.heroStagger || "0",
        10
      );
      setTimeout(() => {
        const schedule =
          typeof requestIdleCallback !== "undefined"
            ? requestIdleCallback
            : (cb: () => void) => cb();
        schedule(() => {
          (el as HTMLElement).style.opacity = "1";
          (el as HTMLElement).style.transform = "translateY(0) scale(1)";
        });
      }, delay);
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
