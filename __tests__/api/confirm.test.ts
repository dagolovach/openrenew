// __tests__/api/confirm.test.ts
import { POST } from "@/app/api/confirm/route";
import { NextRequest } from "next/server";

// after() requires a Next.js request scope unavailable in Jest — mock as no-op
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn(),
}));

jest.mock("@/lib/analysis", () => ({
  triggerAnalysis: jest.fn().mockResolvedValue({ findings: [] }),
}));

const mockRequireUser = jest.fn();
const mockContractsFindFirst = jest.fn();
const mockContractExtractionsFindFirst = jest.fn();
const mockInsertContractExtractions = jest.fn();
const mockInsertAlerts = jest.fn();
const mockInsertActivityLog = jest.fn();
const mockUpdateContractsSet = jest.fn();
const mockUpdateAlertsSet = jest.fn();

jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

jest.mock("@/lib/db", () => {
  const actualSchema = jest.requireActual("@/lib/db/schema");
  return {
    db: {
      query: {
        contracts: { findFirst: (...args: unknown[]) => mockContractsFindFirst(...args) },
        contractExtractions: { findFirst: (...args: unknown[]) => mockContractExtractionsFindFirst(...args) },
      },
      insert: (table: unknown) => {
        if (table === actualSchema.contractExtractions) {
          return {
            values: (...args: unknown[]) => {
              mockInsertContractExtractions(...args);
              return { onConflictDoUpdate: jest.fn().mockResolvedValue(undefined) };
            },
          };
        }
        if (table === actualSchema.alerts) {
          return {
            values: (...args: unknown[]) => {
              mockInsertAlerts(...args);
              return { onConflictDoNothing: jest.fn().mockResolvedValue(undefined) };
            },
          };
        }
        if (table === actualSchema.activityLog) {
          return {
            values: (...args: unknown[]) => {
              mockInsertActivityLog(...args);
              return Promise.resolve(undefined);
            },
          };
        }
        throw new Error("unexpected insert table in test mock");
      },
      update: (table: unknown) => {
        if (table === actualSchema.contracts) {
          return {
            set: (...args: unknown[]) => {
              mockUpdateContractsSet(...args);
              return { where: jest.fn().mockResolvedValue(undefined) };
            },
          };
        }
        if (table === actualSchema.alerts) {
          return {
            set: (...args: unknown[]) => {
              mockUpdateAlertsSet(...args);
              return { where: jest.fn().mockResolvedValue(undefined) };
            },
          };
        }
        throw new Error("unexpected update table in test mock");
      },
    },
  };
});

// buildAlerts is pure — no need to mock it
function makeReq(body: object) {
  return new NextRequest("http://localhost/api/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validFields = {
  party_a: "Acme Corp", party_b: null, effective_date: "2025-01-01",
  expiry_date: "2026-12-31", renewal_date: null, auto_renew: true,
  notice_period_days: 30, notice_period_text: "30 days notice",
  contract_value: "£12,000/yr",
};

describe("POST /api/confirm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockContractExtractionsFindFirst.mockResolvedValue(undefined);
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(null);
    const res = await POST(makeReq({ contract_id: "123e4567-e89b-12d3-a456-426614174000", name: "T", category: "saas", fields: validFields }));
    expect(res.status).toBe(401);
  });

  test("returns 404 when contract not found", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue(undefined);
    const res = await POST(makeReq({ contract_id: "00000000-0000-0000-0000-000000000000", name: "T", category: "saas", fields: validFields }));
    expect(res.status).toBe(404);
  });


  test("returns 400 when fields contains invalid key", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: "c1", status: "draft" });
    const res = await POST(makeReq({
      contract_id: "123e4567-e89b-12d3-a456-426614174000", name: "T", category: "saas",
      fields: { ...validFields, confidence: 0.99 }, // invalid
    }));
    expect(res.status).toBe(400);
  });

  test("logs date_order_warning to activity_log when dates are out of order", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({
      id: "123e4567-e89b-12d3-a456-426614174001", status: "draft",
      expiryDate: null, renewalDate: null, effectiveDate: null, noticePeriodDays: null,
    });

    // effective_date > expiry_date — should trigger a red warning
    const badFields = {
      ...validFields,
      effective_date: "2026-01-01",
      expiry_date: "2025-01-01",
    };
    const res = await POST(makeReq({ contract_id: "123e4567-e89b-12d3-a456-426614174001", name: "My Contract", category: "saas", fields: badFields }));
    expect(res.status).toBe(200);

    // Find the date_order_warning insert call
    const insertCalls = mockInsertActivityLog.mock.calls;
    const warningInsert = insertCalls.find((call: unknown[]) => {
      const arg = call[0] as { eventType?: string };
      return arg?.eventType === "date_order_warning";
    });
    expect(warningInsert).toBeDefined();
    expect(warningInsert[0].metadata.warnings).toHaveLength(1);
    expect(warningInsert[0].metadata.warnings[0].field).toBe("expiry_date");
  });

  test("returns { ok: true } on valid confirm", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    mockContractsFindFirst.mockResolvedValue({
      id: contractId, status: "draft",
      expiryDate: null, renewalDate: null, effectiveDate: null, noticePeriodDays: null,
    });
    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: validFields }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("writes annual_value from extraction row when present", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    mockContractsFindFirst.mockResolvedValue({
      id: contractId, status: "draft",
      expiryDate: null, renewalDate: null, effectiveDate: null, noticePeriodDays: null,
    });
    mockContractExtractionsFindFirst.mockResolvedValue({ extractedValue: "144000", confirmedValue: null });

    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: validFields }));
    expect(res.status).toBe(200);

    expect(mockUpdateContractsSet).toHaveBeenCalled();
    const updateArg = mockUpdateContractsSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg.annualValue).toBe(144000);
  });

  test("falls back to contract_value / term when extraction row has no annual_value", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    mockContractsFindFirst.mockResolvedValue({
      id: contractId, status: "draft",
      expiryDate: null, renewalDate: null, effectiveDate: null, noticePeriodDays: null,
    });
    mockContractExtractionsFindFirst.mockResolvedValue(undefined);

    // validFields has effective_date=2025-01-01, expiry_date=2026-12-31 (~2 years)
    // contract_value="£12,000/yr" — numeric portion = 12000; 12000 / ~2 ≈ 6000
    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: validFields }));
    expect(res.status).toBe(200);

    expect(mockUpdateContractsSet).toHaveBeenCalled();
    const updateArg = mockUpdateContractsSet.mock.calls[0][0] as Record<string, unknown>;
    // 12000 / ~2 years ≈ 6000 (allow ±50 for rounding)
    expect(updateArg.annualValue).toBeCloseTo(6000, -2);
  });

  test("omits annual_value from UPDATE when not computable", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    mockContractsFindFirst.mockResolvedValue({
      id: contractId, status: "draft",
      expiryDate: null, renewalDate: null, effectiveDate: null, noticePeriodDays: null,
    });
    mockContractExtractionsFindFirst.mockResolvedValue(undefined);

    const fieldsNoValue = { ...validFields, contract_value: null };
    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: fieldsNoValue }));
    expect(res.status).toBe(200);

    expect(mockUpdateContractsSet).toHaveBeenCalled();
    const updateArg = mockUpdateContractsSet.mock.calls[0][0] as Record<string, unknown>;
    expect(updateArg).not.toHaveProperty("annualValue");
  });
});
