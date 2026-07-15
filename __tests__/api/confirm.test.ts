// __tests__/api/confirm.test.ts
import { POST } from "@/app/api/confirm/route";
import { NextRequest } from "next/server";

// after() requires a Next.js request scope unavailable in Jest — mock as no-op
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn(),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({ auth: { getUser: mockGetUser }, from: mockFrom })),
}));

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

function makeChain(contractData?: object | null, annualValueRow?: object | null) {
  const deleteChain = { eq: jest.fn().mockReturnThis() };
  const updateChain = { eq: jest.fn().mockResolvedValue({ error: null }) };
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(
      contractData === null
        ? { data: null, error: { message: "not found" } }
        : { data: contractData, error: null }
    ),
    maybeSingle: jest.fn().mockResolvedValue(
      annualValueRow === undefined
        ? { data: null, error: null }  // default: no row
        : { data: annualValueRow, error: null }
    ),
    upsert: jest.fn().mockResolvedValue({ error: null }),
    update: jest.fn().mockReturnValue(updateChain),
    delete: jest.fn().mockReturnValue(deleteChain),
    insert: jest.fn().mockResolvedValue({ error: null }),
  };
}

describe("POST /api/confirm", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeReq({ contract_id: "123e4567-e89b-12d3-a456-426614174000", name: "T", category: "saas", fields: validFields }));
    expect(res.status).toBe(401);
  });

  test("returns 404 when contract not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockReturnValue(makeChain(null));
    const res = await POST(makeReq({ contract_id: "00000000-0000-0000-0000-000000000000", name: "T", category: "saas", fields: validFields }));
    expect(res.status).toBe(404);
  });


  test("returns 400 when fields contains invalid key", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockFrom.mockReturnValue(makeChain({ id: "c1", status: "draft" }));
    const res = await POST(makeReq({
      contract_id: "123e4567-e89b-12d3-a456-426614174000", name: "T", category: "saas",
      fields: { ...validFields, confidence: 0.99 }, // invalid
    }));
    expect(res.status).toBe(400);
  });

  test("logs date_order_warning to activity_log when dates are out of order", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const chain = makeChain({ id: "123e4567-e89b-12d3-a456-426614174001", status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
    mockFrom.mockReturnValue(chain);

    // effective_date > expiry_date — should trigger a red warning
    const badFields = {
      ...validFields,
      effective_date: "2026-01-01",
      expiry_date: "2025-01-01",
    };
    const res = await POST(makeReq({ contract_id: "123e4567-e89b-12d3-a456-426614174001", name: "My Contract", category: "saas", fields: badFields }));
    expect(res.status).toBe(200);

    // Find the date_order_warning insert call
    const insertCalls = chain.insert.mock.calls;
    const warningInsert = insertCalls.find((call: unknown[]) => {
      const arg = call[0] as { event_type?: string };
      return arg?.event_type === "date_order_warning";
    });
    expect(warningInsert).toBeDefined();
    expect(warningInsert[0].metadata.warnings).toHaveLength(1);
    expect(warningInsert[0].metadata.warnings[0].field).toBe("expiry_date");
  });

  test("returns { ok: true } on valid confirm", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return makeChain({ id: contractId, status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
      return makeChain({ id: contractId, status: "draft" });
    });
    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: validFields }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("writes annual_value from extraction row when present", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1)
        return makeChain(
          { id: contractId, status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null },
        );
      return makeChain(
        { id: contractId, status: "draft" },
        { extracted_value: "144000", confirmed_value: null }
      );
    });

    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: validFields }));
    expect(res.status).toBe(200);

    let updateArg: Record<string, unknown> | null = null;
    for (const result of mockFrom.mock.results) {
      const chain = result.value as ReturnType<typeof makeChain>;
      if (chain?.update?.mock?.calls?.length > 0) {
        updateArg = chain.update.mock.calls[0][0] as Record<string, unknown>;
        break;
      }
    }
    expect(updateArg).not.toBeNull();
    expect(updateArg!.annual_value).toBe(144000);
  });

  test("falls back to contract_value / term when extraction row has no annual_value", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1)
        return makeChain({ id: contractId, status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
      return makeChain({ id: contractId, status: "draft" }, null);
    });

    // validFields has effective_date=2025-01-01, expiry_date=2026-12-31 (~2 years)
    // contract_value="£12,000/yr" — numeric portion = 12000; 12000 / ~2 ≈ 6000
    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: validFields }));
    expect(res.status).toBe(200);

    let updateArg: Record<string, unknown> | null = null;
    for (const result of mockFrom.mock.results) {
      const chain = result.value as ReturnType<typeof makeChain>;
      if (chain?.update?.mock?.calls?.length > 0) {
        updateArg = chain.update.mock.calls[0][0] as Record<string, unknown>;
        break;
      }
    }
    expect(updateArg).not.toBeNull();
    // 12000 / ~2 years ≈ 6000 (allow ±50 for rounding)
    expect(updateArg!.annual_value).toBeCloseTo(6000, -2);
  });

  test("omits annual_value from UPDATE when not computable", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const contractId = "123e4567-e89b-12d3-a456-426614174000";
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1)
        return makeChain({ id: contractId, status: "draft", expiry_date: null, renewal_date: null, effective_date: null, notice_period_days: null });
      return makeChain({ id: contractId, status: "draft" }, null);
    });

    const fieldsNoValue = { ...validFields, contract_value: null };
    const res = await POST(makeReq({ contract_id: contractId, name: "My Contract", category: "saas", fields: fieldsNoValue }));
    expect(res.status).toBe(200);

    let updateArg: Record<string, unknown> | null = null;
    for (const result of mockFrom.mock.results) {
      const chain = result.value as ReturnType<typeof makeChain>;
      if (chain?.update?.mock?.calls?.length > 0) {
        updateArg = chain.update.mock.calls[0][0] as Record<string, unknown>;
        break;
      }
    }
    expect(updateArg).not.toBeNull();
    expect(updateArg!).not.toHaveProperty("annual_value");
  });
});
