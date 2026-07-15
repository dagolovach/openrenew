// components/dashboard/upload-zone.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { SubscriptionTier } from "@/lib/subscription";
import { Analytics } from "@/lib/analytics";

type DetectedParties = {
  party_a: string | null;
  party_b: string | null;
  confidence: number;
};

type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "confirming"; contractId: string; detected: DetectedParties }
  | { status: "error"; message: string }
  | { status: "limit_reached" };

export default function UploadZone({ tier, contractCount }: { tier: SubscriptionTier; contractCount: number }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [partyA, setPartyA] = useState("");
  const [partyB, setPartyB] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [contractsRemaining, setContractsRemaining] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFile(file: File) {
    const spreadsheetExts = [".xlsx", ".xls", ".csv"];
    const isSpreadsheet =
      spreadsheetExts.some((ext) => file.name.toLowerCase().endsWith(ext)) ||
      [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
        "text/csv",
      ].includes(file.type);
    if (isSpreadsheet) {
      setState({
        status: "error",
        message:
          "Looks like a spreadsheet. OpenRenew works with one contract per upload right now. Email us at hello@localhost if bulk import would help.",
      });
      return;
    }
    if (file.type !== "application/pdf") {
      setState({ status: "error", message: "Only PDF files are accepted." });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setState({ status: "error", message: "File must be under 20MB." });
      return;
    }
    setState({ status: "uploading" });

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: "Upload failed" }));
      if (res.status === 403 && body.error === 'free_tier_limit') {
        setState({ status: "limit_reached" });
        return;
      }
      setState({ status: "error", message: body.error ?? "Upload failed" });
      return;
    }

    const { contract_id, detected_parties, contracts_remaining } = await res.json();
    if (typeof contracts_remaining === "number") {
      setContractsRemaining(contracts_remaining);
    }
    Analytics.contractUploaded();
    setPartyA(detected_parties?.party_a ?? "");
    setPartyB(detected_parties?.party_b ?? "");
    setState({
      status: "confirming",
      contractId: contract_id,
      detected: detected_parties ?? { party_a: null, party_b: null, confidence: 0 },
    });
  }

  async function handleConfirmParties() {
    if (state.status !== "confirming" || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: state.contractId,
          party_a: partyA.trim() || null,
          party_b: partyB.trim() || null,
        }),
      });
    } finally {
      setState({ status: "idle" });
      setPartyA("");
      setPartyB("");
      setSubmitting(false);
      router.refresh();
    }
  }

  async function handleCancel() {
    if (state.status !== "confirming" || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/contracts/${state.contractId}`, { method: "DELETE" });
    } finally {
      setState({ status: "idle" });
      setPartyA("");
      setPartyB("");
      setSubmitting(false);
      router.refresh();
    }
  }

  async function handleSkipParties() {
    if (state.status !== "confirming" || submitting) return;
    setSubmitting(true);
    try {
      await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contract_id: state.contractId,
          party_a: null,
          party_b: null,
        }),
      });
    } finally {
      setState({ status: "idle" });
      setPartyA("");
      setPartyB("");
      setSubmitting(false);
      router.refresh();
    }
  }

  if (state.status === "confirming") {
    return (
      <div style={{
        background: "#0F172A",
        border: "1.5px solid #334155",
        borderRadius: "8px",
        padding: "24px",
      }}>
        {/* Header */}
        <p style={{ fontSize: "15px", fontWeight: 600, color: "#F1F5F9", margin: "0 0 4px 0" }}>
          Confirm company names
        </p>
        <p style={{ fontSize: "13px", color: "#64748B", margin: "0 0 12px 0" }}>
          These will be stripped from the contract before AI processing
        </p>

        {/* Detection confidence */}
        {state.detected.confidence >= 0.7 && (
          <p style={{ fontSize: "12px", color: "#10B981", margin: "0 0 12px 0" }}>
            ✓ Auto-detected from contract text
          </p>
        )}
        {state.detected.confidence > 0 && state.detected.confidence < 0.7 && (
          <p style={{ fontSize: "12px", color: "#F59E0B", margin: "0 0 12px 0" }}>
            ⚠ Low confidence — please verify
          </p>
        )}
        {state.detected.confidence === 0 && (
          <p style={{ fontSize: "12px", color: "#94A3B8", margin: "0 0 12px 0" }}>
            Could not auto-detect — enter manually (optional)
          </p>
        )}

        {/* Input fields */}
        <div style={{ display: "flex", gap: "12px", marginBottom: "12px" }}>
          <div style={{ flex: 1 }}>
            <label style={{
              display: "block", fontSize: "11px", fontWeight: 600,
              color: "#94A3B8", marginBottom: "4px",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              Your company
            </label>
            <input
              type="text"
              value={partyA}
              onChange={(e) => setPartyA(e.target.value)}
              placeholder="e.g. Acme Inc"
              autoFocus
              style={{
                width: "100%", padding: "8px 12px", fontSize: "14px",
                background: "#1E293B", border: "1px solid #334155",
                borderRadius: "6px", color: "#F1F5F9", outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{
              display: "block", fontSize: "11px", fontWeight: 600,
              color: "#94A3B8", marginBottom: "4px",
              textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              Vendor / counterparty
            </label>
            <input
              type="text"
              value={partyB}
              onChange={(e) => setPartyB(e.target.value)}
              placeholder="e.g. Amazon Web Services"
              style={{
                width: "100%", padding: "8px 12px", fontSize: "14px",
                background: "#1E293B", border: "1px solid #334155",
                borderRadius: "6px", color: "#F1F5F9", outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {/* Privacy note */}
        <p style={{ fontSize: "11px", color: "#64748B", marginBottom: "16px", textAlign: "center" }}>
          🔒 Company names are replaced with &quot;Party A&quot; / &quot;Party B&quot; before AI processing
        </p>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
          <button
            onClick={handleCancel}
            disabled={submitting}
            style={{
              padding: "8px 16px", fontSize: "13px",
              background: "transparent", border: "1px solid #1E293B",
              borderRadius: "6px", color: "#4B5563", cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1, marginRight: "auto",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSkipParties}
            disabled={submitting}
            style={{
              padding: "8px 16px", fontSize: "13px",
              background: "transparent", border: "1px solid #334155",
              borderRadius: "6px", color: "#94A3B8", cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
            }}
          >
            Extract as-is
          </button>
          <button
            onClick={handleConfirmParties}
            disabled={submitting || !partyA.trim() || !partyB.trim()}
            style={{
              padding: "8px 16px", fontSize: "13px",
              background: "#10B981", border: "none",
              borderRadius: "6px", color: "#FFFFFF",
              cursor: (submitting || !partyA.trim() || !partyB.trim()) ? "not-allowed" : "pointer",
              fontWeight: 600, opacity: (submitting || !partyA.trim() || !partyB.trim()) ? 0.5 : 1,
            }}
          >
            {submitting ? "Extracting…" : "Anonymize & extract"}
          </button>
        </div>
      </div>
    );
  }

  const isCompact = contractCount > 0;

  return (
    <div>
      <div
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onClick={() => inputRef.current?.click()}
        style={{
          position: isCompact ? undefined : "relative",
          border: `1px dashed ${isDragOver ? "#10B981" : isCompact ? "rgba(255,255,255,0.2)" : "rgba(16,185,129,0.3)"}`,
          borderRadius: "8px",
          background: isDragOver ? "rgba(16,185,129,0.04)" : isCompact ? "transparent" : "rgba(16,185,129,0.03)",
          cursor: "pointer",
          transition: "all 200ms ease",
          padding: isCompact ? "12px 20px" : "28px 24px",
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {isCompact ? (
          // COMPACT ROW
          state.status === "uploading" ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span
                className="pulse-dot"
                style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#10B981", display: "inline-block", flexShrink: 0 }}
              />
              <span style={{ fontSize: "14px", color: "#10B981", fontFamily: "var(--font-jetbrains), monospace" }}>Uploading…</span>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              {/* Upload icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: isDragOver ? 1 : 0.7 }}>
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
              {/* Primary text */}
              <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: "#F9FAFB" }}>
                Drop a contract PDF here or click to browse
              </span>
              <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "14px", color: "#6B7280" }}>
                · PDF only · max 20MB
              </span>
              {/* Error inline */}
              {state.status === "error" && (
                <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#EF4444" }}>
                  · {state.message}
                </span>
              )}
              {/* Inline note */}
              {state.status !== "error" && (
                <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#6B7280" }}>
                  · Upload a single contract PDF. Bulk import from spreadsheets isn&apos;t supported yet —{" "}
                  <a
                    href="mailto:hello@localhost"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: "#6B7280", textDecoration: "underline" }}
                  >
                    let us know
                  </a>{" "}
                  if you need it.
                </span>
              )}
              {/* Manual link — right aligned */}
              <Link
                href="/dashboard/review/new?manual=1"
                onClick={(e) => e.stopPropagation()}
                style={{ marginLeft: "auto", fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#10B981", textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")}
              >
                Add contract manually →
              </Link>
            </div>
          )
        ) : (
          // FULL LAYOUT
          <>
            {/* Contracts remaining banner — only for free tier */}
            {tier === "free" && contractsRemaining !== null && contractsRemaining <= 5 && contractsRemaining > 0 && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  bottom: "-48px",
                  left: 0,
                  right: 0,
                  background: "#111827",
                  borderLeft: "3px solid #D97706",
                  borderRadius: "0 0 6px 6px",
                  padding: "8px 14px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#D1D5DB" }}>
                  You have {contractsRemaining} free contract{contractsRemaining !== 1 ? "s" : ""} remaining.
                </span>
                <Link
                  href="/pricing"
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#10B981", textDecoration: "underline", whiteSpace: "nowrap" }}
                >
                  Upgrade to Pro →
                </Link>
              </div>
            )}

            {/* Upload arrow icon — hidden while uploading */}
            {state.status !== "uploading" && (
              <div style={{ marginBottom: "10px" }}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#10B981"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ margin: "0 auto", display: "block", opacity: isDragOver ? 1 : 0.7, transition: "opacity 200ms" }}
                >
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
              </div>
            )}

            {state.status === "uploading" ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                <span
                  className="pulse-dot"
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#10B981",
                    display: "inline-block",
                    flexShrink: 0,
                  }}
                />
                <span style={{
                  fontSize: "14px",
                  color: "#10B981",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  Uploading…
                </span>
              </div>
            ) : (
              <>
                <p style={{ fontSize: "14px", fontWeight: 500, color: "#F9FAFB", marginBottom: "4px", textAlign: "center" }}>
                  Drop a contract PDF here
                </p>
                <p style={{ fontSize: "12px", color: "#6B7280", textAlign: "center" }}>
                  or click to browse · PDF only · max 20MB
                </p>
                <p style={{ fontSize: "12px", color: "#6B7280", textAlign: "center", marginTop: "6px" }}>
                  Upload a single contract PDF. Bulk import from spreadsheets isn&apos;t supported yet —{" "}
                  <a
                    href="mailto:hello@localhost"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: "#6B7280", textDecoration: "underline" }}
                  >
                    let us know
                  </a>{" "}
                  if you need it.
                </p>
                {state.status === "error" && (
                  <p style={{ fontSize: "12px", color: "#EF4444", marginTop: "8px", textAlign: "center" }}>
                    {state.message}
                  </p>
                )}
                {state.status === "limit_reached" && (
                  <p style={{ fontSize: "12px", color: "#F59E0B", marginTop: "8px", textAlign: "center" }}>
                    You&apos;ve reached 20 contracts — the free tier limit.{" "}
                    <Link
                      href="/pricing"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "#10B981", textDecoration: "underline" }}
                    >
                      See pricing →
                    </Link>
                  </p>
                )}
                <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "12px", textAlign: "center" }}>
                  Don&apos;t have a PDF?{" "}
                  <Link
                    href="/dashboard/review/new?manual=1"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: "#10B981", textDecoration: "none" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = "none")}
                  >
                    Add contract manually →
                  </Link>
                </p>
              </>
            )}
          </>
        )}
      </div>

      {/* Contracts remaining banner — below the row in compact mode */}
      {isCompact && tier === "free" && contractsRemaining !== null && contractsRemaining <= 5 && contractsRemaining > 0 && (
        <div
          style={{
            background: "#111827",
            borderLeft: "3px solid #D97706",
            borderRadius: "0 0 6px 6px",
            padding: "8px 14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "2px",
          }}
        >
          <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#D1D5DB" }}>
            You have {contractsRemaining} free contract{contractsRemaining !== 1 ? "s" : ""} remaining.
          </span>
          <Link
            href="/pricing"
            style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#10B981", textDecoration: "underline", whiteSpace: "nowrap" }}
          >
            Upgrade to Pro →
          </Link>
        </div>
      )}
    </div>
  );
}
