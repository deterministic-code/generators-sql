import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { memoryReader } from "@deterministic-code/generators-common/deterministic-reader";
import {
  DATASOURCE_SEEDS_YAML,
  TYPES_YAML,
} from "@deterministic-code/generators-common/spec-types";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { generate } from "./generate-sql.ts";

const TYPES = `types:
  - users_base:
      tags: [datasource_type]
      inherits: set
      fields:
        - email:
            type: string
        - created:
            type: datetime
        - updated:
            type: datetime
  - child:
      tags: [datasource_type]
      inherits: set
      fields:
        - owner_id:
            type: integer
            references: users_base.id
        - email:
            type: string
        - created:
            type: datetime
        - updated:
            type: datetime
  - person:
      tags: [datasource_type]
      inherits: set
      fields:
        - name:
            type: string
  - old_reviews:
      tags: [datasource_type]
      inherits: set
      fields:
        - title:
            type: string
  - notification:
      tags: [datasource_type]
      inherits: set
      fields:
        - title:
            type: string
`;

const DATASOURCE = `includes:
  - types:
      filter: tag == "datasource_type"
types:
  - users_base:
      mapping: user
  - child:
      fields:
        - email:
            mapping: email_address
  - old_reviews:
      mapping: OldRvwsTbl
`;

const SEEDS = `seeds:
  - child:
      - id1:
          email: mapped@example.com
          owner_id: 1
`;

const entryBody = (entry: GenerateEntry): string => {
  if ("contents" in entry) return String(entry.contents);
  return entry.content;
};

const upSql = async (settings: Record<string, string> = {}) => {
  const files = await generate({
    reader: memoryReader({
      [TYPES_YAML]: TYPES,
      "datasource.yaml": DATASOURCE,
      [DATASOURCE_SEEDS_YAML]: SEEDS,
    }),
    settings: { "backend.datasources": "postgres", ...settings },
  });
  const up = files.find((e) => e.filename.endsWith("0001_initial_up.sql"));
  assert.ok(up, "expected initial up migration");
  return entryBody(up);
};

describe("generate-sql datasource mapping", () => {
  it("pluralizes a snake table mapping", async () => {
    const sql = await upSql();
    assert.match(sql, /CREATE TABLE "users"/);
    assert.match(sql, /CONSTRAINT "users_primary_key"/);
    assert.match(sql, /trg_users_updated_at/);
    assert.doesNotMatch(sql, /users_base/);
    assert.doesNotMatch(sql, /users_bases/);
  });

  it("keeps a snake table mapping singular when pluralize is off", async () => {
    const sql = await upSql({
      "datasource.pluralize_datatable_names": "false",
    });
    assert.match(sql, /CREATE TABLE "user"/);
    assert.match(sql, /CONSTRAINT "user_primary_key"/);
    assert.match(sql, /REFERENCES "user"\("id"\)/);
  });

  it("pluralizes an unmapped type name", async () => {
    const sql = await upSql();
    assert.match(sql, /CREATE TABLE "people"/);
    assert.match(sql, /CREATE TABLE "notifications"/);
  });

  it("emits mapped columns and seed INSERT lists", async () => {
    const sql = await upSql();
    assert.match(sql, /CREATE TABLE "children"[\s\S]*"email_address"/);
    assert.match(
      sql,
      /INSERT INTO "children" \("id", "email_address", "owner_id"\)/,
    );
    assert.doesNotMatch(
      sql,
      /CREATE TABLE "children"[\s\S]*"email"[^_]/,
    );
  });

  it("resolves logical FK references to the target physical name", async () => {
    const sql = await upSql();
    assert.match(sql, /REFERENCES "users"\("id"\)/);
  });

  it("keeps a non-snake mapping verbatim when pluralize is on", async () => {
    const sql = await upSql();
    assert.match(sql, /CREATE TABLE "OldRvwsTbl"/);
    assert.doesNotMatch(sql, /OldRvwsTbls/);
  });
});
