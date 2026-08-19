import { effectiveTableName } from "./effective-table-name.ts";
import { resolveReferenceParentType } from "./datasource-references.ts";
import { requireDialect } from "./sql-dialect.ts";

export type DatasourceOptions = {
  idType?: string;
  pluralizeTableNames?: boolean;
  useStoredProcedures?: boolean;
  useOptimisticConcurrency?: boolean;
};

const fromIdType = (
  idType: string,
  extras: {
    pluralizeTableNames: boolean;
    useStoredProcedures: boolean;
    useOptimisticConcurrency: boolean;
  },
) => ({
  idType,
  withUuidColumn: idType !== "uuid",
  ...extras,
});

export const datasourceSettings = (settings: Record<string, string>) =>
  fromIdType(settings["datasource.id_type"] ?? "integer", {
    pluralizeTableNames:
      settings["datasource.pluralize_datatable_names"] === "true",
    useStoredProcedures:
      settings["datasource.use_stored_procedures"] === "true",
    useOptimisticConcurrency:
      settings["datasource.use_optimistic_concurrency"] === "true",
  });

export const datasourceSettingsFor = (opts: DatasourceOptions = {}) => {
  const { idType = "integer", ...rest } = opts;
  return fromIdType(idType, {
    pluralizeTableNames: true,
    useStoredProcedures: false,
    useOptimisticConcurrency: false,
    ...rest,
  });
};

export const entityUsesOptimisticConcurrency = (
  table: { datasourceType?: string; optimisticConcurrency?: boolean },
  globalFlag: boolean,
): boolean =>
  table.datasourceType !== "many-to-many" &&
  table.datasourceType !== "readonly-lookup" &&
  (table.optimisticConcurrency ?? globalFlag);

export const tableHasAuditColumns = (
  table: {
    datasourceType?: string;
    optimisticConcurrency?: boolean;
    fields: { name: string; primaryKey: boolean }[];
  },
  opts: { useOptimisticConcurrency?: boolean } = {},
): boolean => {
  if (table.datasourceType === "readonly-lookup") return false;
  const hasCustomPk = table.fields.some(
    (f) => f.primaryKey && f.name !== "id",
  );
  const occ = entityUsesOptimisticConcurrency(
    table,
    opts.useOptimisticConcurrency === true,
  );
  if (hasCustomPk) return occ;
  return true;
};

/** YAML/JSON seed cell — scalar leaf of a parsed datasource seed row. */
export type SeedValue = string | number | boolean | null;

type RawFieldDef = {
  type?: string;
  size?: number;
  is_nullable?: boolean;
  is_unique?: boolean;
  default_value?: SeedValue;
  references?: string;
  primary_key?: boolean;
};
type RawFieldEntry = Record<string, RawFieldDef>;
type RawIndexDef = { fields: string[]; is_unique?: boolean };
type RawTableDef = {
  fields: RawFieldEntry[];
  indexes?: Record<string, RawIndexDef>[];
  seeds?: Record<string, Record<string, SeedValue>>[];
  datasource_type?: string;
  skip_migrations?: boolean;
  use_optimistic_concurrency?: boolean;
};
type RawTableEntry = Record<string, RawTableDef>;

export type SchemaData = {
  types: RawTableEntry[];
  datasource_mappings?: unknown;
};

export type NormalizedField = {
  name: string;
  type: string;
  size?: number;
  isNullable: boolean;
  isUnique: boolean;
  defaultValue?: SeedValue;
  references?: string;
  primaryKey: boolean;
  referencesType?: string;
  referencesSize?: number;
};

export type NormalizedIndex = {
  name: string;
  fields: string[];
  isUnique: boolean;
};

export type NormalizedSeed = {
  id: number;
  row: Record<string, SeedValue>;
};

export type NormalizedTable = {
  name: string;
  entityName: string;
  pluralizeTableNames: boolean;
  datasourceType?: string;
  skipMigrations: boolean;
  optimisticConcurrency?: boolean;
  fields: NormalizedField[];
  indexes: NormalizedIndex[];
  seeds: NormalizedSeed[];
};

export type GenerateTableOptions = DatasourceOptions & {
  data?: SchemaData;
  withUuidColumn?: boolean;
  tableNameMappings?: Map<string, string>;
  skipForeignKeys?: boolean;
};

export type SqlFile = { path: string; content: string };

const named = <T,>(entry: Record<string, T>): [string, T] =>
  Object.entries(entry)[0];

const parseSeedKey = (rowKey: string): number => {
  const m = /^id(\d+)$/.exec(rowKey);
  if (!m) {
    throw new Error(
      `Invalid seed row key "${rowKey}": expected pattern /^id\\d+$/`,
    );
  }
  return Number(m[1]);
};

const normalizeField = (entry: RawFieldEntry): NormalizedField => {
  const [name, def] = named(entry);
  return {
    name,
    type: def.type as string,
    size: def.size,
    isNullable: def.is_nullable === true,
    isUnique: def.is_unique === true,
    defaultValue: def.default_value,
    references: def.references,
    primaryKey: def.primary_key === true,
  };
};

