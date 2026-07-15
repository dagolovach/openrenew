// components/review/field-row.tsx
"use client";

import React, { useState } from "react";
import type { DateWarning } from "@/lib/utils";

export type FieldName =
  | "party_a" | "party_b" | "effective_date" | "expiry_date" | "renewal_date"
  | "auto_renew" | "notice_period_days" | "notice_period_text" | "contract_value";

const DATE_FIELDS = ["effective_date", "renewal_date", "expiry_date"] as const;

/** Strip any time component from an ISO string so <input type="date"> doesn't go blank. */
function stripDate(value: string): string {
  return value.split("T")[0];
}

export type Resolution = { value: string | null; isResolved: boolean };

type Props = {
  fieldName: FieldName;
  label: string;
  hint?: string;
  extractedValue: string | null;
  confidence: number;
  wasEdited: boolean;
  confirmedValue: string | null;
  resolution: Resolution;
  onResolve: (value: string | null) => void;
  isManual: boolean;
  warning?: DateWarning;
};

function colorState(confidence: number, wasEdited: boolean, confirmedValue: string | null) {
  if (wasEdited || confirmedValue !== null) return "blue";
  if (confidence >= 0.9) return "green";
  if (confidence >= 0.7) return "amber";
  return "red";
}

const THEME = {
  blue:    { border: "#3B82F6", bg: "rgba(59,130,246,0.08)",  label: "#93C5FD" },
  green:   { border: "#10B981", bg: "rgba(16,185,129,0.08)",  label: "#6EE7B7" },
  amber:   { border: "#F59E0B", bg: "rgba(245,158,11,0.08)",  label: "#FCD34D" },
  red:     { border: "#EF4444", bg: "rgba(239,68,68,0.08)",   label: "#FCA5A5" },
  neutral: { border: "rgba(255,255,255,0.12)", bg: "rgba(255,255,255,0.03)", label: "#6B7280" },
};

