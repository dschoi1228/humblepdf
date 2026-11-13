import { describe, expect, it } from "vitest";
import { RenderScheduler } from "./renderScheduler";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("RenderScheduler", () => {
  it("runs by priority with limited concurrency", async () => {
    const s = new RenderScheduler(1);
    const order: string[] = [];
    const gate = deferred();
    s.schedule("first", 5, async () => {
      order.push("first");
      await gate.promise;
    });
    s.schedule("thumb", 2, async () => void order.push("thumb"));
    s.schedule("visible", 0, async () => void order.push("visible"));
    expect(order).toEqual(["first"]);
    gate.resolve();
    await tick();
    await tick();
    expect(order).toEqual(["first", "visible", "thumb"]);
    expect(s.stats.maxRunning).toBe(1);
    expect(s.stats.completed).toBe(3);
  });

  it("cancels queued and running jobs, and a rescheduled key replaces the old job", async () => {
    const s = new RenderScheduler(1);
    let aborted = false;
    const gate = deferred();
    s.schedule("a", 0, async (signal) => {
      signal.addEventListener("abort", () => (aborted = true));
      await gate.promise;
    });
    s.schedule("b", 0, async () => {});
    s.cancel("b");
    s.cancelExcept("a", new Set());
    expect(aborted).toBe(true);
    expect(s.stats.cancelled).toBe(2);
    gate.resolve();
    await tick();
    expect(s.stats.completed).toBe(0);
    expect(s.has("a")).toBe(false);
  });
});
