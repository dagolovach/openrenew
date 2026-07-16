const mockRequireUser = jest.fn();
jest.mock("@/lib/auth/session", () => ({
  requireUser: () => mockRequireUser(),
}));

const mockSetSetting = jest.fn();
jest.mock("@/lib/db/settings", () => ({
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

import { POST } from "@/app/api/settings/ical-token/route";

describe("POST /api/settings/ical-token", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetSetting.mockResolvedValue(undefined);
  });

  it("returns 401 when not authenticated", async () => {
    mockRequireUser.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("returns 403 when authenticated but not admin", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1", email: "a@b.com", isAdmin: false });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });

  it("returns 200 and generates a new 64-hex token for admin", async () => {
    mockRequireUser.mockResolvedValue({ id: "u1", email: "a@b.com", isAdmin: true });
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(mockSetSetting).toHaveBeenCalledWith("ical_token", body.token);
  });
});
