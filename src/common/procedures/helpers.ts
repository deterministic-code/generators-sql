/** Dialect-agnostic helpers shared by the postgres/mysql/sqlserver stored-procedure generators. */

import { effectiveTableName } from "../effective-table-name.ts";

interface ProcField {
  name: string;
  type: string;
  size?: number;
  isPrimaryKey?: boolean;
}

interface ProcTable {
  fields: ProcField[];
}

/** The entity's primary key: an explicit `primary_key: true` field, else `id`. */
export function pkFieldOf(table: ProcTable): ProcField {
  return (
    table.fields.find((f) => f.isPrimaryKey === true) ??
    table.fields.find((f) => f.name === "id") ?? { name: "id", type: "integer" }
  );
}

/** The writable, non-audit columns: everything but the pk, the system `uuid`, and `created`/`updated`. */
export function writableNonAuditFields(table: ProcTable): ProcField[] {
  const pk = pkFieldOf(table);
  return table.fields.filter(
    (f) =>
      f.name !== pk.name &&
      f.name !== "uuid" &&
      f.name !== "created" &&
      f.name !== "updated",
  );
}

export function hasSystemUuidColumn(table: ProcTable): boolean {
  return table.fields.some((f) => f.name === "uuid");
}

/** The ordered column list for an entity's SELECT/INSERT: pk, the system `uuid` (when present), the writable columns, then `created`/`updated`. */
function allColumnNames(table: ProcTable): string[] {
  const pk = pkFieldOf(table);
  return [
    pk.name,
    ...(hasSystemUuidColumn(table) ? ["uuid"] : []),
    ...writableNonAuditFields(table).map((f) => f.name),
    "created",
    "updated",
  ];
}

/** `allColumnNames` qualified with a table alias (default `t`), for the dialects whose SELECTs alias the table. */
export function aliasedColumns(table: ProcTable, alias = "t"): string {
  return allColumnNames(table)
    .map((c) => `${alias}.${c}`)
    .join(", ");
}

export function paramAlignWidth(params: { name: string }[]): number {
  return params.reduce((m, p) => Math.max(m, p.name.length), 0);
}

export function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

/** Pluralize an entity name for routine names — same rules as physical table names. */
export const pluralizeEntity = (name: string): string =>
  effectiveTableName(name, true);
