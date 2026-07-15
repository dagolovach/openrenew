/**
 * Unit tests for the cron alert pagination loop.
 *
 * The loop always queries status='pending' from offset 0 — processed rows
 * change status so they won't appear in the next fetch. This avoids
 * duplicate-processing without offset arithmetic.
 */

const PAGE_SIZE = 100;
const MAX_ALERTS_PER_RUN = 500;

async function runPaginatedCron(
  fetchBatch: () => Promise<string[]>,
  processBatch: (ids: string[]) => Promise<void>
): Promise<{ totalProcessed: number; hitCeiling: boolean }> {
  let totalProcessed = 0;

  while (totalProcessed < MAX_ALERTS_PER_RUN) {
    const batch = await fetchBatch();
    if (!batch || batch.length === 0) break;

    await processBatch(batch);
    totalProcessed += batch.length;

    if (batch.length < PAGE_SIZE) break; // last page
  }

  const hitCeiling = totalProcessed >= MAX_ALERTS_PER_RUN;
  return { totalProcessed, hitCeiling };
}

describe("runPaginatedCron", () => {
  it("processes a single partial page and stops", async () => {
    const ids = Array.from({ length: 42 }, (_, i) => `id-${i}`);
    const fetchBatch = jest.fn().mockResolvedValueOnce(ids);
    const processBatch = jest.fn().mockResolvedValue(undefined);

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(fetchBatch).toHaveBeenCalledTimes(1);
    expect(result.totalProcessed).toBe(42);
    expect(result.hitCeiling).toBe(false);
  });

  it("processes multiple full pages until a partial page ends the loop", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => `id-p1-${i}`);
    const partialPage = Array.from({ length: 37 }, (_, i) => `id-p2-${i}`);
    const fetchBatch = jest
      .fn()
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce(partialPage);
    const processBatch = jest.fn().mockResolvedValue(undefined);

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(fetchBatch).toHaveBeenCalledTimes(2);
    expect(result.totalProcessed).toBe(137);
    expect(result.hitCeiling).toBe(false);
  });

  it("stops and signals hitCeiling when MAX_ALERTS_PER_RUN is reached", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => `id-${i}`);
    const fetchBatch = jest.fn().mockResolvedValue(fullPage);
    const processBatch = jest.fn().mockResolvedValue(undefined);

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(result.totalProcessed).toBe(500);
    expect(result.hitCeiling).toBe(true);
    expect(fetchBatch).toHaveBeenCalledTimes(5);
  });

  it("stops immediately on empty first batch with zero processed", async () => {
    const fetchBatch = jest.fn().mockResolvedValue([]);
    const processBatch = jest.fn();

    const result = await runPaginatedCron(fetchBatch, processBatch);

    expect(result.totalProcessed).toBe(0);
    expect(result.hitCeiling).toBe(false);
    expect(processBatch).not.toHaveBeenCalled();
  });
});
