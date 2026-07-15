// __tests__/api/upload-free-tier.test.ts
// Tests specifically for free tier enforcement in POST /api/upload
import { POST } from '@/app/api/upload/route'

const mockGetUser = jest.fn()
const mockProfileSelect = jest.fn()
const mockContractCount = jest.fn()
const mockStorageUpload = jest.fn().mockResolvedValue({ data: {}, error: null })
const mockFromInsert = jest.fn().mockResolvedValue({ error: null })

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
        }
      }
      if (table === 'contracts') {
        const singleMock = jest.fn().mockResolvedValue({ data: null, error: null });
        const innerEq = jest.fn(() => ({
          not: jest.fn(() => mockContractCount()),
          neq: jest.fn(() => mockContractCount()),
          single: singleMock,
        }));
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              eq: innerEq,
              not: jest.fn(() => mockContractCount()),
              neq: jest.fn(() => mockContractCount()),
              single: singleMock,
            })),
          })),
          insert: mockFromInsert,
        }
      }
      return {}
    }),
  })),
}))

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: { from: jest.fn(() => ({ upload: mockStorageUpload })) },
  })),
}))

function makeReq() {
  const fd = {
    get: () => ({
      type: 'application/pdf',
      size: 1024,
      name: 'contract.pdf',
      arrayBuffer: async () => new ArrayBuffer(1024),
    }),
  }
  return { formData: async () => fd } as unknown as Request
}

describe('POST /api/upload — free tier', () => {
  beforeEach(() => jest.clearAllMocks())

  test('returns 403 with free_tier_limit when free user has 20 contracts', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: { plan: 'free' }, error: null })
    mockContractCount.mockResolvedValue({ count: 20, error: null })

    const res = await POST(makeReq())
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('free_tier_limit')
  })

  test('allows upload when free user has fewer than 20 contracts', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: { plan: 'free' }, error: null })
    mockContractCount.mockResolvedValue({ count: 19, error: null })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
  })

  test('allows upload for pro users regardless of contract count', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: { plan: 'pro' }, error: null })
    // Must set insert mock so the route completes successfully
    mockFromInsert.mockResolvedValue({ error: null })
    mockStorageUpload.mockResolvedValue({ data: {}, error: null })

    const res = await POST(makeReq())
    expect(res.status).toBe(200)
    // Contract count check should be skipped for pro users
    expect(mockContractCount).not.toHaveBeenCalled()
  })

  test('returns 500 when profile cannot be fetched', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockProfileSelect.mockResolvedValue({ data: null, error: { message: 'row not found' } })

    const res = await POST(makeReq())
    expect(res.status).toBe(500)
  })
})
