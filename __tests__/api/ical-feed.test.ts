const mockContractsFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      contracts: {
        findMany: (...args: unknown[]) => mockContractsFindMany(...args),
      },
    },
  },
}));

const mockGetSetting = jest.fn();
jest.mock("@/lib/db/settings", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

import { GET } from "@/app/api/calendar/feed.ics/route";

function makeReq(token?: string) {
  const url = token !== undefined
    ? `http://localhost/api/calendar/feed.ics?token=${encodeURIComponent(token)}`
    : "http://localhost/api/calendar/feed.ics";
  return new Request(url);
}

describe("GET /api/calendar/feed.ics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 404 when no stored token", async () => {
    mockGetSetting.mockResolvedValue(null);
    const res = await GET(makeReq("anything"));
    expect(res.status).toBe(404);
    expect(mockContractsFindMany).not.toHaveBeenCalled();
  });

  it("returns 404 when token param missing", async () => {
    mockGetSetting.mockResolvedValue("a".repeat(64));
    const res = await GET(makeReq());
    expect(res.status).toBe(404);
  });

  it("returns 404 when token mismatches", async () => {
    mockGetSetting.mockResolvedValue("a".repeat(64));
    const res = await GET(makeReq("b".repeat(64)));
    expect(res.status).toBe(404);
  });

  it("returns 404 when token has different length than stored", async () => {
    mockGetSetting.mockResolvedValue("a".repeat(64));
    const res = await GET(makeReq("short"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with matching token and an event for active contract", async () => {
    const token = "c".repeat(64);
    mockGetSetting.mockResolvedValue(token);
    mockContractsFindMany.mockResolvedValue([
      {
        id: "contract-1",
        name: "Acme SaaS",
        expiryDate: "2026-08-29",
        renewalDate: null,
        noticePeriodDays: 30,
      },
    ]);

    const res = await GET(makeReq(token));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/calendar/);
    const body = await res.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("UID:contract-1-expiry@openrenew");
  });
});
