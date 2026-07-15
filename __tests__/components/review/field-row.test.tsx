/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import FieldRow from "@/components/review/field-row";
import type { DateWarning } from "@/lib/utils";

const baseProps = {
  fieldName: "expiry_date" as const,
  label: "Expiry Date",
  extractedValue: "2026-01-01",
  confidence: 0.95,
  wasEdited: false,
  confirmedValue: null,
  resolution: { value: null, isResolved: false },
  onResolve: () => {},
  isManual: false,
};

describe("FieldRow warning prop", () => {
  test("no warning prop — warning element is NOT rendered", () => {
    render(<FieldRow {...baseProps} />);
    expect(screen.queryByText("⚠", { exact: false })).toBeNull();
  });

  test("amber warning — renders warning div with correct message text and amber colour (#FCD34D)", () => {
    const warning: DateWarning = {
      field: "expiry_date",
      message: "Expiry date is before effective date",
      severity: "amber",
    };
    render(<FieldRow {...baseProps} warning={warning} />);

    const messageEl = screen.getByText(warning.message);
    expect(messageEl).toBeInTheDocument();

    // The warning <div> wrapping the ⚠ span and the message text
    const warningDiv = messageEl.closest("div");
    expect(warningDiv).not.toBeNull();
    expect(warningDiv).toHaveStyle({ color: "#FCD34D" });
  });

  test("red warning — renders warning div with correct message text and red colour (#FCA5A5)", () => {
    const warning: DateWarning = {
      field: "expiry_date",
      message: "Renewal date is after expiry date",
      severity: "red",
    };
    render(<FieldRow {...baseProps} warning={warning} />);

    const messageEl = screen.getByText(warning.message);
    expect(messageEl).toBeInTheDocument();

    const warningDiv = messageEl.closest("div");
    expect(warningDiv).not.toBeNull();
    expect(warningDiv).toHaveStyle({ color: "#FCA5A5" });
  });
});

describe("FieldRow date picker", () => {
  test("date field renders <input type='date'>", () => {
    render(
      <FieldRow
        {...baseProps}
        fieldName="effective_date"
        label="Effective date"
        extractedValue="2025-01-01"
        resolution={{ value: null, isResolved: false }}
        isManual={true}
      />
    );
    const input = screen.getByDisplayValue("2025-01-01");
    expect(input).toHaveAttribute("type", "date");
  });

  test("T-suffix is stripped — input shows YYYY-MM-DD not blank", () => {
    render(
      <FieldRow
        {...baseProps}
        fieldName="expiry_date"
        label="Expiry date"
        extractedValue="2026-06-15T00:00:00"
        resolution={{ value: null, isResolved: false }}
        isManual={true}
      />
    );
    const input = screen.getByDisplayValue("2026-06-15");
    expect(input).toHaveAttribute("type", "date");
  });

  test("non-date field still renders <input type='text'>", () => {
    render(
      <FieldRow
        {...baseProps}
        fieldName="party_a"
        label="Party A"
        extractedValue="Acme Corp"
        resolution={{ value: null, isResolved: false }}
        isManual={true}
      />
    );
    const input = screen.getByDisplayValue("Acme Corp");
    expect(input).toHaveAttribute("type", "text");
  });

  test("re-entry path: T-suffix stripped after dismiss and re-open", async () => {
    const user = userEvent.setup();
    render(
      <FieldRow
        {...baseProps}
        fieldName="renewal_date"
        label="Renewal date"
        extractedValue="2027-03-01T00:00:00"
        resolution={{ value: null, isResolved: false }}
        isManual={false}
        confidence={0.95}
      />
    );

    // Starts in display mode (green/high-confidence). Click edit button.
    const editButton = screen.getByRole("button", { name: "✎" });
    await user.click(editButton);

    // Now in edit mode — input should show stripped date, not blank
    const input = screen.getByDisplayValue("2027-03-01");
    expect(input).toHaveAttribute("type", "date");
  });
});
