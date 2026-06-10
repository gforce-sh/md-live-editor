import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAutosave, type SaveStatus } from "../src/autosave";

const opts = { debounceMs: 2000, retryMs: 5000 };

function deferred() {
  let resolve!: () => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces and saves the latest content once", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.schedule("a");
    a.schedule("ab");
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(opts.debounceMs);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
  });

  it("emits saving→saved across a successful save", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);
    const seen: SaveStatus[] = [];
    a.subscribe((s) => seen.push(s));

    a.schedule("x");
    await vi.advanceTimersByTimeAsync(opts.debounceMs);
    expect(seen).toEqual(["saving", "saved"]);
  });

  it("does not re-save unchanged content", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.schedule("x");
    await vi.advanceTimersByTimeAsync(opts.debounceMs);
    a.schedule("x");
    await vi.advanceTimersByTimeAsync(opts.debounceMs);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps a single save in flight and coalesces edits made during it", async () => {
    const first = deferred();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.schedule("v1");
    await vi.advanceTimersByTimeAsync(opts.debounceMs);
    expect(save).toHaveBeenCalledTimes(1);

    // edits arrive while v1 is still in flight
    a.schedule("v2");
    a.schedule("v3");
    await vi.advanceTimersByTimeAsync(opts.debounceMs);
    expect(save).toHaveBeenCalledTimes(1); // no concurrent second save

    first.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("v3");
  });

  it("flushSave saves immediately and resolves once persisted", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.schedule("hello");
    const flushed = a.flushSave();
    expect(save).toHaveBeenCalledWith("hello"); // skipped the debounce

    await expect(flushed).resolves.toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flushSave resolves immediately when nothing is pending", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    await expect(a.flushSave()).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("flushSave rejects on failure and keeps retrying in the background", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const a = createAutosave(save, opts);
    const seen: SaveStatus[] = [];
    a.subscribe((s) => seen.push(s));

    a.schedule("x");
    await expect(a.flushSave()).rejects.toThrow("boom");
    expect(seen).toContain("error");

    await vi.advanceTimersByTimeAsync(opts.retryMs);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("x");
    expect(seen).toContain("saved");
  });

  it("dispose stops pending saves and timers", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.schedule("x");
    a.dispose();
    await vi.advanceTimersByTimeAsync(opts.retryMs);

    expect(save).not.toHaveBeenCalled();
  });

  it("reset cancels a pending debounced save and rebaselines", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.schedule("a"); // pending edit, debounce ticking
    a.reset("b"); // programmatic load of a different document
    await vi.advanceTimersByTimeAsync(opts.debounceMs);

    expect(save).not.toHaveBeenCalled(); // discarded edit is not saved
    await expect(a.flushSave()).resolves.toBeUndefined();
    expect(save).not.toHaveBeenCalled(); // the reset content is the baseline
  });

  it("saves edits made against the content set by reset", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const a = createAutosave(save, opts);

    a.reset("b");
    a.schedule("bc");
    await vi.advanceTimersByTimeAsync(opts.debounceMs);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("bc");
  });
});
