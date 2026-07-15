// __tests__/api/upload.test.ts
// NOTE: Jest node environment does not parse multipart/form-data via request.formData().
// We mock request.formData() directly to avoid that platform dependency.
import { POST } from "@/app/api/upload/route";

const mockGetUser = jest.fn();
const mockStorageUpload = jest.fn();
const mockFromInsert = jest.fn().mockResolvedValue({ error: null });

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              single: jest.fn().mockResolvedValue({ data: { plan: 'pro' }, error: null }),
            })),
          })),
        }
      }
      // contracts table: supports insert, count query (.not), and parent lookup (.eq.eq.single)
      const singleMock = jest.fn().mockResolvedValue({ data: null, error: null });
      const innerEq = jest.fn(() => ({
        not: jest.fn().mockResolvedValue({ count: 0, error: null }),
        neq: jest.fn().mockResolvedValue({ count: 0, error: null }),
        single: singleMock,
      }));
      return {
        insert: mockFromInsert,
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            eq: innerEq,
            not: jest.fn().mockResolvedValue({ count: 0, error: null }),
            neq: jest.fn().mockResolvedValue({ count: 0, error: null }),
            single: singleMock,
          })),
        })),
      }
    }),
  })),
}));

jest.mock("@supabase/supabase-js", () => ({
  createClient: jest.fn(() => ({
    storage: { from: jest.fn(() => ({ upload: mockStorageUpload })) },
  })),
}));

// Build a mock Request with a stubbed formData() method
function makeReq(file: { type: string; size: number; name: string; arrayBuffer: () => Promise<ArrayBuffer> } | null) {
  const fd = file
    ? { get: () => ({ ...file, arrayBuffer: file.arrayBuffer }) }
    : { get: () => null };
  return { formData: async () => fd } as unknown as Request;
}

function makePdf(size = 1024, name = "contract.pdf") {
  return {
    type: "application/pdf",
    size,
    name,
    arrayBuffer: async () => new ArrayBuffer(size),
  };
}

describe("POST /api/upload", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageUpload.mockResolvedValue({ data: {}, error: null });
  });

  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeReq(makePdf()));
    expect(res.status).toBe(401);
  });

  test("returns 400 when no file provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/file/i);
  });

  test("returns 400 when file is not a PDF", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(makeReq({ type: "text/plain", size: 100, name: "doc.txt", arrayBuffer: async () => new ArrayBuffer(100) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pdf/i);
  });

  test("returns 413 when file exceeds 20MB", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(makeReq(makePdf(20 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("File exceeds 20MB limit");
  });

  test("returns 500 when storage upload fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    mockStorageUpload.mockResolvedValue({ data: null, error: { message: "bucket not found" } });
    const res = await POST(makeReq(makePdf()));
    expect(res.status).toBe(500);
  });

  test("returns contract_id UUID on success", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } } });
    const res = await POST(makeReq(makePdf(1024, "my-contract.pdf")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
