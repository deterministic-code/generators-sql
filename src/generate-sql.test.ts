import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import { generate as generateSql } from "./generate-sql.ts";
import { generate as generateStoredProcedures } from "./generate-stored-procedures.ts";

const TYPES_YAML = `types:
  - user:
      fields:
        - email:
            type: string
`;

const ctx = (settings: Record<string, string>) => ({
  reader: memoryReader({ "datasource_types.yaml": TYPES_YAML }),
  settings,
});

const names = (
  entries: { filename: string }[],
): string[] => entries.map((e) => e.filename).sort();

const postgresOn = {
  "backend.datasources": "postgres",
  "datasource.use_stored_procedures": "true",
};

describe("generate-sql datasource.use_stored_procedures", () => {
  it("emits stored-procedure migrations when the flag is true on postgres", async () => {
    const files = names(await generateSql(ctx(postgresOn)));
    assert.ok(files.includes("postgres/migrations/0001_initial_up.sql"));
    assert.ok(
      files.includes("postgres/migrations/0002_stored_procedures_up.sql"),
    );
    assert.ok(
      files.includes("postgres/migrations/0002_stored_procedures_down.sql"),
    );
  });

  it("omits stored-procedure migrations when the flag is absent", async () => {
    const files = names(
      await generateSql(ctx({ "backend.datasources": "postgres" })),
    );
    assert.ok(files.includes("postgres/migrations/0001_initial_up.sql"));
    assert.equal(
      files.some((f) => f.includes("stored_procedures")),
      false,
    );
  });

  it("omits stored-procedure migrations on sqlite even when the flag is true", async () => {
    const files = names(
      await generateSql(
        ctx({
          "backend.datasources": "sqlite",
          "datasource.use_stored_procedures": "true",
        }),
      ),
    );
    assert.ok(files.includes("sqlite/migrations/0001_initial_up.sql"));
    assert.equal(
      files.some((f) => f.includes("stored_procedures")),
      false,
    );
  });
});

describe("generate-stored-procedures datasource.use_stored_procedures", () => {
  it("emits procedure migrations when the flag is true", async () => {
    const files = names(await generateStoredProcedures(ctx(postgresOn)));
    assert.deepEqual(files, [
      "postgres/migrations/0002_stored_procedures_down.sql",
      "postgres/migrations/0002_stored_procedures_up.sql",
    ]);
  });

  it("emits nothing when the flag is absent", async () => {
    const files = await generateStoredProcedures(
      ctx({ "backend.datasources": "postgres" }),
    );
    assert.deepEqual(files, []);
  });
});
