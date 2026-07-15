// __tests__/api/stripe-checkout.test.ts
const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()
const mockProfileUpdate = jest.fn()
const mockCustomersCreate = jest.fn()
const mockSessionsCreate = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: mockProfileSelect,
            })),
          })),
          update: jest.fn(() => ({
            eq: jest.fn(() => mockProfileUpdate()),
          })),
        }
      }
      return {}
    }),
  })),
}))

jest.mock('@/lib/stripe', () => ({
  stripe: {
    customers: { create: mockCustomersCreate },
    checkout: { sessions: { create: mockSessionsCreate } },
  },
}))

import { POST } from '@/app/api/stripe/checkout/route'

function makeReq() {
  return new Request('http://localhost/api/stripe/checkout', { method: 'POST' })
}

describe('POST /api/stripe/checkout', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_PRO_PRICE_ID = 'price_test123'
    process.env.APP_URL = 'https://app.example.com'
  })

  test('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await POST(makeReq())
    expect(res.status).toBe(401)
  })

  test('returns 400 when user is already on Pro', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    mockProfileSelect.mockResolvedValue({
      data: { plan: 'pro', stripe_customer_id: 'cus_123', email: 'a@b.com' },
      error: null,
    })
    const res = await POST(makeReq())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Already on Pro plan')
  })

  test('creates Stripe customer when none exists and returns checkout URL', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    mockProfileSelect.mockResolvedValue({
      data: { plan: 'free', stripe_customer_id: null, email: 'a@b.com' },
      error: null,
    })
    mockCustomersCreate.mockResolvedValue({ id: 'cus_new' })
    mockProfileUpdate.mockResolvedValue({ error: null })
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://checkout.stripe.com/pay/cs_test')
    expect(mockCustomersCreate).toHaveBeenCalledWith({
      email: 'a@b.com',
      metadata: { supabase_user_id: 'u1' },
    })
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { supabase_user_id: 'u1' },
        subscription_data: { metadata: { supabase_user_id: 'u1' } },
      })
    )
  })

  test('skips customer creation when stripe_customer_id exists', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.com' } } })
    mockProfileSelect.mockResolvedValue({
      data: { plan: 'free', stripe_customer_id: 'cus_existing', email: 'a@b.com' },
      error: null,
    })
    mockSessionsCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/pay/cs_test' })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    expect(mockCustomersCreate).not.toHaveBeenCalled()
    expect(mockSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ customer: 'cus_existing' })
    )
  })
})
