/** Dialect-agnostic helpers shared by the postgres/mysql/sqlserver stored-procedure generators. */

interface ProcField {
  name: string;
  type: string;
  size?: number;
}

interface ProcTable {
  fields: ProcField[];
  pkName?: string;
}

/** The entity's primary key: `pkName` when set, else a field named `id`. */
export const pkFieldOf = (table: ProcTable): ProcField =>
  (table.pkName
    ? table.fields.find((f) => f.name === table.pkName)
    : undefined) ??
  table.fields.find((f) => f.name === "id") ?? { name: "id", type: "integer" };

/** The writable, non-audit columns: everything but the pk, the system `uuid`, and `created`/`updated`. */
export const writableNonAuditFields = (table: ProcTable): ProcField[] => {
  const pk = pkFieldOf(table);
  return table.fields.filter(
    (f) =>
      f.name !== pk.name &&
      f.name !== "uuid" &&
      f.name !== "created" &&
      f.name !== "updated",
  );
};

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
export const aliasedColumns = (
  table: ProcTable,
  alias = "t",
  columnName: (field: string) => string = (field) => field,
): string =>
  table.fields.map((f) => `${alias}.${columnName(f.name)}`).join(", ");

export const paramAlignWidth = (params: { name: string }[]): number =>
  params.reduce((m, p) => Math.max(m, p.name.length), 0);

export const pad = (s: string, w: number): string =>
  s + " ".repeat(Math.max(0, w - s.length));
