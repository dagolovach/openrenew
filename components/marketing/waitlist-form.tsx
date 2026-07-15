"use client";

import { useState } from "react";
import { Analytics } from "@/lib/analytics";

interface WaitlistFormProps {
  variant?: "hero" | "cta";
}

export default function WaitlistForm({ variant = "hero" }: WaitlistFormProps) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // Client-side email validation
    if (!email.includes('@') || email.length < 5) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (res.ok) {
        Analytics.waitlistSignup(email);
        setStatus("success");
        setMessage(data.message || "Check your inbox for confirmation!");
        setEmail("");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong.");
      }
    } catch {
      setStatus("error");
      setMessage("Network error. Please try again.");
    }
  }

  const formClass = variant === "cta" ? "cta-form" : "email-row";

  return (
    <form onSubmit={handleSubmit} className={formClass}>
      {status === "success" ? (
        <div>
          <p style={{ color: "var(--accent)", fontFamily: "var(--mono)", fontSize: "0.9rem" }}>
            {message}
          </p>
          <button
            type="button"
            onClick={() => { setStatus("idle"); setMessage(""); }}
            style={{ background: "none", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: "0.8rem", marginTop: "0.5rem", textDecoration: "underline", fontFamily: "var(--mono)" }}
          >
            Subscribe another email
          </button>
        </div>
      ) : (
        <>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            required
            disabled={status === "loading"}
            autoComplete="email"
          />
          <button type="submit" className="btn-solid" disabled={status === "loading"}>
            {status === "loading" ? "Joining…" : "Get early access"}
          </button>
          {status === "error" && (
            <p style={{ color: "var(--danger)", fontFamily: "var(--mono)", fontSize: "0.85rem", marginTop: "0.5rem" }}>
              {message}
            </p>
          )}
        </>
      )}
    </form>
  );
}
