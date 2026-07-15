// __tests__/api/upload.test.ts
// NOTE: Jest node environment does not parse multipart/form-data via request.formData().
// We mock request.formData() directly to avoid that platform dependency.
import { POST } from "@/app/api/upload/route";

const mockRequireUser = jest.fn();
const mockFindFirst = jest.fn();
const mockInsert = jest.fn();
const mockSavePdf = jest.fn();

jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

jest.mock("@/lib/storage", () => ({
  savePdf: (...args: unknown[]) => mockSavePdf(...args),
}));

jest.mock("@/lib/db", () => ({
  db: {
    query: {
      contracts: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
    insert: () => ({
      values: (...args: unknown[]) => mockInsert(...args),
    }),
  },
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
    mockSavePdf.mockResolvedValue(undefined);
    mockFindFirst.mockResolvedValue(null);
    mockInsert.mockResolvedValue(undefined);
  });

  test("returns 401 when not authenticated", async () => {
    mockRequireUser.mockResolvedValue(null);
    const res = await POST(makeReq(makePdf()));
    expect(res.status).toBe(401);
  });

  test("returns 400 when no file provided", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/file/i);
  });

  test("returns 400 when file is not a PDF", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const res = await POST(makeReq({ type: "text/plain", size: 100, name: "doc.txt", arrayBuffer: async () => new ArrayBuffer(100) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/pdf/i);
  });

  test("returns 413 when file exceeds 20MB", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const res = await POST(makeReq(makePdf(20 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("File exceeds 20MB limit");
  });

  test("returns 500 when storage write fails", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    mockSavePdf.mockRejectedValue(new Error("disk full"));
    const res = await POST(makeReq(makePdf()));
    expect(res.status).toBe(500);
  });

  test("returns contract_id UUID on success", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1" });
    const res = await POST(makeReq(makePdf(1024, "my-contract.pdf")));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.contract_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });
});
