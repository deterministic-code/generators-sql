import { effectiveTableName } from "./effective-table-name.ts";
import { fill } from "@deterministic-code/generators-common/fill";
import type { GenerateContext } from "./generate-context.ts";
import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { chainMigrationEntries } from "./migration-entries.ts";
import { parseDatasourceTypes } from "../parse-datasource-types.ts";
import {
  buildLiveTables,
  buildTableNameMappings,
  datasourceSettings,
  datasourceSettingsFor,
  tableHasAuditColumns,
  type GenerateTableOptions,
  type NormalizedField,
  type NormalizedIndex,
  type NormalizedTable,
  type SchemaData,
  type SqlFile,
} from "./sql-schema.ts";
import {
  mapColumnType,
  q,
  requireDialect,
  type SqlDialect,
} from "./sql-dialect.ts";
import { buildCustomMigrationFiles } from "./generate-custom-migrations.ts";
import { assertSkipMigrationsCovered } from "./validate-skip-migrations-coverage.ts";
import { converterFor } from "../field-converters/index.ts";
import {
  renderSqlDefault,
  type IdColumnSuffixes,
} from "../field-converters/base.ts";
import { seedSections } from "./seed-generator.ts";
import {
  createIndexTmpl,
  createTableTmpl,
  migrationDownTmpl,
  migrationUpTmpl,
} from "../resources/sql.ts";

const finalizeSql = (text: string): string => {
  const out = text.replace(/\n{3,}/g, "\n\n");
  return out.endsWith("\n") ? out : `${out}\n`;
};

const col = (dialect: SqlDialect, name: string, type: string, rest = ""): string =>
  `${q(dialect, name)} ${type}${rest}`;

const columnDef = (dialect: SqlDialect, field: NormalizedField): string => {
  const parts = [col(dialect, field.name, mapColumnType(dialect, field))];
  if (!field.isNullable) parts.push("NOT NULL");
  if (field.isUnique) parts.push("UNIQUE");
  if (field.primaryKey) parts.push("PRIMARY KEY");
  const def = renderSqlDefault(converterFor(dialect), field);
  if (def !== null) parts.push(`DEFAULT ${def}`);
  else if (field.name === "uuid") {
    const uuidDef = converterFor(dialect).defaults.NewId();
    if (uuidDef !== null) parts.push(`DEFAULT ${uuidDef}`);
  }
  return parts.join(" ");
};

const foreignKey = (
  dialect: SqlDialect,
  field: NormalizedField,
  pluralize: boolean,
  mappings?: Map<string, string>,
): string => {
  const [refTable, refCol] = String(field.references).split(".");
  const ref =
    mappings?.get(refTable) ?? effectiveTableName(refTable, pluralize);
  return `FOREIGN KEY (${q(dialect, field.name)}) REFERENCES ${q(dialect, ref)}(${q(dialect, refCol)})`;
};

const tableColumnLines = (
  dialect: SqlDialect,
  table: NormalizedTable,
  opts: GenerateTableOptions,
): string[] => {
  const settings = datasourceSettingsFor(opts);
  const withAudit = tableHasAuditColumns(table, {
    useOptimisticConcurrency: opts.useOptimisticConcurrency === true,
  });
  const withUuid =
    (opts.withUuidColumn ?? settings.withUuidColumn) &&
    withAudit &&
    !table.fields.some((f) => f.name === "uuid");
  const skipFk = opts.skipForeignKeys === true;
  const pluralize = table.pluralizeTableNames === true;

  const lines: string[] = [];
  if (!table.fields.some((f) => f.primaryKey)) {
    const suffix =
      converterFor(dialect).idColumn[settings.idType as keyof IdColumnSuffixes];
    if (suffix !== undefined) lines.push(col(dialect, "id", suffix));
  }
  if (withUuid) {
    lines.push(col(dialect, "uuid", converterFor(dialect).uuidColumn));
  }
  const fks: string[] = [];
  for (const f of table.fields) {
    lines.push(columnDef(dialect, f));
    if (f.references && !skipFk) {
      fks.push(foreignKey(dialect, f, pluralize, opts.tableNameMappings));
    }
  }
  if (withAudit) {
    const ts = (name: string) =>
      col(
        dialect,
        name,
        mapColumnType(dialect, { type: "datetime" }),
        ` NOT NULL DEFAULT ${converterFor(dialect).defaults.UtcNow()}`,
      );
    lines.push(ts("created"), ts("updated"));
  }
  return [...lines, ...fks];
};