/** FK to a uuid id becomes UUID; integer parents stay integer. */
const applyReferenceType = (
  field: NormalizedField,
  data: SchemaData,
  defaultIdType: string,
): void => {
  const parent = resolveReferenceParentType(
    field.references,
    data.types,
    defaultIdType,
  );
  if (!parent) return;
  field.type = "reference";
  field.referencesType = parent.type;
  field.referencesSize = parent.size;
};

export const normalizeTable = (
  entry: RawTableEntry,
  opts: GenerateTableOptions = {},
): NormalizedTable => {
  const pluralize = opts.pluralizeTableNames === true;
  const idType = datasourceSettingsFor(opts).idType;
  const [name, def] = named(entry);
  const fields = def.fields.map(normalizeField);
  if (opts.data) {
    for (const f of fields) {
      if (f.references) applyReferenceType(f, opts.data, idType);
    }
  }
  const mapped = opts.data
    ? mappedTableNameForEntity(opts.data, name)
    : null;
  return {
    name: mapped ?? effectiveTableName(name, pluralize),
    entityName: name,
    pluralizeTableNames: pluralize,
    datasourceType: def.datasource_type,
    skipMigrations: def.skip_migrations === true,
    optimisticConcurrency:
      def.use_optimistic_concurrency === undefined
        ? undefined
        : def.use_optimistic_concurrency === true,
    fields,
    indexes: (def.indexes ?? []).map((idx) => {
      const [iname, idef] = named(idx);
      return { name: iname, fields: idef.fields, isUnique: idef.is_unique === true };
    }),
    seeds: (def.seeds ?? []).map((row) => {
      const [key, values] = named(row);
      return { id: parseSeedKey(key), row: values };
    }),
  };
};

/** `datasource_mappings: - <entity>: { source: <tableName> }` — typos throw. */
export const mappedTableNameForEntity = (
  data: SchemaData,
  entityName: string,
): string | null => {
  const raw = data.datasource_mappings;
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) {
    throw new Error(
      `datasource_mappings must be a list of single-key entity maps; got ${typeof raw}`,
    );
  }
  for (let i = 0; i < raw.length; i++) {
    const mapping = raw[i];
    if (mapping === null || typeof mapping !== "object") {
      throw new Error(
        `datasource_mappings[${i}] must be a single-key entity map; got ${typeof mapping}`,
      );
    }
    if (!(entityName in mapping)) continue;
    const entry = (mapping as Record<string, unknown>)[entityName];
    if (entry === null || typeof entry !== "object") {
      throw new Error(
        `datasource_mappings[${i}].${entityName} must be an object; got ${typeof entry}`,
      );
    }
    if (!("source" in entry)) return null;
    const source = (entry as Record<string, unknown>).source;
    if (typeof source !== "string" || source.length === 0) {
      throw new Error(
        `datasource_mappings[${i}].${entityName}.source must be a non-empty string; got ${typeof source}: ${JSON.stringify(source)}`,
      );
    }
    return source;
  }
  return null;
};

export const buildTableNameMappings = (
  data: SchemaData,
): Map<string, string> => {
  const raw = data.datasource_mappings;
  if (!Array.isArray(raw)) return new Map();
  return new Map(
    raw.flatMap((mapping) => {
      if (mapping === null || typeof mapping !== "object") return [];
      return Object.keys(mapping as object).flatMap((entity) => {
        const mapped = mappedTableNameForEntity(data, entity);
        return mapped !== null ? [[entity, mapped] as const] : [];
      });
    }),
  );
};

const topoSort = (tables: NormalizedTable[]): NormalizedTable[] => {
  const byName = new Map(tables.map((t) => [t.entityName, t]));
  const deps = new Map(
    tables.map((t) => [
      t.entityName,
      new Set(
        t.fields.flatMap((f) => {
          if (!f.references) return [];
          const dep = String(f.references).split(".")[0];
          return byName.has(dep) && dep !== t.entityName ? [dep] : [];
        }),
      ),
    ]),
  );
  const out: NormalizedTable[] = [];
  const done = new Set<string>();
  const pending = tables.slice();
  let safety = pending.length * pending.length + 10;
  while (pending.length > 0 && safety-- > 0) {
    const idx = pending.findIndex((t) =>
      [...(deps.get(t.entityName) ?? [])].every((d) => done.has(d)),
    );
    if (idx === -1) {
      for (const t of pending) {
        out.push(t);
        done.add(t.entityName);
      }
      break;
    }
    const [t] = pending.splice(idx, 1);
    out.push(t);
    done.add(t.entityName);
  }
  return out;
};

/** Shared by proc + migration generators — skipMigrations filter + topo-sort. */
export const buildLiveTables = (
  language: string,
  data: SchemaData,
  opts: GenerateTableOptions = {},
): NormalizedTable[] => {
  requireDialect(language);
  const { idType } = datasourceSettingsFor(opts);
  return topoSort(
    data.types.map((t) =>
      normalizeTable(t, {
        pluralizeTableNames: opts.pluralizeTableNames === true,
        data,
        idType,
      }),
    ),
  ).filter((t) => !t.skipMigrations);
};
