import { pdfAbsolutePath } from "@/lib/storage";
import path from "path";

describe("pdfAbsolutePath", () => {
  beforeAll(() => { process.env.DATA_DIR = "/data/contracts"; });

  it("resolves a relative path under DATA_DIR", () => {
    expect(pdfAbsolutePath("user1/c1/original.pdf"))
      .toBe(path.join("/data/contracts", "user1/c1/original.pdf"));
  });
  it("rejects path traversal", () => {
    expect(() => pdfAbsolutePath("../../etc/passwd")).toThrow();
    expect(() => pdfAbsolutePath("/etc/passwd")).toThrow();
  });
});