const inputStyle: React.CSSProperties = {
  fontSize: "13px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "6px",
  padding: "7px 10px",
  color: "#F9FAFB",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

const FieldRow = React.memo(
  function FieldRow({
  fieldName, label, hint, extractedValue, confidence, wasEdited, confirmedValue, resolution, onResolve, isManual, warning
}: Props) {
  const color = isManual
    ? "neutral"
    : (resolution.isResolved ? "blue" : colorState(confidence, wasEdited, confirmedValue));
  const preExpanded = isManual ? true : ((color === "amber" || color === "red") && !resolution.isResolved);
  const isDateField = DATE_FIELDS.includes(fieldName as typeof DATE_FIELDS[number]);
  // Mirror displayVal logic to get the right initial value
  const initialDraftValue = resolution.isResolved
    ? resolution.value
    : (color === "blue" ? confirmedValue : extractedValue);
  const [editing, setEditing] = useState(preExpanded);
  const [draft, setDraft] = useState<string>(
    isDateField && initialDraftValue ? stripDate(initialDraftValue) : (initialDraftValue ?? "")
  );

  const displayVal = resolution.isResolved ? resolution.value : (color === "blue" ? confirmedValue : extractedValue);
  const t = THEME[color];

  return (
    <div style={{
      border: `1px solid ${t.border}`,
      borderRadius: "8px",
      padding: "12px",
      background: t.bg,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
        <div>
          <div style={{
            fontSize: "10px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: t.label,
          }}>
            {label}
          </div>
          {hint && (
            <div style={{ fontSize: "10px", color: "#4B5563", marginTop: "2px" }}>{hint}</div>
          )}
        </div>
        {!wasEdited && confirmedValue === null && confidence > 0 && (
          <div style={{
            fontSize: "10px",
            color: confidence >= 0.9 ? "#6EE7B7" : confidence >= 0.7 ? "#FCD34D" : "#FCA5A5",
            fontFamily: "var(--font-jetbrains), monospace",
            letterSpacing: "0.02em",
          }}>
            {confidence >= 0.9 ? "✓" : "~"} {Math.round(confidence * 100)}%
          </div>
        )}
      </div>

      {!editing ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          {fieldName === "auto_renew" && displayVal !== null ? (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: "5px",
              fontSize: "12px", fontWeight: 600,
              color: displayVal === "true" ? "#10B981" : "#9CA3AF",
              background: displayVal === "true" ? "rgba(16,185,129,0.12)" : "rgba(156,163,175,0.1)",
              border: `1px solid ${displayVal === "true" ? "rgba(16,185,129,0.3)" : "rgba(156,163,175,0.2)"}`,
              borderRadius: "20px", padding: "3px 10px",
            }}>
              <span style={{ fontSize: "8px" }}>●</span>
              {displayVal === "true" ? "Yes — auto-renews" : "No — manual renewal"}
            </span>
          ) : (
            <span style={{ fontSize: "13px", color: displayVal ? "#F9FAFB" : "#4B5563", fontStyle: displayVal ? "normal" : "italic" }}>
              {displayVal ?? "Not found in contract"}
            </span>
          )}
          <button
            onClick={() => {
              const raw = displayVal ?? "";
              setDraft(isDateField ? stripDate(raw) : raw);
              setEditing(true);
            }}
            style={{ fontSize: "13px", color: "#9CA3AF", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", cursor: "pointer", padding: "2px 6px", flexShrink: 0, lineHeight: 1.4 }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "#F9FAFB")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#9CA3AF")}
          >
            ✎
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px" }}>
          {fieldName === "auto_renew" ? (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ ...inputStyle, cursor: "pointer" }}
            >
              <option value="">— select —</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          ) : isDateField ? (
            <input
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ ...inputStyle, colorScheme: "dark" } as React.CSSProperties & { colorScheme: string }}
            />
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Enter value…"
              style={inputStyle}
            />
          )}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <button
              onClick={() => { onResolve(draft.trim() || null); setEditing(false); }}
              style={{ fontSize: "12px", background: "#1F2937", color: "#F9FAFB", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "6px", padding: "5px 12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Save
            </button>
            {extractedValue !== null && !resolution.isResolved && (
              <button
                onClick={() => {
                  const val = isDateField && extractedValue ? stripDate(extractedValue) : extractedValue;
                  onResolve(val);
                  setEditing(false);
                }}
                style={{ fontSize: "12px", background: "rgba(16,185,129,0.15)", color: "#10B981", border: "1px solid rgba(16,185,129,0.3)", borderRadius: "6px", padding: "5px 12px", fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
              >
                Looks good ✓
              </button>
            )}
            <button
              onClick={() => { onResolve(null); setEditing(false); }}
              style={{ fontSize: "12px", background: "none", color: "#6B7280", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "6px", padding: "5px 12px", cursor: "pointer", fontFamily: "inherit" }}
            >
              Not applicable
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{ fontSize: "12px", background: "none", color: "#4B5563", border: "none", cursor: "pointer", padding: "5px 4px", fontFamily: "inherit" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {warning && (
        <div style={{
          fontSize: "11px",
          color: warning.severity === "red" ? "#FCA5A5" : "#FCD34D",
          marginTop: "6px",
          display: "flex",
          alignItems: "center",
          gap: "4px",
        }}>
          <span>⚠</span>
          {warning.message}
        </div>
      )}
    </div>
  );
},
  (prev, next) =>
    prev.fieldName === next.fieldName &&
    prev.label === next.label &&
    prev.hint === next.hint &&
    prev.extractedValue === next.extractedValue &&
    prev.confidence === next.confidence &&
    prev.wasEdited === next.wasEdited &&
    prev.confirmedValue === next.confirmedValue &&
    prev.resolution.value === next.resolution.value &&
    prev.resolution.isResolved === next.resolution.isResolved &&
    prev.isManual === next.isManual &&
    prev.warning?.field === next.warning?.field &&
    prev.warning?.message === next.warning?.message &&
    prev.warning?.severity === next.warning?.severity
  // Note: onResolve is intentionally omitted — fieldName equality above ensures
  // the function always operates on the correct field; skipping it enables memo to work
);

export default FieldRow;
