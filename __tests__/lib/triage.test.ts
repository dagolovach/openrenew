import { buildTriageQueue, nextUp, type TriageContract } from "@/lib/triage";

const TODAY = new Date("2026-07-16T12:00:00Z");

function contract(overrides: Partial<TriageContract>): TriageContract {
  return {
    id: "c1", name: "Acme", party_a: "Acme Inc.", party_b: "Us LLC",
    status: "active", annual_value: 12000,
    expiry_date: null, renewal_date: null, notice_period_days: null,
    snoozed_until: null, renewal_decision: null,
    ...overrides,
  };
}

describe("buildTriageQueue", () => {
  it("prefers the notice deadline over expiry", () => {
    const q = buildTriageQueue(
      [contract({ expiry_date: "2026-08-20", notice_period_days: 30 })], TODAY);
    expect(q).toHaveLength(1);
    expect(q[0].decision_kind).toBe("notice_deadline");
    expect(q[0].decision_date).toBe("2026-07-21");
    expect(q[0].days_left).toBe(5);
    expect(q[0].urgency).toBe("critical");
  });
  it("uses expiry when no notice period", () => {
    const q = buildTriageQueue([contract({ expiry_date: "2026-08-01" })], TODAY);
    expect(q[0].decision_kind).toBe("expiry");
    expect(q[0].days_left).toBe(16);
    expect(q[0].urgency).toBe("warning");
  });
  it("uses renewal date when set and distinct from expiry", () => {
    const q = buildTriageQueue(
      [contract({ expiry_date: "2026-12-01", renewal_date: "2026-08-01" })], TODAY);
    expect(q[0].decision_kind).toBe("renewal");
    expect(q[0].decision_date).toBe("2026-08-01");
  });
  it("applies the 30-day window boundary", () => {
    expect(buildTriageQueue([contract({ expiry_date: "2026-08-15" })], TODAY)).toHaveLength(1); // 30 days: included
    expect(buildTriageQueue([contract({ expiry_date: "2026-08-16" })], TODAY)).toHaveLength(0); // 31 days: excluded
  });
  it("includes overdue and pins most-overdue first", () => {
    const q = buildTriageQueue([
      contract({ id: "a", expiry_date: "2026-07-10" }),
      contract({ id: "b", expiry_date: "2026-07-01" }),
      contract({ id: "c", expiry_date: "2026-07-20" }),
    ], TODAY);
    expect(q.map((i) => i.contract_id)).toEqual(["b", "a", "c"]);
    expect(q[0].urgency).toBe("overdue");
    expect(q[0].days_left).toBe(-15);
  });
  it("excludes snoozed (today or future) but includes past snoozes", () => {
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", snoozed_until: "2026-07-16" })], TODAY)).toHaveLength(0);
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", snoozed_until: "2026-07-15" })], TODAY)).toHaveLength(1);
  });
  it("excludes decided, non-active, and dateless contracts", () => {
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", renewal_decision: "canceling" })], TODAY)).toHaveLength(0);
    expect(buildTriageQueue([contract({ expiry_date: "2026-07-20", status: "expired" })], TODAY)).toHaveLength(0);
    expect(buildTriageQueue([contract({})], TODAY)).toHaveLength(0);
  });
  it("skips malformed dates without throwing", () => {
    expect(buildTriageQueue([contract({ expiry_date: "not-a-date" })], TODAY)).toHaveLength(0);
  });
});

describe("nextUp", () => {
  it("returns the nearest decision point beyond the 30-day window", () => {
    const item = nextUp([
      contract({ id: "far", expiry_date: "2026-12-01" }),
      contract({ id: "near", expiry_date: "2026-10-01" }),
    ], TODAY);
    expect(item?.contract_id).toBe("near");
    expect(item?.days_left).toBe(77);
  });
  it("returns null when nothing is beyond the window", () => {
    expect(nextUp([contract({ expiry_date: "2026-07-20" })], TODAY)).toBeNull();
  });
});
