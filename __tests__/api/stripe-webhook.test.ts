// __tests__/api/stripe-webhook.test.ts
const mockAdminUpdate = jest.fn().mockResolvedValue({ error: null })
const mockAdminEq = jest.fn(() => mockAdminUpdate())
const mockAdminFrom = jest.fn(() => ({
  update: jest.fn(() => ({ eq: mockAdminEq })),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: mockAdminFrom,
  })),
}))

const mockConstructEvent = jest.fn()
jest.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: { constructEvent: mockConstructEvent },
  },
}))

function makeReq(body: string, sig = 'valid-sig') {
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': sig },
    body,
  })
}

describe('POST /api/webhooks/stripe', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  })

  test('returns 400 when stripe-signature header is missing', async () => {
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      body: '{}',
      // No stripe-signature header
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  test('returns 400 on invalid signature', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Invalid signature')
    })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq('{}'))
    expect(res.status).toBe(400)
  })

  test('handles checkout.session.completed — sets plan to pro', async () => {
    // Note: Stripe delivers session.metadata in the webhook, NOT subscription_data.metadata
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_123',
          metadata: { supabase_user_id: 'u1' }, // top-level session metadata
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', stripe_subscription_id: 'sub_123' })
    )
  })

  test('handles checkout.session.completed — ignores non-subscription mode', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'payment',
          subscription: null,
          metadata: { supabase_user_id: 'u1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  test('handles customer.subscription.deleted — sets plan to free', async () => {
    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_123',
          status: 'canceled',
          metadata: { supabase_user_id: 'u1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free', stripe_subscription_id: null })
    )
  })

  test('handles customer.subscription.updated — sets plan to pro when active', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'active',
          metadata: { supabase_user_id: 'u1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'pro', stripe_subscription_id: 'sub_123' })
    )
  })

  test('handles customer.subscription.updated — sets plan to free when not active', async () => {
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'past_due',
          metadata: { supabase_user_id: 'u1' },
        },
      },
    }
    mockConstructEvent.mockReturnValue(event)
    const mockUpdate = jest.fn(() => ({ eq: jest.fn().mockResolvedValue({ error: null }) }))
    mockAdminFrom.mockReturnValue({ update: mockUpdate })

    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq(JSON.stringify(event)))
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ plan: 'free', stripe_subscription_id: null })
    )
  })

  test('returns 200 for unhandled event types', async () => {
    mockConstructEvent.mockReturnValue({ type: 'payment_intent.created', data: { object: {} } })
    const { POST } = await import('@/app/api/webhooks/stripe/route')
    const res = await POST(makeReq('{}'))
    expect(res.status).toBe(200)
  })
})
