/** Revision ownership prevents cancelled/replaced work from publishing a result.
 * This does not interrupt synchronous WASM; the Worker runtime will own that. */
export class RestorationJobs {
  private readonly jobs = new Map<
    string,
    { revision: number; signal: AbortController }
  >();
  private revision = 0;

  begin(itemId: string) {
    this.cancel(itemId);
    const job = { revision: ++this.revision, signal: new AbortController() };
    this.jobs.set(itemId, job);
    return { revision: job.revision, signal: job.signal.signal };
  }

  owns(itemId: string, revision: number) {
    const job = this.jobs.get(itemId);
    return job?.revision === revision && !job.signal.signal.aborted;
  }

  cancel(itemId: string) {
    this.jobs.get(itemId)?.signal.abort();
    this.jobs.delete(itemId);
  }

  cancelAll() {
    for (const id of this.jobs.keys()) this.cancel(id);
  }
}
