import { withDbLock } from "../../src/tools/claimsQuery.js";

describe("withDbLock", () => {
  it("skips a queued query when its signal aborts before the lock starts it", async () => {
    let releaseFirst!: () => void;
    let first!: Promise<string>;
    const firstStarted = new Promise<void>((resolveStarted) => {
      first = withDbLock(async () => {
        resolveStarted();
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return "first";
      });
    });
    await firstStarted;

    const controller = new AbortController();
    const queuedFn = jest.fn(async () => "second");
    const queued = withDbLock(queuedFn, controller.signal);

    controller.abort();

    await expect(queued).rejects.toThrow("cancelled before execution");
    expect(queuedFn).not.toHaveBeenCalled();

    releaseFirst();
    await expect(first).resolves.toBe("first");
    await new Promise((resolve) => setImmediate(resolve));

    expect(queuedFn).not.toHaveBeenCalled();
  });
});
