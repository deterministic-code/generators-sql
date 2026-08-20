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
  dialectConverter,
  mapColumnType,
  q,
  requireDialect,
  sqlDefault,
  type SqlDialect,
} from "./sql-dialect.ts";
import { buildCustomMigrationFiles } from "./generate-custom-migrations.ts";
import { assertSkipMigrationsCovered } from "./validate-skip-migrations-coverage.ts";
import { seedSections } from "./seed-generator.ts";
import {
  columnTmpl,
  createIndexTmpl,
  createTableTmpl,
  dialectSql,
  foreignKeyTmpl,
  uniqueConstraintTmpl,
  migrationDownTmpl,
  migrationUpTmpl,
} from "../resources/sql.ts";
import {
  renderDropTable,
  renderPreamble,
  renderUpdatedTrigger,
} from "./render-ddl.ts";

const finalizeSql = (text: string): string => {
  const out = text.replace(/\n{3,}/g, "\n\n");
  return out.endsWith("\n") ? out : `${out}\n`;
};

const constraintIdent = (
  dialect: SqlDialect,
  table: string,
  ...parts: string[]
): string => q(dialect, [table, ...parts].join("_"));

const supportsNamedDefault = (dialect: SqlDialect): boolean =>
  dialect === "sqlserver";

type ColumnTokens = {
  quotedName: string;
  nativeType: string;
  notNull?: boolean;
  primaryKey?: boolean;
  quotedPkName?: string;
  hasDefault?: boolean;
  namedDefault?: boolean;
  quotedDefaultName?: string;
  defaultExpr?: string;
};

const columnLine = (tokens: ColumnTokens): string =>
  fill(columnTmpl, tokens).trimEnd();

const columnDef = (
  dialect: SqlDialect,
  tableName: string,
  field: NormalizedField,
): string => {
  let defaultExpr = sqlDefault(dialect, field);
  if (defaultExpr === null && field.name === "uuid") {
    defaultExpr =
      dialectConverter(dialect).conversions.uuid.defaults.NewId("") ?? null;
  }
  if (defaultExpr === "") defaultExpr = null;
  const pk = field.primaryKey === true;
  const hasDefault = defaultExpr !== null;
  return columnLine({
    quotedName: q(dialect, field.name),
    nativeType: mapColumnType(dialect, field),
    notNull: !field.isNullable,
    primaryKey: pk,
    quotedPkName: pk
      ? constraintIdent(dialect, tableName, "primary_key")
      : undefined,
    hasDefault,
    namedDefault: hasDefault && supportsNamedDefault(dialect),
    quotedDefaultName:
      hasDefault && supportsNamedDefault(dialect)
        ? constraintIdent(
            dialect,
            tableName,
            field.name,
            "default_constraint",
          )
        : undefined,
    defaultExpr: defaultExpr ?? undefined,
  });
};

const uniqueConstraint = (
  dialect: SqlDialect,
  tableName: string,
  column: string,
): string =>
  fill(uniqueConstraintTmpl, {
    quotedUniqueName: constraintIdent(
      dialect,
      tableName,
      column,
      "unique_constraint",
    ),
    quotedName: q(dialect, column),
  }).trimEnd();

const foreignKey = (
  dialect: SqlDialect,
  tableName: string,
  field: NormalizedField,
  pluralize: boolean,
  mappings?: Map<string, string>,
): string => {
  const [refTable, refCol] = String(field.references).split(".");
  const ref =
    mappings?.get(refTable) ?? effectiveTableName(refTable, pluralize);
  return fill(foreignKeyTmpl, {
    quotedFkName: constraintIdent(
      dialect,
      tableName,
      field.name,
      "foreign_key",
    ),
    quotedName: q(dialect, field.name),
    quotedRefTable: q(dialect, ref),
    quotedRefCol: q(dialect, refCol),
  }).trimEnd();
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
  const pkName = constraintIdent(dialect, table.name, "primary_key");
  if (!table.fields.some((f) => f.primaryKey)) {
    const idType = settings.idType;
    const idLine = fill(dialectSql[dialect].idColumn, {
      quotedName: q(dialect, "id"),
      quotedPkName: pkName,
      quotedDefaultName: constraintIdent(
        dialect,
        table.name,
        "id",
        "default_constraint",
      ),
      integer: idType === "integer",
      biginteger: idType === "biginteger",
      uuid: idType === "uuid",
      string: idType === "string",
    }).trimEnd();
    if (idLine.length > 0) lines.push(idLine);
  }
  if (withUuid) {
    lines.push(
      fill(dialectSql[dialect].uuidColumn, {
        quotedName: q(dialect, "uuid"),
        quotedDefaultName: constraintIdent(
          dialect,
          table.name,
          "uuid",
          "default_constraint",
        ),
      }).trimEnd(),
    );
  }
  const extras: string[] = [];
  if (withUuid) {
    extras.push(uniqueConstraint(dialect, table.name, "uuid"));
  }
  for (const f of table.fields) {
    lines.push(columnDef(dialect, table.name, f));
    if (f.isUnique === true) {
      extras.push(uniqueConstraint(dialect, table.name, f.name));
    }
    if (f.references && !skipFk) {
      extras.push(
        foreignKey(
          dialect,
          table.name,
          f,
          pluralize,
          opts.tableNameMappings,
        ),
      );
    }
  }
  if (withAudit) {
    const utcNow =
      dialectConverter(dialect).conversions.datetime.defaults.UtcNow("");
    const ts = (name: string) => {
      const hasDefault = utcNow !== null;
      return columnLine({
        quotedName: q(dialect, name),
        nativeType: mapColumnType(dialect, { type: "datetime" }),
        notNull: true,
        hasDefault,
        namedDefault: hasDefault && supportsNamedDefault(dialect),
        quotedDefaultName:
          hasDefault && supportsNamedDefault(dialect)
            ? constraintIdent(dialect, table.name, name, "default_constraint")
            : undefined,
        defaultExpr: utcNow ?? undefined,
      });
    };
    lines.push(ts("created"), ts("updated"));
  }
  return [...lines, ...extras];
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
    quotedName: constraintIdent(dialect, tableName, idx.name, "index"),
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
      ? renderUpdatedTrigger(dialect, table)
      : "",
  };
};

const generateInitialMigration = (
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
  const preamble = renderPreamble(dialect);
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
            .map((t) => renderDropTable(dialect, t.name)),
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
