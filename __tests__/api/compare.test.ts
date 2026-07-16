// __tests__/api/compare.test.ts
import { POST } from "@/app/api/compare/route";

const mockRequireUser = jest.fn();
const mockContractsFindFirst = jest.fn();
const mockTriggerComparison = jest.fn();

jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

jest.mock("@/lib/comparison", () => ({
  triggerComparison: (...args: unknown[]) => mockTriggerComparison(...args),
}));

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      contracts: { findFirst: (...args: unknown[]) => mockContractsFindFirst(...args) },
    },
  },
}));

function makeReq(body: object) {
  return new Request("http://localhost/api/compare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const contractId = "123e4567-e89b-12d3-a456-426614174000";
const parentId = "223e4567-e89b-12d3-a456-426614174000";

describe("POST /api/compare — ANTHROPIC_API_KEY guard", () => {
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
    expect(mockTriggerComparison).not.toHaveBeenCalled();
  });

  test("proceeds past the guard when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: contractId, parentContractId: parentId });
    mockTriggerComparison.mockResolvedValue({ field_changes: [], clause_changes: [], summary: "" });

    const res = await POST(makeReq({ contract_id: contractId }));
    expect(res.status).toBe(200);
    expect(mockTriggerComparison).toHaveBeenCalledWith(contractId, parentId, "u1");
  });
});
