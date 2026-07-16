// __tests__/api/extract.test.ts
import { POST } from "@/app/api/extract/route";
import { NextRequest } from "next/server";

// after() requires a Next.js request scope unavailable in Jest — mock as no-op
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: jest.fn(),
}));

const mockRequireUser = jest.fn();
const mockContractsFindFirst = jest.fn();
const mockUpdateContractsSet = jest.fn();

jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

jest.mock("@/lib/db", () => {
  const actualSchema = jest.requireActual("@/lib/db/schema");
  return {
    db: {
      query: {
        contracts: { findFirst: (...args: unknown[]) => mockContractsFindFirst(...args) },
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
        throw new Error("unexpected update table in test mock");
      },
      insert: () => {
        throw new Error("unexpected insert in test mock");
      },
    },
  };
});

function makeReq(body: object) {
  return new NextRequest("http://localhost/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const contractId = "123e4567-e89b-12d3-a456-426614174000";

describe("POST /api/extract — ANTHROPIC_API_KEY guard", () => {
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

    const res = await POST(makeReq({ contract_id: contractId }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("ai_disabled");
    expect(mockContractsFindFirst).not.toHaveBeenCalled();
  });

  test("proceeds past the guard when ANTHROPIC_API_KEY is set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({
      id: contractId,
      status: "party_review",
      filePath: `${contractId}/original.pdf`,
      partyA: null,
      partyB: null,
    });

    const res = await POST(makeReq({ contract_id: contractId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processing");
    expect(mockUpdateContractsSet).toHaveBeenCalled();
  });
});
