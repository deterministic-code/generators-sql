import { createHash } from "node:crypto";
import { fill } from "@deterministic-code/generators-common/fill";
import type {
  DatasourceField,
  SeedRow,
  SeedValue,
} from "@deterministic-code/generators-common/specification";
import { sqlStringLiteral } from "../base-type-converter.ts";
import { insertSeedTmpl } from "../resources/sql.ts";
import { renderSeedAfter, renderSeedBefore } from "./render-ddl.ts";
import {
  dialectConverter,
  q,
  sqlDefault,
  type SqlDialect,
} from "./sql-dialect.ts";
import type { PackCasing } from "./default-casing.ts";
import type { LiveTable } from "./sql-schema.ts";

const SEED_UUID_NAMESPACE = "9b3a8e6c-2f1d-4a5b-8c9d-1e2f3a4b5c6d";

const pkType = (table: LiveTable): string =>
  table.fields.find((f) => f.isPrimaryKey === true)?.type ?? "integer";

const seedUuid = (tableName: string, id: number): string => {
  const bytes = Buffer.from(
    createHash("sha1")
      .update(
        Buffer.concat([
          Buffer.from(SEED_UUID_NAMESPACE.replace(/-/g, ""), "hex"),
          Buffer.from(`${tableName}:${id}`, "utf8"),
        ]),
      )
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const renderValue = (
  dialect: SqlDialect,
  field: DatasourceField,
  value: SeedValue,
): string => {
  if (field.type === "boolean") {
    return dialectConverter(dialect).conversions.boolean.defaults.Boolean(
      value ? "true" : "false",
    );
  }
  if (field.type === "number" || field.type === "reference") {
    return String(value);
  }
  return sqlStringLiteral(value);
};

const idValue = (table: LiveTable, id: number): string => {
  const t = pkType(table);
  if (t === "uuid") return sqlStringLiteral(seedUuid(table.name, id));
  if (t === "string") return sqlStringLiteral(String(id));
  return String(id);
};

const colValue = (
  dialect: SqlDialect,
  field: DatasourceField | undefined,
  value: SeedValue | undefined,
): string => {
  if (!field) return "NULL";
  if (value === null || value === undefined) {
    return sqlDefault(dialect, field) ?? "NULL";
  }
  return renderValue(dialect, field, value);
};

const colsForRow = (
  table: LiveTable,
  row: Record<string, SeedValue>,
): string[] => {
  const names = new Set(table.fields.map((f) => f.name));
  return [
    ...(names.has("id") ? ["id"] : []),
    ...(names.has("uuid") ? ["uuid"] : []),
    ...Object.keys(row).filter((k) => k !== "id" && k !== "uuid"),
  ];
};

const insert = (
  dialect: SqlDialect,
  table: LiveTable,
  seed: SeedRow,
  casing: PackCasing,
): string => {
  const cols = colsForRow(table, seed.row);
  const values = cols.map((c) => {
    if (c === "id") return idValue(table, seed.id);
    if (c === "uuid") return sqlStringLiteral(seedUuid(table.name, seed.id));
    return colValue(
      dialect,
      table.fields.find((f) => f.name === c),
      seed.row[c],
    );
  });
  return fill(insertSeedTmpl, {
    quotedTable: q(dialect, table.tableName),
    colList: cols.map((c) => q(dialect, casing.columnName(c))).join(", "),
    valueList: values.join(", "),
  }).trimEnd();
};

/** Per-table seed SQL blocks for the initial migration (`-- Seeds: <table>`). */
export const seedSections = (
  dialect: SqlDialect,
  tables: LiveTable[],
  seeds: Map<string, SeedRow[]>,
  casing: PackCasing,
): string[] => {
  const lines: string[] = [];
  for (const table of tables) {
    const rows = seeds.get(table.name) ?? [];
    if (rows.length === 0) continue;
    const quoted = q(dialect, table.tableName);
    const t = pkType(table);
    const sequenced = t !== "uuid" && t !== "string";
    const idColumn = casing.columnName("id");
    const before = sequenced ? renderSeedBefore(dialect, quoted) : "";
    const after = sequenced
      ? renderSeedAfter(
          dialect,
          table.tableName,
          quoted,
          idColumn,
          q(dialect, idColumn),
        )
      : "";
    lines.push(
      `-- Seeds: ${table.tableName}`,
      [
        ...(before ? [before] : []),
        ...rows.map((s) => insert(dialect, table, s, casing)),
        ...(after ? [after] : []),
      ].join("\n"),
      "",
    );
  }
  return lines;
};
