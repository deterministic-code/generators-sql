import { fill } from "@deterministic-code/generators-common/fill";
import type { GenerateContext } from "./generate-context.ts";
import type { GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { chainMigrationEntries } from "./migration-entries.ts";
import { parseDatasourceTypes } from "../parse-datasource-types.ts";
import { byFieldsFromDatasource } from "./datasource-by-fields.ts";
import {
  normalizeDialect,
  supportsProcedures,
  type SqlDialect,
} from "./sql-dialect.ts";
import {
  buildLiveTables,
  datasourceSettings,
  tableHasAuditColumns,
  type GenerateTableOptions,
  type NormalizedTable,
  type SchemaData,
  type SqlFile,
} from "./sql-schema.ts";
import {
  procedureSpecs,
  generateProceduresFor,
  type Dialect,
} from "./procedures/driver.ts";
import { dialect as postgres } from "./procedures/postgres.ts";
import { dialect as mysql } from "./procedures/mysql.ts";
import { dialect as sqlserver } from "./procedures/sqlserver.ts";
import { dropRoutineTmpl } from "../resources/procedures-shared.ts";
import {
  migrationUpTmpl as pgUp,
  migrationDownTmpl as pgDown,
} from "../resources/procedures-postgres.ts";
import {
  migrationUpTmpl as myUp,
  migrationDownTmpl as myDown,
} from "../resources/procedures-mysql.ts";
import {
  migrationUpTmpl as ssUp,
  migrationDownTmpl as ssDown,
} from "../resources/procedures-sqlserver.ts";

const DATASOURCE_TYPES_YAML = "datasource_types.yaml";
const DATASOURCE_SEEDS_YAML = "datasource_seeds.yaml";

const DIALECT_MODULES: Partial<Record<SqlDialect, Dialect>> = {
  postgres,
  mysql,
  sqlserver,
};

const ROUTINE_KIND: Partial<
  Record<SqlDialect, "function" | "procedure">
> = {
  postgres: "function",
  mysql: "procedure",
  sqlserver: "procedure",
};

const MIGRATION_TMPLS: Partial<
  Record<SqlDialect, { up: string; down: string }>
> = {
  postgres: { up: pgUp, down: pgDown },
  mysql: { up: myUp, down: myDown },
  sqlserver: { up: ssUp, down: ssDown },
};

type ProcedureFileOpts = {
  useOptimisticConcurrency?: boolean;
  idType?: string;
};

type GenerateProcedureFileArgs = {
  dialect: SqlDialect;
  tables: NormalizedTable[];
  byFieldsByEntity: Map<string, string[]>;
  opts?: ProcedureFileOpts;
};

type RoutineName = {
  kind: "function" | "procedure";
  name: string;
};

const generateProcedureFile = ({
  dialect,
  tables,
  byFieldsByEntity,
  opts,
}: GenerateProcedureFileArgs): string => {
  const mod = DIALECT_MODULES[dialect];
  if (!mod) return "";
  const occ = opts?.useOptimisticConcurrency === true;
  for (const t of tables) {
    if (!tableHasAuditColumns(t, { useOptimisticConcurrency: occ })) {
      throw new Error(
        `cannot generate procs for ${t.entityName}: requires audit columns`,
      );
    }
  }

  const blocks = tables.map((t) => ({
    entityName: t.entityName,
    stmts: generateProceduresFor(mod, t, {
      byFields: byFieldsByEntity.get(t.entityName) ?? [],
      useOptimisticConcurrency: occ,
      idType: opts?.idType,
    }),
  }));

  return `${blocks
    .map(({ entityName, stmts }) =>
      [`-- ${entityName}`, ...stmts].join("\n\n"),
    )
    .join("\n\n")}\n`;
};

const listProcedureNames = ({
  dialect,
  tables,
  byFieldsByEntity,
  opts,
}: GenerateProcedureFileArgs): RoutineName[] => {
  const kind = ROUTINE_KIND[dialect];
  if (!kind) return [];
  const occ = opts?.useOptimisticConcurrency === true;
  const out: RoutineName[] = [];
  for (const t of tables) {
    const byFields = byFieldsByEntity.get(t.entityName) ?? [];
    for (const spec of procedureSpecs(t.entityName, { byFields, occ })) {
      out.push({ kind, name: spec.name });
    }
  }
  return out;
};

const generateStoredProceduresMigration = (
  language: string,
  data: SchemaData,
  opts: GenerateTableOptions & { byFieldsByEntity: Map<string, string[]> },
): { up: SqlFile; down: SqlFile } | null => {
  const dialect = normalizeDialect(language);
  if (!dialect || !supportsProcedures(dialect)) return null;

  const tmpls = MIGRATION_TMPLS[dialect];
  if (!tmpls) return null;

  const occ = opts.useOptimisticConcurrency === true;
  const tables = buildLiveTables(language, data, opts).filter((t) =>
    tableHasAuditColumns(t, { useOptimisticConcurrency: occ }),
  );
  if (tables.length === 0) return null;

  const procArgs: GenerateProcedureFileArgs = {
    dialect,
    tables,
    byFieldsByEntity: opts.byFieldsByEntity,
    opts: { useOptimisticConcurrency: occ, idType: opts.idType },
  };
  const procText = generateProcedureFile(procArgs).trimEnd();
  if (procText.length === 0) return null;
  const names = listProcedureNames(procArgs);

  const up = fill(tmpls.up, { body: procText });
  const down = fill(tmpls.down, {
    drops: names.map((n) =>
      fill(dropRoutineTmpl, {
        verb: n.kind === "function" ? "FUNCTION" : "PROCEDURE",
        name: n.name,
      }).trimEnd(),
    ),
  });

  return {
    up: {
      path: "0002_stored_procedures_up.sql",
      content: up.endsWith("\n") ? up : `${up}\n`,
    },
    down: {
      path: "0002_stored_procedures_down.sql",
      content: down.endsWith("\n") ? down : `${down}\n`,
    },
  };
};

const loadSchema = async (ctx: GenerateContext): Promise<SchemaData> => {
  const yaml = await ctx.reader.read(DATASOURCE_TYPES_YAML);
  const seeds = (await ctx.reader.exists(DATASOURCE_SEEDS_YAML))
    ? await ctx.reader.read(DATASOURCE_SEEDS_YAML)
    : null;
  return parseDatasourceTypes(
    yaml,
    ctx.settings,
    seeds,
  ) as unknown as SchemaData;
};

/** Stored-procedure migration for one dialect — empty when unsupported or disabled. */
export const generateProceduresForDialect = async (
  dialect: SqlDialect,
  ctx: GenerateContext,
): Promise<GenerateEntry[]> => {
  if (!supportsProcedures(dialect)) return [];
  const ds = datasourceSettings(ctx.settings);
  if (!ds.useStoredProcedures) return [];

  const data = await loadSchema(ctx);
  const byFieldsByEntity = byFieldsFromDatasource(data);
  const sp = generateStoredProceduresMigration(dialect, data, {
    idType: ds.idType,
    withUuidColumn: ds.withUuidColumn,
    pluralizeTableNames: ds.pluralizeTableNames,
    useOptimisticConcurrency: ds.useOptimisticConcurrency,
    byFieldsByEntity,
  });
  return sp ? chainMigrationEntries(dialect, sp) : [];
};
