import { effectiveTableName } from "./effective-table-name.ts";
import { fill } from "@deterministic-code/generators-common/fill";
import type {
  DatasourceField,
  DatasourceIndex,
  DatasourceType,
  SeedRow,
} from "@deterministic-code/generators-common/specification";
import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { DeterministicParser } from "@deterministic-code/generators-common/specification-parser";
import { DATASOURCE_TYPES_YAML } from "@deterministic-code/generators-common/specification";
import {
  buildLiveTables,
  datasourceSettings,
  datasourceSettingsFor,
  hasAuditColumns,
  type DatasourceOptions,
  type LiveTable,
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
import { generateProceduresForDialect } from "./generate-procedures.ts";
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
  field: DatasourceField,
): string => {
  let defaultExpr = sqlDefault(dialect, field);
  if (defaultExpr === null && field.name === "uuid") {
    defaultExpr =
      dialectConverter(dialect).conversions.uuid.defaults.NewId("") ?? null;
  }
  if (defaultExpr === "") defaultExpr = null;
  const pk = field.isPrimaryKey === true;
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
  field: DatasourceField,
  pluralize: boolean,
): string => {
  const [refTable, refCol] = String(field.references).split(".");
  const ref = effectiveTableName(refTable, pluralize);
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
  table: LiveTable,
  opts: DatasourceOptions,
): string[] => {
  const settings = datasourceSettingsFor(opts);
  const pluralize = opts.pluralizeTableNames === true;
  const physical = table.tableName;
  const pkName = constraintIdent(dialect, physical, "primary_key");
  const utcNow =
    dialectConverter(dialect).conversions.datetime.defaults.UtcNow("");

  const timestampLine = (name: string): string => {
    const hasDefault = utcNow !== null;
    return columnLine({
      quotedName: q(dialect, name),
      nativeType: mapColumnType(dialect, { type: "datetime" }),
      notNull: true,
      hasDefault,
      namedDefault: hasDefault && supportsNamedDefault(dialect),
      quotedDefaultName:
        hasDefault && supportsNamedDefault(dialect)
          ? constraintIdent(dialect, physical, name, "default_constraint")
          : undefined,
      defaultExpr: utcNow ?? undefined,
    });
  };

  const lines: string[] = [];
  const extras: string[] = [];
  for (const f of table.fields) {
    if (f.name === "id" && f.isPrimaryKey === true) {
      const idType = settings.idType;
      const idLine = fill(dialectSql[dialect].idColumn, {
        quotedName: q(dialect, "id"),
        quotedPkName: pkName,
        quotedDefaultName: constraintIdent(
          dialect,
          physical,
          "id",
          "default_constraint",
        ),
        integer: idType === "integer",
        biginteger: idType === "biginteger",
        uuid: idType === "uuid",
        string: idType === "string",
      }).trimEnd();
      if (idLine.length > 0) lines.push(idLine);
      continue;
    }
    if (f.name === "uuid") {
      lines.push(
        fill(dialectSql[dialect].uuidColumn, {
          quotedName: q(dialect, "uuid"),
          quotedDefaultName: constraintIdent(
            dialect,
            physical,
            "uuid",
            "default_constraint",
          ),
        }).trimEnd(),
      );
      extras.push(uniqueConstraint(dialect, physical, "uuid"));
      continue;
    }
    if (f.name === "created" || f.name === "updated") {
      lines.push(timestampLine(f.name));
      continue;
    }
    lines.push(columnDef(dialect, physical, f));
    if (f.isUnique === true) {
      extras.push(uniqueConstraint(dialect, physical, f.name));
    }
    if (f.references) {
      extras.push(foreignKey(dialect, physical, f, pluralize));
    }
  }
  return [...lines, ...extras];
};

const createTableSql = (
  dialect: SqlDialect,
  table: LiveTable,
  opts: DatasourceOptions,
): string => {
  const lines = tableColumnLines(dialect, table, opts);
  return fill(createTableTmpl, {
    quotedName: q(dialect, table.tableName),
    columns: lines.map((line, i) => ({
      line,
      last: i === lines.length - 1,
    })),
  }).trimEnd();
};

const createIndexSql = (
  dialect: SqlDialect,
  tableName: string,
  idx: DatasourceIndex,
): string =>
  fill(createIndexTmpl, {
    isUnique: idx.isUnique,
    quotedName: constraintIdent(dialect, tableName, idx.name, "index"),
    quotedTable: q(dialect, tableName),
    quotedCols: idx.fields.map((c) => q(dialect, c)).join(", "),
  }).trimEnd();

const flattenTable = (
  dialect: SqlDialect,
  table: LiveTable,
  opts: DatasourceOptions,
) => {
  const indexes = table.indexes.map((idx) =>
    createIndexSql(dialect, table.tableName, idx),
  );
  return {
    createTable: createTableSql(dialect, table, opts),
    indexesBlock: indexes.join("\n"),
    trigger: hasAuditColumns(table)
      ? renderUpdatedTrigger(dialect, {
          name: table.tableName,
          fields: table.fields,
        })
      : "",
  };
};

const generateInitialMigration = (
  language: string,
  types: DatasourceType[],
  seedsByTable: Map<string, SeedRow[]>,
  opts: DatasourceOptions,
): { up: SqlFile; down: SqlFile } => {
  const dialect = requireDialect(language);
  const live = buildLiveTables(language, types, {
    pluralizeTableNames: opts.pluralizeTableNames === true,
  });
  const preamble = renderPreamble(dialect);
  const seeds = seedSections(dialect, live, seedsByTable, opts);

  return {
    up: {
      path: "0001_initial_up.sql",
      content: finalizeSql(
        fill(migrationUpTmpl, {
          dialect,
          preamble: preamble ? `${preamble}\n` : "",
          tables: live.map((t) => flattenTable(dialect, t, opts)),
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
            .map((t) => renderDropTable(dialect, t.tableName)),
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

const loadSchema = async (
  ctx: GenerateContext,
): Promise<{
  types: DatasourceType[];
  seeds: Map<string, SeedRow[]>;
}> => {
  await ctx.reader.read(DATASOURCE_TYPES_YAML);
  const spec = await DeterministicParser(ctx.reader).parse(ctx.settings);
  return {
    types: spec.expandedDatasourceTypes,
    seeds: spec.datasourceSeeds,
  };
};

/** DDL initial migration (+ optional custom migrations and stored procedures) for one SQL dialect. */
export const generateSqlFor = async (
  dialect: SqlDialect,
  ctx: GenerateContext,
): Promise<GenerateEntry[]> => {
  const key = requireDialect(dialect);
  const ds = datasourceSettings(ctx.settings);
  const data = await loadSchema(ctx);
  const dir = ctx.settings["paths.deterministic"];
  const initial = generateInitialMigration(key, data.types, data.seeds, {
    idType: ds.idType,
    withUuidColumn: ds.withUuidColumn,
    pluralizeTableNames: ds.pluralizeTableNames,
    useOptimisticConcurrency: ds.useOptimisticConcurrency,
  });
  return [
    content(`${key}/migrations/${initial.up.path}`, initial.up.content),
    content(`${key}/migrations/${initial.down.path}`, initial.down.content),
    ...(await customEntries(key, dir)),
    ...(await generateProceduresForDialect(dialect, ctx)),
  ];
};
