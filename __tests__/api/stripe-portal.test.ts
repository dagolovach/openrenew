// __tests__/api/stripe-portal.test.ts
const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()
const mockPortalCreate = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: mockProfileSelect,
        })),
      })),
    })),
  })),
}))

jest.mock('@/lib/stripe', () => ({
  stripe: {
    billingPortal: { sessions: { create: mockPortalCreate } },
  },
}))

import { POST } from '@/app/api/stripe/portal/route'

function makeReq() {
  return new Request('http://localhost/api/stripe/portal', { method: 'POST' })
}

describe('POST /api/stripe/portal', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.APP_URL = 'https://app.example.com'
  })

  test('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  test('returns 400 when no stripe_customer_id', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({
      data: { stripe_customer_id: null },
      error: null,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(400)
  })

  test('returns portal URL for existing customer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({
      data: { stripe_customer_id: 'cus_123' },
      error: null,
    })
    mockPortalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/xxx' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://billing.stripe.com/session/xxx')
    expect(mockPortalCreate).toHaveBeenCalledWith({
      customer: 'cus_123',
      return_url: 'https://app.example.com/dashboard/settings',
    })
  })
})
