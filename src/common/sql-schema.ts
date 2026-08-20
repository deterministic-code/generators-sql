import type { DatasourceType } from "@deterministic-code/generators-common/specification";
import { effectiveTableName } from "./effective-table-name.ts";
import { requireDialect } from "./sql-dialect.ts";

export type DatasourceOptions = {
  idType?: string;
  pluralizeTableNames?: boolean;
  useStoredProcedures?: boolean;
  useOptimisticConcurrency?: boolean;
  withUuidColumn?: boolean;
};

/** On unless the flattened setting is the string `"false"`. */
const enabledByDefault = (raw: string | undefined): boolean =>
  String(raw) !== "false";

/** Opt-in: on only when the flattened value stringifies to `"true"`. */
const enabledWhenTrue = (raw: string | undefined): boolean =>
  String(raw) === "true";

export const datasourceSettings = (settings: Record<string, string>) => {
  const idType = settings["datasource.id_type"] ?? "integer";
  return {
    idType,
    withUuidColumn: idType !== "uuid",
    pluralizeTableNames: enabledByDefault(
      settings["datasource.pluralize_datatable_names"],
    ),
    useStoredProcedures: enabledWhenTrue(
      settings["datasource.use_stored_procedures"],
    ),
    useOptimisticConcurrency: enabledByDefault(
      settings["datasource.use_optimistic_concurrency"],
    ),
  };
};

export const datasourceSettingsFor = (opts: DatasourceOptions = {}) => {
  const idType = opts.idType ?? "integer";
  return {
    idType,
    withUuidColumn: idType !== "uuid",
    pluralizeTableNames: opts.pluralizeTableNames ?? true,
    useStoredProcedures: opts.useStoredProcedures ?? false,
    useOptimisticConcurrency: opts.useOptimisticConcurrency ?? true,
  };
};

export type LiveTable = DatasourceType & { tableName: string };

export const hasAuditColumns = (table: { fields: { name: string }[] }): boolean =>
  table.fields.some((f) => f.name === "created") &&
  table.fields.some((f) => f.name === "updated");

export type SqlFile = { path: string; content: string };

const topoSort = (tables: LiveTable[]): LiveTable[] => {
  const byName = new Map(tables.map((t) => [t.name, t]));
  const deps = new Map(
    tables.map((t) => [
      t.name,
      new Set(
        t.fields.flatMap((f) => {
          if (!f.references) return [];
          const dep = String(f.references).split(".")[0];
          return byName.has(dep) && dep !== t.name ? [dep] : [];
        }),
      ),
    ]),
  );
  const out: LiveTable[] = [];
  const done = new Set<string>();
  const pending = tables.slice();
  let safety = pending.length * pending.length + 10;
  while (pending.length > 0 && safety-- > 0) {
    const idx = pending.findIndex((t) =>
      [...(deps.get(t.name) ?? [])].every((d) => done.has(d)),
    );
    if (idx === -1) {
      for (const t of pending) {
        out.push(t);
        done.add(t.name);
      }
      break;
    }
    const [t] = pending.splice(idx, 1);
    out.push(t);
    done.add(t.name);
  }
  return out;
};

/** Shared by proc + migration generators — skipMigrations filter + topo-sort. */
export const buildLiveTables = (
  language: string,
  types: DatasourceType[],
  opts: DatasourceOptions = {},
): LiveTable[] => {
  requireDialect(language);
  const pluralize = opts.pluralizeTableNames === true;
  return topoSort(
    types
      .filter((t) => !t.skipMigrations)
      .map((t) => ({
        ...t,
        tableName: effectiveTableName(t.name, pluralize),
      })),
  );
};
