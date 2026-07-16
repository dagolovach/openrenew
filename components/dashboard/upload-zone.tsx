// components/dashboard/upload-zone.tsx
"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type DetectedParties = {
  party_a: string | null;
  party_b: string | null;
  confidence: number;
};

type State =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "confirming"; contractId: string; detected: DetectedParties }
  | { status: "error"; message: string };

export default function UploadZone({ aiEnabled }: { aiEnabled: boolean }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [isDragOver, setIsDragOver] = useState(false);
  const [partyA, setPartyA] = useState("");
  const [partyB, setPartyB] = useState("");
  const [submitting, setSubmitting] = useState(false);
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
      setState({ status: "error", message: body.error ?? "Upload failed" });
      return;
    }

    const { contract_id, detected_parties } = await res.json();

    if (!aiEnabled) {
      // No AI means no party-detection/anonymization/extraction pipeline to run — the
      // upload route already lands the contract in the same "manual entry" state used
      // when extraction fails, so route straight there instead of showing the
      // pre-AI-processing party confirmation step.
      setState({ status: "idle" });
      router.push(`/dashboard/review/${contract_id}`);
      return;
    }

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
          border: `1px dashed ${isDragOver ? "#10B981" : "rgba(255,255,255,0.2)"}`,
          borderRadius: "8px",
          background: isDragOver ? "rgba(16,185,129,0.04)" : "transparent",
          cursor: "pointer",
          transition: "all 200ms ease",
          padding: "16px 20px",
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

        {state.status === "uploading" ? (
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
        )}
      </div>
    </div>
  );
}
