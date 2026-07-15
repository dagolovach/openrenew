// components/dashboard/delete-contract-dialog.tsx
"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

export default function DeleteContractDialog({
  contractId,
  contractName,
  onClose,
  onDeleted,
}: {
  contractId: string;
  contractName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelHovered, setCancelHovered] = useState(false);
  const [deleteHovered, setDeleteHovered] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
const res = await fetch(`/api/contracts/${contractId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Delete failed");
      setDeleting(false);
      return;
    }
    onDeleted();
  }

  return createPortal(
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.92)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#111827",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "12px",
        padding: "28px",
        maxWidth: "400px",
        width: "calc(100% - 48px)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        <h2 style={{
          margin: "0 0 10px",
          fontSize: "18px",
          fontWeight: 500,
          color: "#F9FAFB",
          letterSpacing: "-0.01em",
        }}>
          Delete contract?
        </h2>
        <p style={{ margin: "0 0 6px", fontSize: "14px", color: "#9CA3AF", lineHeight: "1.5" }}>
          This will delete{" "}
          <span style={{ color: "#D1D5DB", fontWeight: 500 }}>{contractName}</span>
          {" "}and cancel all alerts.
        </p>
        <p style={{ margin: "0 0 24px", fontSize: "13px", color: "#6B7280" }}>
          This cannot be undone.
        </p>

        {error && (
          <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#EF4444" }}>{error}</p>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px" }}>
          <button
            onClick={onClose}
            disabled={deleting}
            onMouseEnter={() => setCancelHovered(true)}
            onMouseLeave={() => setCancelHovered(false)}
            style={{
              padding: "9px 18px",
              fontSize: "14px",
              color: cancelHovered ? "#F9FAFB" : "#9CA3AF",
              background: cancelHovered ? "rgba(255,255,255,0.06)" : "transparent",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "all 150ms ease",
              opacity: deleting ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            onMouseEnter={() => setDeleteHovered(true)}
            onMouseLeave={() => setDeleteHovered(false)}
            style={{
              padding: "9px 18px",
              fontSize: "14px",
              fontWeight: 600,
              color: "#F9FAFB",
              background: deleteHovered ? "#DC2626" : "#EF4444",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              transition: "background 150ms ease",
              opacity: deleting ? 0.7 : 1,
              fontFamily: "inherit",
              minWidth: "80px",
              overflow: "hidden",
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
