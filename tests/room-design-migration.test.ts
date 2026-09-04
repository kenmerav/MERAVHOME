import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/20260904090000_add_room_design_v2_pilot.sql", import.meta.url),
  "utf8",
);

describe("Room Design V2 migration safety", () => {
  it("keeps every existing project on the legacy workflow", () => {
    expect(migration).toMatch(
      /ADD COLUMN IF NOT EXISTS design_workflow_version text NOT NULL DEFAULT 'legacy'/,
    );
    expect(migration).not.toMatch(/UPDATE\s+public\.projects/i);
  });

  it("is additive and includes a global off switch", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.studio_feature_flags");
    expect(migration).toContain("'room_design_v2'");
    expect(migration).not.toMatch(/DROP\s+TABLE/i);
    expect(migration).not.toMatch(/TRUNCATE/i);
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
  });

  it("keeps workflow events append-only for authenticated users", () => {
    expect(migration).toContain(
      "GRANT SELECT, INSERT ON public.room_design_events TO authenticated",
    );
    expect(migration).not.toMatch(/GRANT[^;]*UPDATE[^;]*room_design_events/i);
    expect(migration).not.toMatch(/GRANT[^;]*DELETE[^;]*room_design_events/i);
  });
});
