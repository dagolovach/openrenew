// __tests__/lib/alerts.test.ts
import { buildAlerts } from "@/lib/alerts";

const TODAY = new Date("2026-03-21T00:00:00Z");

const base = {
  id: "c1",
  user_id: "u1",
  expiry_date: null as string | null,
  renewal_date: null as string | null,
  effective_date: null as string | null,
  notice_period_days: null as number | null,
};

describe("buildAlerts", () => {
  test("returns empty array when no dates", () => {
    expect(buildAlerts(base, TODAY)).toEqual([]);
  });

  test("generates 3 tier alerts from expiry_date", () => {
    const alerts = buildAlerts({ ...base, expiry_date: "2026-12-31" }, TODAY);
    const types = alerts.map((a) => a.alert_type);
    expect(types).toEqual(expect.arrayContaining(["day_60", "day_30", "day_7"]));
    expect(alerts).toHaveLength(3);
  });

  test("scheduled_for dates are correct", () => {
    const alerts = buildAlerts({ ...base, expiry_date: "2026-12-31" }, TODAY);
    const byType = Object.fromEntries(alerts.map((a) => [a.alert_type, a]));
    expect(byType.day_60.scheduled_for).toBe("2026-11-01");
    expect(byType.day_30.scheduled_for).toBe("2026-12-01");
    expect(byType.day_7.scheduled_for).toBe("2026-12-24");
    expect(alerts.every((a) => a.target_date === "2026-12-31")).toBe(true);
  });

  test("generates separate renewal alerts when renewal_date differs from expiry_date", () => {
    const alerts = buildAlerts(
      { ...base, expiry_date: "2026-12-31", renewal_date: "2026-10-31" },
      TODAY
    );
    expect(alerts).toHaveLength(6);
    expect(alerts.filter((a) => a.target_date === "2026-10-31")).toHaveLength(3);
  });

  test("generates renewal alerts when expiry_date IS NULL", () => {
    const alerts = buildAlerts({ ...base, renewal_date: "2026-12-31" }, TODAY);
    expect(alerts).toHaveLength(3);
    expect(alerts.every((a) => a.target_date === "2026-12-31")).toBe(true);
  });

  test("no duplicate alerts when renewal_date equals expiry_date", () => {
    const alerts = buildAlerts(
      { ...base, expiry_date: "2026-12-31", renewal_date: "2026-12-31" },
      TODAY
    );
    expect(alerts).toHaveLength(3);
  });

  test("generates notice_deadline alert with correct dates", () => {
    const alerts = buildAlerts(
      { ...base, expiry_date: "2026-12-31", notice_period_days: 30, effective_date: "2026-01-01" },
      TODAY
    );
    const nd = alerts.find((a) => a.alert_type === "notice_deadline");
    expect(nd).toBeDefined();
    expect(nd!.target_date).toBe("2026-12-01");   // expiry - 30 days
    expect(nd!.scheduled_for).toBe("2026-11-24"); // deadline - 7 days
  });

  test("skips notice_deadline when scheduled_for < effective_date", () => {
    // expiry 2026-05-01 - 60d = 2026-03-02, fires 2026-02-23 < effective_date 2026-03-01 → skip
    const alerts = buildAlerts(
      { ...base, expiry_date: "2026-05-01", notice_period_days: 60, effective_date: "2026-03-01" },
      TODAY
    );
    expect(alerts.find((a) => a.alert_type === "notice_deadline")).toBeUndefined();
  });

  test("renewal alerts are preserved even when notice_deadline is disqualified", () => {
    // Regression: early return bug would discard renewal alerts if notice_deadline is skipped
    const alerts = buildAlerts(
      {
        ...base,
        expiry_date: "2026-05-01",
        renewal_date: "2026-12-31",
        notice_period_days: 60,
        effective_date: "2026-03-01", // disqualifies notice_deadline
      },
      TODAY
    );
    expect(alerts.find((a) => a.alert_type === "notice_deadline")).toBeUndefined();
    // Renewal alerts must still be present despite notice_deadline being skipped
    expect(alerts.filter((a) => a.target_date === "2026-12-31")).toHaveLength(3);
  });

  test("skips all alerts where scheduled_for <= today", () => {
    // expiry 2026-03-15 — all tier alerts are in the past
    expect(buildAlerts({ ...base, expiry_date: "2026-03-15" }, TODAY)).toHaveLength(0);
  });

  test("skips only past alerts, keeps future ones", () => {
    // expiry 2026-05-01: day_60 fires 2026-03-02 (past), day_30/7 in future
    const alerts = buildAlerts({ ...base, expiry_date: "2026-05-01" }, TODAY);
    expect(alerts.map((a) => a.alert_type)).not.toContain("day_60");
    expect(alerts.map((a) => a.alert_type)).toContain("day_30");
    expect(alerts.map((a) => a.alert_type)).toContain("day_7");
  });

  test("sets correct contract_id and user_id on all rows", () => {
    const alerts = buildAlerts({ ...base, expiry_date: "2026-12-31" }, TODAY);
    expect(alerts.every((a) => a.contract_id === "c1" && a.user_id === "u1")).toBe(true);
  });

  test("all rows have status pending", () => {
    const alerts = buildAlerts({ ...base, expiry_date: "2026-12-31" }, TODAY);
    expect(alerts.every((a) => a.status === "pending")).toBe(true);
  });
});
