import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("produces unique salted hashes", async () => {
    expect(await hashPassword("x")).not.toEqual(await hashPassword("x"));
  });
});
