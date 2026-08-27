import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import { generate as generateSql } from "./generate-sql.ts";

const TYPES = `types:
  - item:
      tags: [datasource_type]
      inherits: set
      fields:
        - name:
            type: string
        - version:
            type: binary
            default_value: Hex('')
`;

const DATASOURCE = `includes:
  - types:
      filter: tag == "datasource_type"
types:
  - item:
      fields:
        - version:
            is_optimistic_concurrency: true
            use_native_row_version: true
`;

const generate = (dialect: string, extras: Record<string, string> = {}) =>
  generateSql({
    reader: memoryReader({
      "types.yaml": TYPES,
      "datasource.yaml": DATASOURCE,
    }),
    settings: { "backend.datasources": dialect, ...extras },
  });

const file = (
  entries: { filename: string; contents?: string }[],
  name: string,
) => entries.find((e) => e.filename === name)?.contents ?? "";

describe("field-level OCC SQL", () => {
  it("emits SQL Server ROWVERSION and no SET of the native column", async () => {
    const entries = await generate("sqlserver", {
      "datasource.use_stored_procedures": "true",
    });
    const ddl = file(entries, "sqlserver/migrations/0001_initial_up.sql");
    assert.match(ddl, /ROWVERSION/);
    assert.doesNotMatch(ddl, /trg_items_occ/);
    const procs = file(
      entries,
      "sqlserver/migrations/0002_stored_procedures_up.sql",
    );
    assert.match(procs, /expected_version/);
    assert.doesNotMatch(procs, /SET \[version\]/);
  });

  it("emits an 8-byte watermark and bump trigger on sqlite", async () => {
    const entries = await generate("sqlite");
    const ddl = file(entries, "sqlite/migrations/0001_initial_up.sql");
    assert.match(ddl, /BLOB/);
    assert.match(ddl, /X'0000000000000000'/);
    assert.match(ddl, /_occ/);
    assert.match(ddl, /WHEN NEW\."version" IS OLD\."version"/);
    assert.match(ddl, /unicode\(substr\(COALESCE\(OLD\."version", X'0000000000000000'\), 1, 1\)\)/);
    assert.doesNotMatch(ddl, /CAST\('0x'/);
  });

  it("emits expected_version on postgres OCC procedures", async () => {
    const entries = await generate("postgres", {
      "datasource.use_stored_procedures": "true",
    });
    const procs = file(
      entries,
      "postgres/migrations/0002_stored_procedures_up.sql",
    );
    assert.match(procs, /expected_version/);
    assert.match(procs, /update_item_optimistic_concurrency/);
    assert.doesNotMatch(procs, /expected_updated/);
  });
});
