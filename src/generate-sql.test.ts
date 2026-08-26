import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import { generate as generateSql } from "./generate-sql.ts";
import { generate as generateStoredProcedures } from "./generate-stored-procedures.ts";

const TYPES_YAML = `types:
  - user:
      tags: [datasource_type]
      inherits: set
      fields:
        - email:
            type: string
        - created:
            type: datetime
        - updated:
            type: datetime
`;

const ctx = (settings: Record<string, string>) => ({
  reader: memoryReader({ "types.yaml": TYPES_YAML }),
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

const identityYaml = `types:
  - person:
      tags: [datasource_type]
      inherits: set
      fields:
        - code:
            type: integer
        - email:
            type: string
  - link:
      tags: [datasource_type]
      inherits: set
      ids: [left_id, right_id]
      fields:
        - left_id:
            type: integer
        - right_id:
            type: integer
  - country:
      tags: [datasource_type]
      inherits: set
      fields:
        - name:
            type: string
`;

const identityDatasource = `includes:
  - types:
      filter: tag == "datasource_type"
types:
  - country:
      fields:
        - id:
            is_fixed_id: true
            is_readonly: true
`;

const identityCtx = {
  reader: memoryReader({
    "types.yaml": identityYaml,
    "datasource.yaml": identityDatasource,
  }),
  settings: { "backend.datasources": "postgres" },
};

const upBody = async (
  settings: Record<string, string> = { "backend.datasources": "postgres" },
) => {
  const files = await generateSql({
    reader: identityCtx.reader,
    settings,
  });
  const up = files.find((e) => e.filename.endsWith("0001_initial_up.sql"));
  assert.ok(up, "expected initial up migration");
  return "contents" in up ? String(up.contents) : up.content;
};

describe("generate-sql identity keys", () => {
  it("uses the injected set id as a generated primary key", async () => {
    const sql = await upBody();
    assert.match(sql, /CREATE TABLE "people"/);
    assert.match(sql, /"id" SERIAL CONSTRAINT "people_primary_key" PRIMARY KEY/);
    assert.match(sql, /"code" INTEGER NOT NULL/);
    assert.match(sql, /"email"/);
  });

  it("emits a composite primary key when ids lists multiple columns", async () => {
    const sql = await upBody();
    assert.match(sql, /CREATE TABLE "links"/);
    assert.match(sql, /"left_id" INTEGER NOT NULL/);
    assert.match(sql, /"right_id" INTEGER NOT NULL/);
    assert.match(
      sql,
      /CONSTRAINT "links_primary_key" PRIMARY KEY \("left_id", "right_id"\)/,
    );
    assert.doesNotMatch(sql, /CREATE TABLE "links"[\s\S]*"id" SERIAL/);
  });

  it("emits a plain primary key when is_fixed_id is set", async () => {
    const sql = await upBody();
    assert.match(sql, /CREATE TABLE "countries"/);
    assert.match(
      sql,
      /"id" INTEGER NOT NULL CONSTRAINT "countries_primary_key" PRIMARY KEY/,
    );
    assert.doesNotMatch(sql, /CREATE TABLE "countries"[\s\S]*"id" SERIAL/);
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
