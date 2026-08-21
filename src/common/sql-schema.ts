import type { ExpandedDatasourceType } from "@deterministic-code/generators-common/specification";
import type { PackCasing } from "./default-casing.ts";

/** Flattened `datasource.*` flags. On unless `"false"`; stored procedures are opt-in `"true"`. */
export const datasourceSettings = (settings: Record<string, string>) => ({
  pluralizeTableNames:
    String(settings["datasource.pluralize_datatable_names"]) !== "false",
  useStoredProcedures:
    String(settings["datasource.use_stored_procedures"]) === "true",
  useOptimisticConcurrency:
    String(settings["datasource.use_optimistic_concurrency"]) !== "false",
});

export type LiveTable = ExpandedDatasourceType & { tableName: string };

export const hasAuditColumns = (table: {
  fields: { name: string }[];
}): boolean =>
  table.fields.some((f) => f.name === "created") &&
  table.fields.some((f) => f.name === "updated");

export type SqlFile = { path: string; content: string };

const topoSort = (tables: LiveTable[]): LiveTable[] => {
  const names = new Set(tables.map((t) => t.name));
  const deps = new Map(
    tables.map((t) => [
      t.name,
      new Set(
        t.fields.flatMap((f) => {
          const dep = f.references?.split(".")[0];
          return dep && names.has(dep) && dep !== t.name ? [dep] : [];
        }),
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

/** Skip `skipMigrations` tables, attach physical names, parent-before-child order. */
export const buildLiveTables = (
  types: ExpandedDatasourceType[],
  casing: PackCasing,
): LiveTable[] =>
  topoSort(
    types
      .filter((t) => !t.skipMigrations)
      .map((t) => ({
        ...t,
        tableName: casing.tableName(t.name),
      })),
  );
