// components/review/field-panel.tsx
"use client";

import { useState, useRef, useEffect, useCallback, useTransition, useMemo } from "react";
import FieldRow, { FieldName, Resolution } from "./field-row";
import { validateDateOrder } from "@/lib/utils";
import type { DateWarning } from "@/lib/utils";

export const FIELD_ORDER: Array<{ name: FieldName; label: string; hint?: string }> = [
  { name: "party_a",             label: "PARTY A (VENDOR / PROVIDER)", hint: "Vendor, supplier, landlord, or employer" },
  { name: "party_b",             label: "PARTY B (CUSTOMER / CLIENT)", hint: "Customer, tenant, or employee" },
  { name: "effective_date",      label: "Effective date" },
  { name: "expiry_date",         label: "Expiry date" },
  { name: "renewal_date",        label: "Renewal date" },
  { name: "auto_renew",          label: "Auto renew" },
  { name: "notice_period_days",  label: "Notice period (days)" },
  { name: "notice_period_text",  label: "Notice period" },
  { name: "contract_value",      label: "Contract value" },
];

type ExtractionRow = {
  field_name: string;
  extracted_value: string | null;
  confirmed_value: string | null;
  confidence: number | null;
  was_edited: boolean;
};

type Props = {
  name: string; category: string;
  extractions: ExtractionRow[];
  onConfirm: (p: { name: string; category: string; fields: Record<string, string | null> }) => void;
  isConfirming: boolean;
  isManual: boolean;
};

function formatName(raw: string): string {
  const formatted = raw
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return formatted || raw.replace(/-/g, " ").trim() || "Untitled";
}

type ConfirmPhase = 'idle' | 'saving' | 'analysing';

