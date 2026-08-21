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
import { createCasing, type PackCasing } from "./default-casing.ts";
import {
  buildLiveTables,
  hasAuditColumns,
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

const finalizeSql = (text: string, casing: PackCasing): string => {
  const out = casing.applyKeywords(text.replace(/\n{3,}/g, "\n\n"));
  return out.endsWith("\n") ? out : `${out}\n`;
};

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

const quotedConstraint = (
  dialect: SqlDialect,
  casing: PackCasing,
  entity: string,
  ...parts: string[]
): string => q(dialect, casing.constraintName(entity, ...parts));

const columnDef = (
  dialect: SqlDialect,
  casing: PackCasing,
  entity: string,
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
    quotedName: q(dialect, casing.columnName(field.name)),
    nativeType: mapColumnType(dialect, field),
    notNull: !field.isNullable,
    primaryKey: pk,
    quotedPkName: pk
      ? quotedConstraint(dialect, casing, entity, "primary_key")
      : undefined,
    hasDefault,
    namedDefault: hasDefault && supportsNamedDefault(dialect),
    quotedDefaultName:
      hasDefault && supportsNamedDefault(dialect)
        ? quotedConstraint(
            dialect,
            casing,
            entity,
            field.name,
            "default_constraint",
          )
        : undefined,
    defaultExpr: defaultExpr ?? undefined,
  });
};

const uniqueConstraint = (
  dialect: SqlDialect,
  casing: PackCasing,
  entity: string,
  column: string,
): string =>
  fill(uniqueConstraintTmpl, {
    quotedUniqueName: quotedConstraint(
      dialect,
      casing,
      entity,
      column,
      "unique_constraint",
    ),
    quotedName: q(dialect, casing.columnName(column)),
  }).trimEnd();

const foreignKey = (
  dialect: SqlDialect,
  casing: PackCasing,
  entity: string,
  field: DatasourceField,
): string => {
  const [refTable, refCol] = String(field.references).split(".");
  return fill(foreignKeyTmpl, {
    quotedFkName: quotedConstraint(
      dialect,
      casing,
      entity,
      field.name,
      "foreign_key",
    ),
    quotedName: q(dialect, casing.columnName(field.name)),
    quotedRefTable: q(dialect, casing.tableName(refTable)),
    quotedRefCol: q(dialect, casing.columnName(refCol)),
  }).trimEnd();
};

const tableColumnLines = (
  dialect: SqlDialect,
  table: LiveTable,
  casing: PackCasing,
): string[] => {
  const entity = table.name;
  const pkName = quotedConstraint(dialect, casing, entity, "primary_key");
  const utcNow =
    dialectConverter(dialect).conversions.datetime.defaults.UtcNow("");

  const timestampLine = (field: { name: string; type: string }): string => {
    const hasDefault = utcNow !== null;
    return columnLine({
      quotedName: q(dialect, casing.columnName(field.name)),
      nativeType: mapColumnType(dialect, { type: field.type }),
      notNull: true,
      hasDefault,
      namedDefault: hasDefault && supportsNamedDefault(dialect),
      quotedDefaultName:
        hasDefault && supportsNamedDefault(dialect)
          ? quotedConstraint(
              dialect,
              casing,
              entity,
              field.name,
              "default_constraint",
            )
          : undefined,
      defaultExpr: utcNow ?? undefined,
    });
  };

  const lines: string[] = [];
  const extras: string[] = [];
  for (const f of table.fields) {
    if (f.name === "id" && f.isPrimaryKey === true) {
      const idLine = fill(dialectSql[dialect].idColumn, {
        quotedName: q(dialect, casing.columnName("id")),
        quotedPkName: pkName,
        quotedDefaultName: quotedConstraint(
          dialect,
          casing,
          entity,
          "id",
          "default_constraint",
        ),
        integer: f.type === "integer",
        biginteger: f.type === "biginteger",
        uuid: f.type === "uuid",
        string: f.type === "string",
      }).trimEnd();
      if (idLine.length > 0) lines.push(idLine);
      continue;
    }
    if (f.name === "uuid") {
      lines.push(
        fill(dialectSql[dialect].uuidColumn, {
          quotedName: q(dialect, casing.columnName("uuid")),
          quotedDefaultName: quotedConstraint(
            dialect,
            casing,
            entity,
            "uuid",
            "default_constraint",
          ),
        }).trimEnd(),
      );
      extras.push(uniqueConstraint(dialect, casing, entity, "uuid"));
      continue;
    }
    if (f.name === "created" || f.name === "updated") {
      lines.push(timestampLine(f));
      continue;
    }
    lines.push(columnDef(dialect, casing, entity, f));
    if (f.isUnique === true) {
      extras.push(uniqueConstraint(dialect, casing, entity, f.name));
    }
    if (f.references) {
      extras.push(foreignKey(dialect, casing, entity, f));
    }
  }
  return [...lines, ...extras];
};

const createTableSql = (
  dialect: SqlDialect,
  table: LiveTable,
  casing: PackCasing,
): string => {
  const lines = tableColumnLines(dialect, table, casing);
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
  casing: PackCasing,
  table: LiveTable,
  idx: DatasourceIndex,
): string =>
  fill(createIndexTmpl, {
    isUnique: idx.isUnique,
    quotedName: quotedConstraint(dialect, casing, table.name, idx.name, "index"),
    quotedTable: q(dialect, table.tableName),
    quotedCols: idx.fields.map((c) => q(dialect, casing.columnName(c))).join(", "),
  }).trimEnd();

const flattenTable = (
  dialect: SqlDialect,
  table: LiveTable,
  casing: PackCasing,
) => {
  const indexes = table.indexes.map((idx) =>
    createIndexSql(dialect, casing, table, idx),
  );
  return {
    createTable: createTableSql(dialect, table, casing),
    indexesBlock: indexes.join("\n"),
    trigger: hasAuditColumns(table)
      ? renderUpdatedTrigger(dialect, table, casing)
      : "",
  };
};

const generateInitialMigration = (
  language: string,
  types: DatasourceType[],
  seedsByTable: Map<string, SeedRow[]>,
  casing: PackCasing,
): { up: SqlFile; down: SqlFile } => {
  const dialect = requireDialect(language);
  const live = buildLiveTables(types, casing);
  const preamble = renderPreamble(dialect);
  const seeds = seedSections(dialect, live, seedsByTable, casing);

  return {
    up: {
      path: "0001_initial_up.sql",
      content: finalizeSql(
        fill(migrationUpTmpl, {
          dialect,
          preamble: preamble ? `${preamble}\n` : "",
          tables: live.map((t) => flattenTable(dialect, t, casing)),
          hasSeeds: seeds.length > 0,
          seedBlocks: seeds,
        }),
        casing,
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
        casing,
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
  const casing = createCasing(ctx.settings);
  const data = await loadSchema(ctx);
  const dir = ctx.settings["paths.deterministic"];
  const initial = generateInitialMigration(
    key,
    data.types,
    data.seeds,
    casing,
  );
  return [
    content(`${key}/migrations/${initial.up.path}`, initial.up.content),
    content(`${key}/migrations/${initial.down.path}`, initial.down.content),
    ...(await customEntries(key, dir)),
    ...(await generateProceduresForDialect(dialect, ctx)),
  ];
};
