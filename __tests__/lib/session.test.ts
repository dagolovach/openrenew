import { signSessionToken, verifySessionToken } from "@/lib/auth/session";

describe("session tokens", () => {
  beforeAll(() => { process.env.SESSION_SECRET = "test-secret-at-least-32-chars-long!!"; });

  it("round-trips a user id", async () => {
    const token = await signSessionToken("11111111-1111-1111-1111-111111111111");
    expect(await verifySessionToken(token)).toBe("11111111-1111-1111-1111-111111111111");
  });
  it("rejects a tampered token", async () => {
    const token = await signSessionToken("11111111-1111-1111-1111-111111111111");
    expect(await verifySessionToken(token + "x")).toBeNull();
  });
  it("rejects garbage", async () => {
    expect(await verifySessionToken("not-a-token")).toBeNull();
  });
});