export default function FieldPanel({ name: initName, category: initCat, extractions, onConfirm, isConfirming, isManual }: Props) {
  const [name, setName] = useState(() => isManual ? initName : formatName(initName));
  const extractedCategory = extractions.find((e) => e.field_name === "category")?.extracted_value;
  const [category, setCategory] = useState(extractedCategory ?? initCat);
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>('idle');

  useEffect(() => {
    if (!isConfirming) {
      setConfirmPhase('idle');
      return;
    }
    setConfirmPhase('saving');
    const timer = setTimeout(() => setConfirmPhase('analysing'), 2000);
    return () => clearTimeout(timer);
  }, [isConfirming]);

  // Initialize resolution.value from confirmed_value (if previously resolved in DB) or extracted_value.
  // For "Not applicable" (was_edited=true, confirmed_value=null), use null explicitly.
  const [resolutions, setResolutions] = useState<Record<FieldName, Resolution>>(() => {
    const map = {} as Record<FieldName, Resolution>;
    for (const { name: fn } of FIELD_ORDER) {
      const row = extractions.find((e) => e.field_name === fn);
      const wasResolvedInDb = !!(row && (row.was_edited || row.confirmed_value !== null));
      map[fn] = {
        value: wasResolvedInDb ? (row!.confirmed_value) : (row?.extracted_value ?? null),
        isResolved: false,
      };
    }
    return map;
  });

  const [, startTransition] = useTransition();

  const resolve = useCallback((fn: FieldName, value: string | null) => {
    // Mark as non-urgent so browser can paint the click response before re-rendering
    startTransition(() => {
      setResolutions((p) => ({ ...p, [fn]: { value, isResolved: true } }));
    });
  }, [startTransition]);

  // Compute the effective value for a date field — mirrors handleConfirm resolution logic
  function getDateValue(fn: "effective_date" | "renewal_date" | "expiry_date"): string | null {
    const row = extractions.find((e) => e.field_name === fn);
    if (resolutions[fn].isResolved) return resolutions[fn].value;
    return row?.confirmed_value ?? row?.extracted_value ?? null;
  }

  const dateWarnings = useMemo(() => validateDateOrder({
    effective_date: getDateValue("effective_date"),
    renewal_date:   getDateValue("renewal_date"),
    expiry_date:    getDateValue("expiry_date"),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [
    resolutions.effective_date?.value,
    resolutions.renewal_date?.value,
    resolutions.expiry_date?.value,
  ]);

  const warningByField = useMemo(() => Object.fromEntries(
    dateWarnings.map((w) => [w.field, w])
  ) as Partial<Record<"effective_date" | "renewal_date" | "expiry_date", DateWarning>>, [dateWarnings]);

  const nameRef = useRef<HTMLInputElement>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (isManual) nameRef.current?.focus();
  }, [isManual]);

  // Fields that need explicit user action: amber/red, not yet resolved in DB or this session
  const unresolvedAmberRed = useMemo(() => FIELD_ORDER.filter(({ name: fn }) => {
    const row = extractions.find((e) => e.field_name === fn);
    if (!row) return false;
    if (row.was_edited || row.confirmed_value !== null) return false; // resolved in DB
    if ((row.confidence ?? 0) >= 0.9) return false; // green — no action needed
    return !resolutions[fn].isResolved;
  }), [extractions, resolutions]);

  function handleConfirm() {
    if (!name.trim() || (isManual && name.trim() === "New Contract")) {
      setNameError("Please give this contract a name");
      nameRef.current?.focus();
      return;
    }
    setNameError(null);

    const fields: Record<string, string | null> = {};
    for (const { name: fn } of FIELD_ORDER) {
      const row = extractions.find((e) => e.field_name === fn);
      const wasResolvedInDb = !!(row && (row.was_edited || row.confirmed_value !== null));
      if (resolutions[fn].isResolved) {
        fields[fn] = resolutions[fn].value;
      } else if (wasResolvedInDb) {
        fields[fn] = row!.confirmed_value;
      } else {
        fields[fn] = row?.extracted_value ?? null;
      }
    }
    onConfirm({ name, category, fields });
  }

  const inputStyle: React.CSSProperties = {
    fontSize: "13px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: "6px",
    padding: "8px 10px",
    color: "#F9FAFB",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: "10px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "#4B5563",
    marginBottom: "4px",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label style={labelStyle}>Contract name</label>
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(null); }}
          style={{
            ...inputStyle,
            ...(nameError ? { borderColor: "#EF4444" } : {}),
          }}
        />
        {nameError && (
          <p style={{ fontSize: "11px", color: "#EF4444", marginTop: "4px" }}>{nameError}</p>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <label style={labelStyle}>Category</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
          <option value="saas">SaaS</option>
          <option value="lease">Lease</option>
          <option value="vendor">Vendor</option>
          <option value="employment">Employment</option>
          <option value="other">Other</option>
        </select>
      </div>

      {FIELD_ORDER.map(({ name: fn, label, hint }) => {
        const row = extractions.find((e) => e.field_name === fn);
        const isDateField = fn === "effective_date" || fn === "renewal_date" || fn === "expiry_date";
        return (
          <FieldRow key={fn} fieldName={fn} label={label} hint={hint}
            extractedValue={row?.extracted_value ?? null}
            confidence={row?.confidence ?? 0}
            wasEdited={row?.was_edited ?? false}
            confirmedValue={row?.confirmed_value ?? null}
            resolution={resolutions[fn]}
            onResolve={(v) => resolve(fn, v)}
            isManual={isManual}
            warning={isDateField ? warningByField[fn as "effective_date" | "renewal_date" | "expiry_date"] : undefined}
          />
        );
      })}

      <div style={{ paddingTop: "12px" }}>
        <button
          onClick={handleConfirm}
          disabled={unresolvedAmberRed.length > 0 || isConfirming}
          title={unresolvedAmberRed.length > 0 ? (isManual ? "Save or mark all fields before confirming" : "Resolve highlighted fields first") : undefined}
          style={{
            width: "100%",
            background: unresolvedAmberRed.length > 0 || isConfirming ? "rgba(16,185,129,0.3)" : "#10B981",
            color: unresolvedAmberRed.length > 0 || isConfirming ? "#6B7280" : "#0A0F1E",
            border: "none",
            borderRadius: "8px",
            padding: "12px",
            fontSize: "13px",
            fontWeight: 600,
            cursor: unresolvedAmberRed.length > 0 || isConfirming ? "not-allowed" : "pointer",
            transition: "background 150ms ease",
            fontFamily: "inherit",
          }}
        >
          {confirmPhase === 'analysing' && <span style={{ marginRight: "6px" }}>⚡</span>}
          {confirmPhase === 'idle' && "Confirm & activate alerts"}
          {confirmPhase === 'saving' && "Saving…"}
          {confirmPhase === 'analysing' && "Running AI analysis…"}
        </button>
        {unresolvedAmberRed.length > 0 && (
          <p style={{ fontSize: "11px", textAlign: "center", color: "#4B5563", marginTop: "6px" }}>
            {isManual ? "Save or mark all fields before confirming" : "Resolve highlighted fields first"}
          </p>
        )}
      </div>
    </div>
  );
}