const createTableSql = (
  dialect: SqlDialect,
  table: NormalizedTable,
  opts: GenerateTableOptions,
): string => {
  const lines = tableColumnLines(dialect, table, opts);
  return fill(createTableTmpl, {
    quotedName: q(dialect, table.name),
    columns: lines.map((line, i) => ({
      line,
      last: i === lines.length - 1,
    })),
  }).trimEnd();
};

const createIndexSql = (
  dialect: SqlDialect,
  tableName: string,
  idx: NormalizedIndex,
): string =>
  fill(createIndexTmpl, {
    isUnique: idx.isUnique,
    quotedName: q(dialect, idx.name),
    quotedTable: q(dialect, tableName),
    quotedCols: idx.fields.map((c) => q(dialect, c)).join(", "),
  }).trimEnd();

const flattenTable = (
  dialect: SqlDialect,
  table: NormalizedTable,
  opts: GenerateTableOptions,
) => {
  const indexes = table.indexes.map((idx) =>
    createIndexSql(dialect, table.name, idx),
  );
  return {
    createTable: createTableSql(dialect, table, opts),
    indexesBlock: indexes.join("\n"),
    trigger: tableHasAuditColumns(table)
      ? converterFor(dialect).updatedTrigger(table)
      : "",
  };
};

export const generateInitialMigration = (
  language: string,
  data: SchemaData,
  opts: GenerateTableOptions = {},
): { up: SqlFile; down: SqlFile } => {
  const dialect = requireDialect(language);
  const settings = datasourceSettingsFor(opts);
  const withUuidColumn = opts.withUuidColumn ?? settings.withUuidColumn;
  const live = buildLiveTables(language, data, {
    pluralizeTableNames: opts.pluralizeTableNames === true,
    idType: settings.idType,
  });
  const createOpts: GenerateTableOptions = {
    idType: settings.idType,
    withUuidColumn,
    tableNameMappings: buildTableNameMappings(data),
  };
  const preamble = converterFor(dialect).migrationPreamble().join("\n");
  const seeds = seedSections(dialect, live, {
    idType: settings.idType,
    withUuidColumn,
  });

  return {
    up: {
      path: "0001_initial_up.sql",
      content: finalizeSql(
        fill(migrationUpTmpl, {
          dialect,
          preamble: preamble ? `${preamble}\n` : "",
          tables: live.map((t) => flattenTable(dialect, t, createOpts)),
          hasSeeds: seeds.length > 0,
          seedBlocks: seeds,
        }),
      ),
    },
    down: {
      path: "0001_initial_down.sql",
      content: finalizeSql(
        fill(migrationDownTmpl, {
          dialect,
          dropStatements: [...live]
            .reverse()
            .map((t) => converterFor(dialect).dropTable(q(dialect, t.name))),
        }),
      ),
    },
  };
};

const customEntries = async (
  dialect: string,
  deterministicDir: string | undefined,
): Promise<GenerateEntry[]> => {
  if (!deterministicDir) return [];
  const files = await buildCustomMigrationFiles(deterministicDir, dialect);
  const seen = new Set<string>();
  for (const { filename } of files) {
    if (seen.has(filename)) {
      throw new Error(
        `custom migration filename collision for dialect '${dialect}': ${filename} is generated by both an included datasource and this project`,
      );
    }
    seen.add(filename);
  }
  return files.map((file) =>
    content(`${dialect}/migrations/${file.filename}`, file.content),
  );
};

const loadSchema = async (ctx: GenerateContext): Promise<SchemaData> => {
  const yaml = await ctx.reader.read("datasource_types.yaml");
  const seeds = (await ctx.reader.exists("datasource_seeds.yaml"))
    ? await ctx.reader.read("datasource_seeds.yaml")
    : null;
  return parseDatasourceTypes(
    yaml,
    ctx.settings,
    seeds,
  ) as unknown as SchemaData;
};

/** DDL initial migration (+ optional custom migrations) for one SQL dialect. */
export const generateSqlFor = async (
  dialect: SqlDialect,
  ctx: GenerateContext,
): Promise<GenerateEntry[]> => {
  const key = requireDialect(dialect);
  const data = await loadSchema(ctx);
  const ds = datasourceSettings(ctx.settings);
  const dir = ctx.settings["paths.deterministic"];
  if (dir) {
    await assertSkipMigrationsCovered({
      data,
      deterministicDir: dir,
      dialects: [key],
      useOptimisticConcurrency: ds.useOptimisticConcurrency,
    });
  }
  return [
    ...chainMigrationEntries(
      key,
      generateInitialMigration(key, data, {
        idType: ds.idType,
        withUuidColumn: ds.withUuidColumn,
        pluralizeTableNames: ds.pluralizeTableNames,
        useOptimisticConcurrency: ds.useOptimisticConcurrency,
      }),
    ),
    ...(await customEntries(key, dir)),
  ];
};
