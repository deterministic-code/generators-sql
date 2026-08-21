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

/** CREATE IN-params from expanded columns, in the stored-procedure call order: `uuid` (if present), writable fields, `created`, `updated`. */
export const createParamFields = (table: ProcTable): ProcField[] => {
  const field = (name: string): ProcField[] => {
    const found = table.fields.find((f) => f.name === name);
    return found ? [found] : [];
  };
  return [
    ...field("uuid"),
    ...writableNonAuditFields(table),
    ...field("created"),
    ...field("updated"),
  ];
};

/** The expanded `updated` column — present on every table that gets procedures. */
export const updatedFieldOf = (table: ProcTable): ProcField => {
  const field = table.fields.find((f) => f.name === "updated");
  if (!field) {
    throw new Error("procedure table is missing expanded `updated` column");
  }
  return field;
};

/** Expanded columns qualified with a table alias (default `t`). */
export const aliasedColumns = (table: ProcTable, alias = "t"): string =>
  table.fields.map((f) => `${alias}.${f.name}`).join(", ");

export function paramAlignWidth(params: { name: string }[]): number {
  return params.reduce((m, p) => Math.max(m, p.name.length), 0);
}

export function pad(s: string, w: number): string {
  return s + " ".repeat(Math.max(0, w - s.length));
}

/** Pluralize an entity name for routine names — same rules as physical table names. */
export const pluralizeEntity = (name: string): string =>
  effectiveTableName(name, true);
