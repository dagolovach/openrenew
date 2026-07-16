// __tests__/api/analyse.test.ts
import { POST } from "@/app/api/analyse/route";

const mockRequireUser = jest.fn();
const mockContractsFindFirst = jest.fn();
const mockTriggerAnalysis = jest.fn();

jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

jest.mock("@/lib/analysis", () => ({
  triggerAnalysis: (...args: unknown[]) => mockTriggerAnalysis(...args),
}));

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      contracts: { findFirst: (...args: unknown[]) => mockContractsFindFirst(...args) },
    },
  },
}));

function makeReq(body: object) {
  return new Request("http://localhost/api/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const contractId = "123e4567-e89b-12d3-a456-426614174000";

describe("POST /api/analyse — ANTHROPIC_API_KEY guard", () => {
  const originalKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  test("returns 503 ai_disabled when ANTHROPIC_API_KEY is unset", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    mockRequireUser.mockResolvedValue({ id: "u1" });

    const res = await POST(makeReq({ contract_id: contractId }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("ai_disabled");
    expect(mockTriggerAnalysis).not.toHaveBeenCalled();
  });

  test("proceeds past the guard when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: contractId });
    mockTriggerAnalysis.mockResolvedValue({ findings: [] });

    const res = await POST(makeReq({ contract_id: contractId }));
    expect(res.status).toBe(200);
    expect(mockTriggerAnalysis).toHaveBeenCalledWith(contractId, "u1");
  });
});
