"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  contractId: string;
  aiEnabled: boolean;
};

export default function RenewalUploadButton({ contractId, aiEnabled }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(
        "Looks like a spreadsheet. OpenRenew works with one contract per upload right now. Email us at hello@localhost if bulk import would help."
      );
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError("File must be under 20MB");
      return;
    }

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("parent_contract_id", contractId);

      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? "Upload failed");
        return;
      }

      const { contract_id: newContractId } = await res.json() as { contract_id: string };

      // Trigger extraction — skipped when AI is disabled; the upload route already
      // lands the contract in the manual-entry state in that case.
      if (aiEnabled) {
        await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contract_id: newContractId }),
        });
      }

      // Redirect to review screen
      router.push(`/dashboard/review/${newContractId}`);
    } catch {
      setError("Upload failed — please try again");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 14px",
          borderRadius: 6,
          border: "1px solid rgba(16, 185, 129, 0.3)",
          background: "rgba(16, 185, 129, 0.08)",
          color: "#10B981",
          fontSize: 13,
          fontWeight: 600,
          cursor: uploading ? "not-allowed" : "pointer",
          opacity: uploading ? 0.6 : 1,
          transition: "all 0.15s ease",
        }}
      >
        {uploading ? "Uploading…" : "↑ Upload renewal"}
      </button>
      {error && (
        <div style={{
          marginTop: 8,
          fontSize: 12,
          color: "#FCA5A5",
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
