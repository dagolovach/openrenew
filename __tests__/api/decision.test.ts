// __tests__/api/decision.test.ts
import { PATCH } from "@/app/api/contracts/[id]/decision/route";

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
    },
  };
});

const CONTRACT_ID = "123e4567-e89b-12d3-a456-426614174000";

function makeReq(body: unknown, raw = false): Request {
  return new Request(`http://localhost/api/contracts/${CONTRACT_ID}/decision`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

function callPatch(body: unknown, raw = false) {
  return PATCH(makeReq(body, raw), { params: Promise.resolve({ id: CONTRACT_ID }) });
}

describe("PATCH /api/contracts/[id]/decision", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns 401 when unauthenticated", async () => {
    mockRequireUser.mockResolvedValue(null);
    const res = await callPatch({ decision: "canceling" });
    expect(res.status).toBe(401);
  });

  test("returns 404 when contract not found", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue(undefined);
    const res = await callPatch({ decision: "canceling" });
    expect(res.status).toBe(404);
  });

  test("returns 400 for empty body", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch({});
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid decision value", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch({ decision: "bogus" });
    expect(res.status).toBe(400);
  });

  test("returns 400 for snooze_days of 0", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch({ snooze_days: 0 });
    expect(res.status).toBe(400);
  });

  test("returns 400 for non-JSON body", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch("not json", true);
    expect(res.status).toBe(400);
  });

  test("decision:canceling updates renewalDecision and clears snoozedUntil", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch({ decision: "canceling" });
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });

    expect(mockUpdateContractsSet).toHaveBeenCalled();
    const arg = mockUpdateContractsSet.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.renewalDecision).toBe("canceling");
    expect(arg.snoozedUntil).toBeNull();
    expect(arg.updatedAt).toBeInstanceOf(Date);
  });

  test("decision:null clears renewalDecision", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch({ decision: null });
    expect(res.status).toBe(200);

    expect(mockUpdateContractsSet).toHaveBeenCalled();
    const arg = mockUpdateContractsSet.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.renewalDecision).toBeNull();
  });

  test("snooze_days:7 sets snoozedUntil to UTC today + 7", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockContractsFindFirst.mockResolvedValue({ id: CONTRACT_ID });
    const res = await callPatch({ snooze_days: 7 });
    expect(res.status).toBe(200);

    const expected = new Date();
    expected.setUTCHours(0, 0, 0, 0);
    expected.setUTCDate(expected.getUTCDate() + 7);
    const expectedStr = expected.toISOString().slice(0, 10);

    expect(mockUpdateContractsSet).toHaveBeenCalled();
    const arg = mockUpdateContractsSet.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.snoozedUntil).toBe(expectedStr);
  });
});
