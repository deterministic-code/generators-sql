import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TypeField } from "@deterministic-code/deterministic-specifications-typescript/parser";
import { createDatasourceNaming } from "@deterministic-code/generators-common/datasource-naming";
import { createCasing } from "./default-casing.ts";
import { SqlMapping } from "./sql-mapping.ts";
import type { SqlTable } from "./sql-schema.ts";

const field = (name: string): TypeField => ({
  name,
  type: name === "id" || name === "owner_id" ? "integer" : "string",
  kind: "primitive",
  base: name === "id" || name === "owner_id" ? "integer" : "string",
  isArray: false,
  isNullable: false,
});

const table = (
  name: string,
  opts: {
    mapping?: string;
    fields?: { name: string; mapping?: string }[];
  } = {},
): SqlTable => {
  const fields = opts.fields ?? [{ name: "id" }];
  return {
    name,
    tags: ["datasource_type"],
    kind: "inherit",
    inherits: "set",
    fields: fields.map((f) => field(f.name)),
    indexes: [],
    uniqueIndexFields: [],
    overlays: fields
      .filter((f) => f.mapping !== undefined)
      .map((f) => ({ name: f.name, mapping: f.mapping })),
    ...(opts.mapping !== undefined ? { mapping: opts.mapping } : {}),
  };
};

const usersBase = table("users_base", {
  mapping: "user",
  fields: [{ name: "id" }, { name: "email" }],
});
const child = table("child", {
  fields: [
    { name: "id" },
    { name: "owner_id" },
    { name: "email", mapping: "email_address" },
  ],
});
const person = table("person");
const oldReviews = table("old_reviews", { mapping: "OldRvwsTbl" });
const notification = table("notification");

const mappingOf = (settings: Record<string, string> = {}) =>
  new SqlMapping(createCasing(settings), [
    usersBase,
    child,
    person,
    oldReviews,
    notification,
  ]);

describe("isVerbatim", () => {
  const naming = createDatasourceNaming({});
  it("treats snake stems as cased", () => {
    assert.equal(naming.isVerbatim("user"), false);
    assert.equal(naming.isVerbatim("email_address"), false);
  });

  it("treats mixed-case mappings as verbatim", () => {
    assert.equal(naming.isVerbatim("OldRvwsTbl"), true);
    assert.equal(naming.isVerbatim("UsrProfiles"), true);
  });
});

describe("SqlMapping", () => {
  it("maps users_base / user through pluralize", () => {
    const mapping = mappingOf();
    assert.equal(mapping.tableStem(usersBase), "user");
    assert.equal(mapping.tableName(usersBase), "users");
    assert.equal(mapping.constraintName(usersBase, "primary_key"), "users_primary_key");
    assert.equal(mapping.triggerName(usersBase), "trg_users_updated_at");
  });

  it("keeps the stem when pluralize is off", () => {
    const mapping = mappingOf({
      "datasource.pluralize_datatable_names": "false",
    });
    assert.equal(mapping.tableName(usersBase), "user");
    assert.equal(mapping.constraintName(usersBase, "primary_key"), "user_primary_key");
  });

  it("pluralizes an unmapped type name", () => {
    const mapping = mappingOf();
    assert.equal(mapping.tableName(person), "people");
    assert.equal(mapping.tableName(notification), "notifications");
  });

  it("uses field overlay mapping for columns", () => {
    const mapping = mappingOf();
    assert.equal(mapping.fieldStem(child, "email"), "email_address");
    assert.equal(mapping.columnName(child, "email"), "email_address");
    assert.equal(mapping.columnName(child, "owner_id"), "owner_id");
  });

  it("resolves logical FK references to physical names", () => {
    const mapping = mappingOf();
    assert.deepEqual(mapping.resolveReference("users_base.id"), {
      tableName: "users",
      columnName: "id",
    });
    const off = mappingOf({
      "datasource.pluralize_datatable_names": "false",
    });
    assert.deepEqual(off.resolveReference("users_base.id"), {
      tableName: "user",
      columnName: "id",
    });
  });

  it("keeps non-snake mappings verbatim", () => {
    const mapping = mappingOf();
    assert.equal(mapping.tableName(oldReviews), "OldRvwsTbl");
    assert.equal(
      mapping.constraintName(oldReviews, "primary_key"),
      "OldRvwsTbl_primary_key",
    );
    assert.equal(mapping.triggerName(oldReviews), "trg_OldRvwsTbl_updated_at");
  });

  it("matches createCasing.tableName when mapping is omitted", () => {
    const casing = createCasing({});
    const mapping = new SqlMapping(casing, [notification]);
    assert.equal(mapping.tableName(notification), casing.tableName("notification"));
  });

  it("throws when an FK target is missing", () => {
    const mapping = mappingOf();
    assert.throws(
      () => mapping.resolveReference("missing.id"),
      /unknown table "missing"/,
    );
  });
});
