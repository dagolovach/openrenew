import { NextRequest } from "next/server";
import { contracts, alerts as alertsTable, activityLog } from "@/lib/db/schema";

// ── Mocks (must be before imports) ─────────────────────
const mockUpdate = jest.fn();
const mockInsert = jest.fn();
const mockSelect = jest.fn();
const mockAlertsFindMany = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      alerts: {
        findMany: (...args: unknown[]) => mockAlertsFindMany(...args),
      },
    },
  },
}));

const mockGetSetting = jest.fn();
jest.mock("@/lib/db/settings", () => ({
  getSetting: (...args: unknown[]) => mockGetSetting(...args),
}));

const mockSendSlackMessage = jest.fn();
jest.mock("@/lib/slack", () => ({
  sendSlackMessage: (...args: unknown[]) => mockSendSlackMessage(...args),
}));

const mockIsSmtpConfigured = jest.fn();
const mockAlertRecipients = jest.fn();
const mockSendEmail = jest.fn();
jest.mock("@/lib/email-smtp", () => ({
  isSmtpConfigured: () => mockIsSmtpConfigured(),
  alertRecipients: () => mockAlertRecipients(),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

// ── Import route AFTER mocks ────────────────────────────
import { GET } from "@/app/api/cron/send-alerts/route";

const CRON_SECRET = "test-secret";

function makeRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/cron/send-alerts", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

/** A chainable mock that resolves `result` whether awaited directly or via a terminal method. */
function chain(result: unknown) {
  const obj: Record<string, unknown> = {};
  const passthrough = ["set", "from", "innerJoin", "orderBy", "values"];
  for (const key of passthrough) {
    obj[key] = jest.fn(() => obj);
  }
  obj.where = jest.fn(() => obj);
  obj.limit = jest.fn(() => Promise.resolve(result));
  obj.returning = jest.fn(() => Promise.resolve(result));
  (obj as { then: unknown }).then = (
    resolve: (v: unknown) => void,
    reject?: (e: unknown) => void
  ) => Promise.resolve(result).then(resolve, reject);
  return obj;
}

const sampleAlert = {
  id: "alert-1",
  alertType: "day_30",
  scheduledFor: "2026-03-21",
  targetDate: "2026-04-20",
  contractId: "contract-1",
  name: "Acme SaaS",
  expiryDate: "2026-04-20",
  renewalDate: null,
  autoRenew: false,
  partyA: "Acme Corp",
  partyB: null,
  contractValue: "£12,000/yr",
  noticePeriodDays: 30,
  annualValue: null,
};

/** Sets up db.update to route contracts-update vs alerts-update calls to distinct mocks. */
function mockUpdateChains({
  expiredIds = [],
}: {
  expiredIds?: Array<{ id: string }>;
} = {}) {
  mockUpdate.mockImplementation((table: unknown) => {
    if (table === contracts) return chain(expiredIds);
    if (table === alertsTable) return chain(undefined);
    return chain(undefined);
  });
}

function mockInsertChains() {
  mockInsert.mockImplementation((table: unknown) => {
    if (table === activityLog) return chain(undefined);
    return chain(undefined);
  });
}

describe("GET /api/cron/send-alerts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.APP_URL = "https://example.com";
    mockUpdateChains();
    mockInsertChains();
    mockGetSetting.mockResolvedValue(null);
    mockIsSmtpConfigured.mockReturnValue(false);
    mockAlertRecipients.mockReturnValue([]);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.APP_URL;
  });

  it("returns 500 when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });

  it("returns 500 when APP_URL is missing", async () => {
    delete process.env.APP_URL;
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });

  it("returns 401 when Authorization header is wrong", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("leaves alerts pending when no delivery channel is configured", async () => {
    mockGetSetting.mockResolvedValue(null);
    mockIsSmtpConfigured.mockReturnValue(false);
    mockAlertRecipients.mockReturnValue([]);
    mockAlertsFindMany.mockResolvedValue([{ id: "a1" }, { id: "a2" }]);

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: 0, failed: 0, total: 0, pending: 2 });
    expect(mockSendSlackMessage).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("returns { sent: 0, failed: 0, total: 0 } when no due alerts and Slack is configured", async () => {
    mockGetSetting.mockResolvedValue("https://hooks.slack.com/services/T/B/x");
    mockSelect.mockReturnValue(chain([]));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: 0, failed: 0, total: 0 });
    expect(mockSendSlackMessage).not.toHaveBeenCalled();
  });

  it("delivers via Slack and marks alerts sent", async () => {
    mockGetSetting.mockResolvedValue("https://hooks.slack.com/services/T/B/x");
    mockSendSlackMessage.mockResolvedValue(true);
    mockSelect.mockReturnValueOnce(chain([sampleAlert])).mockReturnValue(chain([]));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.total).toBe(1);
    expect(mockSendSlackMessage).toHaveBeenCalledTimes(1);
    expect(mockSendSlackMessage.mock.calls[0][0]).toBe("https://hooks.slack.com/services/T/B/x");
    expect(mockSendSlackMessage.mock.calls[0][1]).toContain("Acme SaaS");
  });

  it("delivers via SMTP recipients and marks alerts sent", async () => {
    mockGetSetting.mockResolvedValue(null);
    mockIsSmtpConfigured.mockReturnValue(true);
    mockAlertRecipients.mockReturnValue(["ops@example.com", "finance@example.com"]);
    mockSendEmail.mockResolvedValue(undefined);
    mockSelect.mockReturnValueOnce(chain([sampleAlert])).mockReturnValue(chain([]));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("marks alert failed when all configured channels fail", async () => {
    mockGetSetting.mockResolvedValue("https://hooks.slack.com/services/T/B/x");
    mockSendSlackMessage.mockResolvedValue(false);
    mockSelect.mockReturnValueOnce(chain([sampleAlert])).mockReturnValue(chain([]));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.total).toBe(1);
  });

  it("marks alert sent when Slack fails but SMTP succeeds (at least one channel)", async () => {
    mockGetSetting.mockResolvedValue("https://hooks.slack.com/services/T/B/x");
    mockSendSlackMessage.mockResolvedValue(false);
    mockIsSmtpConfigured.mockReturnValue(true);
    mockAlertRecipients.mockReturnValue(["ops@example.com"]);
    mockSendEmail.mockResolvedValue(undefined);
    mockSelect.mockReturnValueOnce(chain([sampleAlert])).mockReturnValue(chain([]));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
  });

  it("returns 500 when DB query fails", async () => {
    mockGetSetting.mockResolvedValue("https://hooks.slack.com/services/T/B/x");
    mockSelect.mockImplementation(() => {
      throw new Error("DB error");
    });

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });

  it("paginates: full page then partial page stops the loop", async () => {
    mockGetSetting.mockResolvedValue("https://hooks.slack.com/services/T/B/x");
    mockSendSlackMessage.mockResolvedValue(true);

    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      ...sampleAlert,
      id: `alert-p1-${i}`,
    }));
    const partialPage = Array.from({ length: 5 }, (_, i) => ({
      ...sampleAlert,
      id: `alert-p2-${i}`,
    }));

    mockSelect
      .mockReturnValueOnce(chain(fullPage))
      .mockReturnValueOnce(chain(partialPage));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();

    expect(body.total).toBe(105);
    expect(body.sent).toBe(105);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});
