// __tests__/api/finding-action.test.ts
import { POST } from "@/app/api/finding-action/route";

const mockRequireUser = jest.fn();
const mockContractsFindFirst = jest.fn();
const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      contracts: { findFirst: (...args: unknown[]) => mockContractsFindFirst(...args) },
    },
  },
}));

const contractId = "123e4567-e89b-12d3-a456-426614174000";

const validBody = {
  contract_id: contractId,
  findings: [
    { category: "auto_renewal", title: "Auto-renews", explanation: "Renews automatically", action: "Cancel by X" },
  ],
  contract_context: {
    name: "Acme SaaS",
    party_a: "Acme",
    party_b: "Vendor",
    expiry_date: "2026-12-31",
    renewal_date: null,
    notice_period_days: 30,
    contract_value: "$1,000",
    category: "saas",
    notice_window_closed: false,
  },
};

function makeReq(body: object) {
  return new Request("http://localhost/api/finding-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/finding-action — ANTHROPIC_API_KEY guard", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;
  const originalSecret = process.env.EXTRACTION_SERVICE_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXTRACTION_SERVICE_SECRET = "test-secret";
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
    if (originalSecret === undefined) delete process.env.EXTRACTION_SERVICE_SECRET;
    else process.env.EXTRACTION_SERVICE_SECRET = originalSecret;
  });

  test("returns 503 ai_disabled when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockRequireUser.mockResolvedValue({ id: "u1" });

    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("ai_disabled");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("proceeds past the guard when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: contractId });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ subject: "Subject", body: "Body" }),
    });

    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalled();
  });
});
