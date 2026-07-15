/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { RenewalTimeline } from "@/components/RenewalTimeline";

jest.mock("next/link", () => {
  return function Link({
    href,
    children,
    style,
  }: {
    href: string;
    children: React.ReactNode;
    style?: React.CSSProperties;
  }) {
    return (
      <a href={href} style={style}>
        {children}
      </a>
    );
  };
});

const futureDate = (daysFromNow: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().split("T")[0];
};

describe("RenewalTimeline", () => {
  test("empty state — renders prompt when no contracts passed", () => {
    render(<RenewalTimeline contracts={[]} />);
    expect(
      screen.getByText(/No active contracts yet/i)
    ).toBeInTheDocument();
  });

  test("renders contract name", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "1",
            name: "Acme SaaS Agreement",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(180),
            notice_period_days: null,
            annual_value: null,
          },
        ]}
      />
    );
    expect(screen.getByText("Acme SaaS Agreement")).toBeInTheDocument();
  });

  test("renders party names with ↔ separator", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "1",
            name: "Contract",
            party_a: "Acme Corp",
            party_b: "Beta Ltd",
            expiry_date: futureDate(180),
            notice_period_days: null,
            annual_value: null,
          },
        ]}
      />
    );
    expect(screen.getByText("Acme Corp ↔ Beta Ltd")).toBeInTheDocument();
  });

  test("no expiry_date — badge shows em dash", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "1",
            name: "No Expiry Contract",
            party_a: null,
            party_b: null,
            expiry_date: null,
            notice_period_days: null,
            annual_value: null,
          },
        ]}
      />
    );
    // The em dash in the badge column
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  test("annual value >= 1000 formatted as $Xk", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "1",
            name: "Contract",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(180),
            notice_period_days: null,
            annual_value: 48000,
          },
        ]}
      />
    );
    expect(screen.getByText("$48k")).toBeInTheDocument();
  });

  test("annual value < 1000 formatted as $X", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "1",
            name: "Contract",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(180),
            notice_period_days: null,
            annual_value: 500,
          },
        ]}
      />
    );
    expect(screen.getByText("$500")).toBeInTheDocument();
  });

  test("sorts by expiry_date ASC — soonest first", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "2",
            name: "Far Contract",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(300),
            notice_period_days: null,
            annual_value: null,
          },
          {
            id: "1",
            name: "Near Contract",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(30),
            notice_period_days: null,
            annual_value: null,
          },
        ]}
      />
    );
    const names = screen
      .getAllByText(/Contract/)
      .map((el) => el.textContent);
    const nearIndex = names.findIndex((n) => n === "Near Contract");
    const farIndex = names.findIndex((n) => n === "Far Contract");
    expect(nearIndex).toBeLessThan(farIndex);
  });

  test("nulls-last — contract with no expiry appears after contracts with expiry", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "3",
            name: "No Date",
            party_a: null,
            party_b: null,
            expiry_date: null,
            notice_period_days: null,
            annual_value: null,
          },
          {
            id: "1",
            name: "Has Date",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(90),
            notice_period_days: null,
            annual_value: null,
          },
        ]}
      />
    );
    const allRows = screen.getAllByRole("link");
    const texts = allRows.map((el) => el.textContent ?? "");
    const hasDateIndex = texts.findIndex((t) => t.includes("Has Date"));
    const noDateIndex = texts.findIndex((t) => t.includes("No Date"));
    expect(hasDateIndex).toBeLessThan(noDateIndex);
  });

  test("legend row is rendered", () => {
    render(
      <RenewalTimeline
        contracts={[
          {
            id: "1",
            name: "C",
            party_a: null,
            party_b: null,
            expiry_date: futureDate(180),
            notice_period_days: null,
            annual_value: null,
          },
        ]}
      />
    );
    expect(screen.getByText("Expiring within 30 days")).toBeInTheDocument();
    expect(screen.getByText("Notice deadline within 60 days")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("Notice deadline")).toBeInTheDocument();
  });
});
