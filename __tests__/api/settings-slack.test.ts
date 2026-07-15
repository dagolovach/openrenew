// __tests__/api/settings-slack.test.ts
const mockGetUser = jest.fn()
const mockProfileUpdate = jest.fn()

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => mockProfileUpdate()),
      })),
    })),
  })),
}))

const mockFetch = jest.fn()
global.fetch = mockFetch

function makeReq(body: object) {
  return new Request('http://localhost/api/settings/slack', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

import { PATCH } from '@/app/api/settings/slack/route'

describe('PATCH /api/settings/slack', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockProfileUpdate.mockResolvedValue({ error: null })
  })

  test('returns 401 when not authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/xxx' }))
    expect(res.status).toBe(401)
  })

  test('returns 400 when URL is not a Slack domain (SSRF guard)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://evil.com/steal-data' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_webhook_url')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  test('returns 400 when webhook URL is unreachable', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFetch.mockResolvedValue({ ok: false, status: 404 })

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/bad' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('webhook_unreachable')
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })

  test('returns 400 when fetch throws (network error)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFetch.mockRejectedValue(new Error('network failure'))

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/bad' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('webhook_unreachable')
  })

  test('saves URL and returns ok when webhook responds 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFetch.mockResolvedValue({ ok: true })

    const res = await PATCH(makeReq({ slack_webhook_url: 'https://hooks.slack.com/valid' }))
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockProfileUpdate).toHaveBeenCalled()
  })

  test('clears URL when null is passed (no fetch test)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })

    const res = await PATCH(makeReq({ slack_webhook_url: null }))
    expect(res.status).toBe(200)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
