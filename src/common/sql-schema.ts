import type {
  DatasourceFieldOverlay,
  DatasourceIndex,
  DatasourceTable,
  IDeterministic,
  Type,
  TypeField,
} from "@deterministic-code/deterministic-specifications-typescript/parser";
import {
  columnFields,
  datasourceTypesOf,
  pkName,
  tableByName,
} from "@deterministic-code/generators-common/spec-types";

/** Flattened `datasource.*` flags. On unless `"false"`; stored procedures are opt-in `"true"`. */
export const datasourceSettings = (settings: Record<string, string>) => ({
  pluralizeTableNames:
    String(settings["datasource.pluralize_datatable_names"]) !== "false",
  useStoredProcedures:
    String(settings["datasource.use_stored_procedures"]) === "true",
  useOptimisticConcurrency:
    String(settings["datasource.use_optimistic_concurrency"]) !== "false",
});

export type SqlTable = Omit<Type, "mapping"> & {
  tableName?: string;
  indexes: DatasourceIndex[];
  uniqueIndexFields: string[];
  mapping?: string;
  useOptimisticConcurrency?: boolean;
  overlays: DatasourceFieldOverlay[];
};

export type LiveTable = SqlTable & { tableName: string };

export const overlayOf = (table: SqlTable): DatasourceTable => ({
  name: table.name,
  fields: table.overlays,
  indexes: table.indexes,
  uniqueIndexFields: table.uniqueIndexFields,
  ...(table.mapping !== undefined ? { mapping: table.mapping } : {}),
  ...(table.useOptimisticConcurrency !== undefined
    ? { useOptimisticConcurrency: table.useOptimisticConcurrency }
    : {}),
});

export const fieldOverlay = (
  table: SqlTable,
  fieldName: string,
): DatasourceFieldOverlay | undefined =>
  table.overlays.find((overlay) => overlay.name === fieldName);

const GENERATED_ID_TYPES = new Set([
  "integer",
  "biginteger",
  "uuid",
  "string",
]);

export const tableIdentity = (table: SqlTable): string[] => {
  const col = pkName(table, overlayOf(table));
  if (table.fields.some((f) => f.name === col) || table.inherits === "set") {
    return [col];
  }
  return [];
};

export const isGeneratedIdentity = (table: SqlTable): boolean => {
  const keys = tableIdentity(table);
  if (keys.length !== 1) return false;
  return fieldOverlay(table, keys[0]!)?.isFixedId !== true;
};

export const usesGeneratedIdColumn = (
  table: SqlTable,
  field: TypeField,
): boolean =>
  isGeneratedIdentity(table) &&
  field.name === tableIdentity(table)[0] &&
  GENERATED_ID_TYPES.has(field.type);

export const sqlTablesFrom = (spec: IDeterministic): SqlTable[] => {
  const overlays = tableByName(spec);
  return datasourceTypesOf(spec).map((type) => {
    const table = overlays.get(type.name);
    const { mapping: _typeMapping, ...rest } = type;
    return {
      ...rest,
      fields: columnFields(type.fields),
      indexes: table?.indexes ?? [],
      uniqueIndexFields: table?.uniqueIndexFields ?? [],
      ...(table?.mapping !== undefined ? { mapping: table.mapping } : {}),
      ...(table?.useOptimisticConcurrency !== undefined
        ? { useOptimisticConcurrency: table.useOptimisticConcurrency }
        : {}),
      overlays: table?.fields ?? [],
    };
  });
};

export const hasAuditColumns = (table: {
  fields: { name: string }[];
}): boolean =>
  table.fields.some((f) => f.name === "created") &&
  table.fields.some((f) => f.name === "updated");

export type SqlFile = { path: string; content: string };

export const referenceParents = (
  references: TypeField["references"],
): string[] => {
  if (references === undefined) return [];
  if (Array.isArray(references)) return [references[0]];
  return [references.split(".")[0]!];
};

export const referenceTarget = (
  references: NonNullable<TypeField["references"]>,
): [string, string] => {
  if (Array.isArray(references)) return [references[0], references[1]];
  const [table, col] = references.split(".");
  return [table ?? "", col ?? ""];
};

const topoSort = (tables: LiveTable[]): LiveTable[] => {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(
    tables.map((t) => [
      t.name,
      new Set(
        t.fields.flatMap((f) =>
          referenceParents(f.references).filter(
            (dep) => names.has(dep) && dep !== t.name,
          ),
        ),
      ),
    ]),
  );
  const out: LiveTable[] = [];
  const done = new Set<string>();
  const pending = tables.slice();
  while (pending.length > 0) {
    const idx = pending.findIndex((t) =>
      [...(deps.get(t.name) ?? [])].every((d) => done.has(d)),
    );
    if (idx === -1) {
      out.push(...pending);
      break;
    }
    const [t] = pending.splice(idx, 1);
    out.push(t);
    done.add(t.name);
  }
  return out;
};

/** Attach physical names and order parent tables before children. */
export const buildLiveTables = (
  types: SqlTable[],
  mapping: { tableName: (table: SqlTable) => string },
): LiveTable[] =>
  topoSort(
    types.map((t) => ({
      ...t,
      tableName: mapping.tableName(t),
    })),
  );
