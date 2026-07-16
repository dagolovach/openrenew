import { sendSlackMessage } from "@/lib/slack";

describe("sendSlackMessage", () => {
  beforeEach(() => { global.fetch = jest.fn(); });

  it("posts text to the webhook", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const ok = await sendSlackMessage("https://hooks.slack.com/services/T/B/x", "hello");
    expect(ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/x",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "hello" }) })
    );
  });
  it("returns false on non-2xx", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404 });
    expect(await sendSlackMessage("https://hooks.slack.com/services/T/B/x", "hi")).toBe(false);
  });
});
