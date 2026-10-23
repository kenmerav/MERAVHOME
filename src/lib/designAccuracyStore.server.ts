import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { AccuracyState } from "./designAccuracy";
import { accuracyFixture } from "./designAccuracyFixtures";

export class AccuracyConflict extends Error {
  status = 409;
}
/** Loopback fixture persistence only. Production uses the protected Supabase CAS RPC. */
export class LocalAccuracyStore {
  constructor(private directory: string) {}
  async read(): Promise<AccuracyState> {
    await mkdir(this.directory, { recursive: true });
    try {
      return JSON.parse(await readFile(join(this.directory, "design-accuracy.json"), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return accuracyFixture();
    }
  }
  async mutate(expectedRevision: number, update: (state: AccuracyState) => AccuracyState) {
    await mkdir(this.directory, { recursive: true });
    const lock = join(this.directory, "design-accuracy.lock");
    try {
      await mkdir(lock);
    } catch {
      throw new AccuracyConflict("Another save is in progress. Reload and retry.");
    }
    try {
      const state = await this.read();
      if (state.revision !== expectedRevision)
        throw new AccuracyConflict("A newer version is saved. Reload before confirming.");
      const next = update(state);
      const temporary = join(this.directory, "design-accuracy.pending.json");
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, join(this.directory, "design-accuracy.json"));
      return next;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}
