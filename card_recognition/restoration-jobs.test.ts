import { describe, expect, it } from "vitest";
import { RestorationJobs } from "./restoration-jobs";

describe("restoration revision ownership", () => {
  it("discards 200 late responses after replacement or cancellation", () => {
    const jobs = new RestorationJobs();
    let staleApplied = 0;
    for (let i = 0; i < 200; i++) {
      const old = jobs.begin("card");
      const current = jobs.begin("card");
      if (i % 2) jobs.cancel("card");
      if (jobs.owns("card", old.revision)) staleApplied++;
      expect(old.signal.aborted).toBe(true);
      expect(jobs.owns("card", current.revision)).toBe(i % 2 === 0);
    }
    expect(staleApplied).toBe(0);
  });
  it("keeps different captures independent and cancels on unmount", () => {
    const jobs = new RestorationJobs();
    const a = jobs.begin("a"),
      b = jobs.begin("b");
    jobs.cancel("a");
    expect(jobs.owns("b", b.revision)).toBe(true);
    jobs.cancelAll();
    expect(a.signal.aborted).toBe(true);
    expect(b.signal.aborted).toBe(true);
  });
});
