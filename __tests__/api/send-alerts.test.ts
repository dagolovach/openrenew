import { NextRequest } from 'next/server';

// ── Mocks (must be before imports) ─────────────────────
const mockFrom = jest.fn();
const mockAdminClient = { from: mockFrom };

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockAdminClient),
}));

const mockResendSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockResendSend },
  })),
}));

// ── Import route AFTER mocks ────────────────────────────
import { GET } from '@/app/api/cron/send-alerts/route';

const CRON_SECRET = 'test-secret';

function makeRequest(authHeader?: string) {
  return new NextRequest('http://localhost/api/cron/send-alerts', {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

const sampleAlert = {
  id: 'alert-1',
  alert_type: 'day_30',
  scheduled_for: '2026-03-21',
  target_date: '2026-04-20',
  contract_id: 'contract-1',
  user_id: 'user-1',
  contracts: {
    name: 'Acme SaaS',
    expiry_date: '2026-04-20',
    renewal_date: null,
    auto_renew: false,
    party_a: 'Acme Corp',
    party_b: null,
    contract_value: '£12,000/yr',
    notice_period_days: 30,
  },
  profiles: { email: 'user@example.com' },
};

/** Build a mock query chain that includes .order() between .eq() and .limit() */
function makeQueryChain(resolvedValue: { data: unknown; error: unknown }) {
  const chain = {
    select: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(resolvedValue),
  };
  return chain;
}

describe('GET /api/cron/send-alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CRON_SECRET = CRON_SECRET;
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.APP_URL = 'https://getrenewl.com';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
    delete process.env.APP_URL;
  });

  it('returns 500 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });

  it('returns 500 when APP_URL is missing', async () => {
    delete process.env.APP_URL;
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is missing', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns { sent: 0, failed: 0, total: 0 } when no due alerts', async () => {
    // First call returns empty list (breaks the loop), second is the activity_log insert
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'alerts' && callCount === 0) {
        callCount++;
        return makeQueryChain({ data: [], error: null });
      }
      if (table === 'activity_log') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ sent: 0, failed: 0, total: 0 });
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it('sends emails for due alerts and marks them sent', async () => {
    // The batch has 1 alert (< PAGE_SIZE=100), so the loop breaks after one fetch.
    // mockFrom must handle: alerts query, alerts update (mark sent), activity_log insert.
    const mockUpdateEq = jest.fn().mockResolvedValue({ error: null });
    const mockInsertResult = { error: null };

    mockFrom.mockImplementation((table: string) => {
      if (table === 'alerts') {
        // Distinguish select calls from update calls by whether select() is accessed
        const obj = {
          select: jest.fn(() => {
            return makeQueryChain({ data: [sampleAlert], error: null });
          }),
          update: jest.fn().mockReturnValue({ eq: mockUpdateEq }),
        };
        return obj;
      }
      if (table === 'activity_log') {
        return { insert: jest.fn().mockResolvedValue(mockInsertResult) };
      }
      return {};
    });

    mockResendSend.mockResolvedValue({ id: 'email-1' });

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.sent).toBe(1);
    expect(body.failed).toBe(0);
    expect(body.total).toBe(1);
    expect(mockResendSend).toHaveBeenCalledTimes(1);
  });

  it('marks alert failed when Resend throws', async () => {
    const mockUpdateEq = jest.fn().mockResolvedValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'alerts') {
        return {
          select: jest.fn(() => makeQueryChain({ data: [sampleAlert], error: null })),
          update: jest.fn().mockReturnValue({ eq: mockUpdateEq }),
        };
      }
      if (table === 'activity_log') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return {};
    });

    mockResendSend.mockRejectedValue(new Error('Resend unavailable'));

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    const body = await res.json();
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(1);
    expect(body.total).toBe(1);
  });

  it('returns 500 when DB query fails', async () => {
    const mockChain = makeQueryChain({ data: null, error: { message: 'DB error' } });
    mockFrom.mockReturnValue(mockChain);

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(500);
  });
});
