import { fill } from "@deterministic-code/generators-common/fill";
import type {
  DatasourceIndex,
  SeedRow,
  TypeField,
} from "@deterministic-code/deterministic-specifications-typescript/parser";
import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { DeterministicParser } from "@deterministic-code/deterministic-specifications-typescript/parser";
import { isPkField, pkName } from "@deterministic-code/generators-common/spec-types";
import { createCasing, type PackCasing } from "./default-casing.ts";
import { SqlMapping } from "./sql-mapping.ts";
import {
  buildLiveTables,
  fieldOverlay,
  hasAuditColumns,
  occFieldOf,
  occOverlayOf,
  overlayOf,
  sqlTablesFrom,
  tableIdentity,
  usesGeneratedIdColumn,
  type LiveTable,
  type SqlFile,
  type SqlTable,
} from "./sql-schema.ts";
import {
  dialectConverter,
  mapColumnType,
  q,
  requireDialect,
  sqlDefault,
  type SqlDialect,
} from "./sql-dialect.ts";
import { emitsNativeRowVersion } from "../base-type-converter.ts";
import { converterFieldOf, occZeroDefault } from "./occ-sql.ts";
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
  primaryKeyConstraintTmpl,
  migrationDownTmpl,
  migrationUpTmpl,
} from "../resources/sql.ts";
import {
  renderDropTable,
  renderOccBumpTrigger,
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
  mapping: SqlMapping,
  table: SqlTable,
  ...parts: string[]
): string => q(dialect, mapping.constraintName(table, ...parts));

const columnDef = (
  dialect: SqlDialect,
  mapping: SqlMapping,
  table: SqlTable,
  field: TypeField,
): string => {
  const overlay = fieldOverlay(table, field.name);
  const converterField = converterFieldOf(field, overlay);
  let defaultExpr = sqlDefault(dialect, converterField);
  if (defaultExpr === null && field.name === "uuid") {
    defaultExpr =
      dialectConverter(dialect).conversions.uuid.defaults.NewId("") ?? null;
  }
  if (emitsNativeRowVersion(converterField, dialect)) defaultExpr = null;
  else if (
    converterField.isOptimisticConcurrency === true &&
    field.type === "binary" &&
    (defaultExpr === null ||
      defaultExpr === "" ||
      defaultExpr === "0x" ||
      defaultExpr === "X''" ||
      defaultExpr === `'\\x'`)
  ) {
    defaultExpr = occZeroDefault(dialect);
  }
  if (defaultExpr === "") defaultExpr = null;
  const keys = tableIdentity(table);
  const pk = keys.length === 1 && isPkField(field, table, overlayOf(table));
  const hasDefault = defaultExpr !== null;
  return columnLine({
    quotedName: q(dialect, mapping.columnName(table, field.name)),
    nativeType: mapColumnType(dialect, converterField),
    notNull: !field.isNullable || keys.includes(field.name),
    primaryKey: pk,
    quotedPkName: pk
      ? quotedConstraint(dialect, mapping, table, "primary_key")
      : undefined,
    hasDefault,
    namedDefault: hasDefault && supportsNamedDefault(dialect),
    quotedDefaultName:
      hasDefault && supportsNamedDefault(dialect)
        ? quotedConstraint(
            dialect,
            mapping,
            table,
            mapping.fieldStem(table, field.name),
            "default_constraint",
          )
        : undefined,
    defaultExpr: defaultExpr ?? undefined,
  });
};

const uniqueConstraint = (
  dialect: SqlDialect,
  mapping: SqlMapping,
  table: SqlTable,
  column: string,
): string =>
  fill(uniqueConstraintTmpl, {
    quotedUniqueName: quotedConstraint(
      dialect,
      mapping,
      table,
      mapping.fieldStem(table, column),
      "unique_constraint",
    ),
    quotedName: q(dialect, mapping.columnName(table, column)),
  }).trimEnd();

const compositePrimaryKey = (
  dialect: SqlDialect,
  mapping: SqlMapping,
  table: SqlTable,
  keys: string[],
): string =>
  fill(primaryKeyConstraintTmpl, {
    quotedPkName: quotedConstraint(dialect, mapping, table, "primary_key"),
    quotedCols: keys
      .map((c) => q(dialect, mapping.columnName(table, c)))
      .join(", "),
  }).trimEnd();

const foreignKey = (
  dialect: SqlDialect,
  mapping: SqlMapping,
  table: SqlTable,
  field: TypeField,
): string => {
  const ref = mapping.resolveReference(field.references!);
  return fill(foreignKeyTmpl, {
    quotedFkName: quotedConstraint(
      dialect,
      mapping,
      table,
      mapping.fieldStem(table, field.name),
      "foreign_key",
    ),
    quotedName: q(dialect, mapping.columnName(table, field.name)),
    quotedRefTable: q(dialect, ref.tableName),
    quotedRefCol: q(dialect, ref.columnName),
  }).trimEnd();
};

const tableColumnLines = (
  dialect: SqlDialect,
  table: LiveTable,
  mapping: SqlMapping,
): string[] => {
  const quotedPkName = quotedConstraint(dialect, mapping, table, "primary_key");
  const utcNow =
    dialectConverter(dialect).conversions.datetime.defaults.UtcNow("");

  const timestampLine = (field: { name: string; type: string }): string => {
    const hasDefault = utcNow !== null;
    return columnLine({
      quotedName: q(dialect, mapping.columnName(table, field.name)),
      nativeType: mapColumnType(dialect, { type: field.type }),
      notNull: true,
      hasDefault,
      namedDefault: hasDefault && supportsNamedDefault(dialect),
      quotedDefaultName:
        hasDefault && supportsNamedDefault(dialect)
          ? quotedConstraint(
              dialect,
              mapping,
              table,
              mapping.fieldStem(table, field.name),
              "default_constraint",
            )
          : undefined,
      defaultExpr: utcNow ?? undefined,
    });
  };

  const keys = tableIdentity(table);
  const lines: string[] = [];
  const extras: string[] = [];
  if (keys.length > 1) {
    extras.push(compositePrimaryKey(dialect, mapping, table, keys));
  }
  for (const f of table.fields) {
    if (usesGeneratedIdColumn(table, f)) {
      const idLine = fill(dialectSql[dialect].idColumn, {
        quotedName: q(dialect, mapping.columnName(table, f.name)),
        quotedPkName,
        quotedDefaultName: quotedConstraint(
          dialect,
          mapping,
          table,
          mapping.fieldStem(table, f.name),
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
          quotedName: q(dialect, mapping.columnName(table, "uuid")),
          quotedDefaultName: quotedConstraint(
            dialect,
            mapping,
            table,
            mapping.fieldStem(table, "uuid"),
            "default_constraint",
          ),
        }).trimEnd(),
      );
      extras.push(uniqueConstraint(dialect, mapping, table, "uuid"));
      continue;
    }
    if (f.name === "created" || f.name === "updated") {
      lines.push(timestampLine(f));
      continue;
    }
    lines.push(columnDef(dialect, mapping, table, f));
    if (fieldOverlay(table, f.name)?.isUnique === true) {
      extras.push(uniqueConstraint(dialect, mapping, table, f.name));
    }
    if (f.references) {
      extras.push(foreignKey(dialect, mapping, table, f));
    }
  }
  return [...lines, ...extras];
};

const createTableSql = (
  dialect: SqlDialect,
  table: LiveTable,
  mapping: SqlMapping,
): string => {
  const lines = tableColumnLines(dialect, table, mapping);
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
  mapping: SqlMapping,
  table: LiveTable,
  idx: DatasourceIndex,
): string =>
  fill(createIndexTmpl, {
    isUnique: idx.isUnique,
    quotedName: quotedConstraint(dialect, mapping, table, idx.name, "index"),
    quotedTable: q(dialect, table.tableName),
    quotedCols: idx.fields
      .map((c) => q(dialect, mapping.columnName(table, c)))
      .join(", "),
  }).trimEnd();

const flattenTable = (
  dialect: SqlDialect,
  table: LiveTable,
  mapping: SqlMapping,
) => {
  const indexes = table.indexes.map((idx) =>
    createIndexSql(dialect, mapping, table, idx),
  );
  const live = { ...table, pkName: pkName(table, overlayOf(table)) };
  const audit = hasAuditColumns(table)
    ? renderUpdatedTrigger(dialect, live, mapping)
    : "";
  const occField = occFieldOf(table);
  const occOverlay = occOverlayOf(table);
  const occConverter = occField
    ? converterFieldOf(occField, occOverlay)
    : undefined;
  const occ =
    occConverter && !emitsNativeRowVersion(occConverter, dialect)
      ? renderOccBumpTrigger(dialect, live, mapping, occConverter)
      : "";
  return {
    createTable: createTableSql(dialect, table, mapping),
    indexesBlock: indexes.join("\n"),
    trigger: [audit, occ].filter((part) => part !== "").join("\n\n"),
  };
};

const generateInitialMigration = (
  language: string,
  types: SqlTable[],
  seedsByTable: Map<string, SeedRow[]>,
  casing: PackCasing,
): { up: SqlFile; down: SqlFile } => {
  const dialect = requireDialect(language);
  const mapping = new SqlMapping(casing, types);
  const live = buildLiveTables(types, mapping);
  const preamble = renderPreamble(dialect);
  const seeds = seedSections(dialect, live, seedsByTable, mapping);

  return {
    up: {
      path: "0001_initial_up.sql",
      content: finalizeSql(
        fill(migrationUpTmpl, {
          dialect,
          preamble: preamble ? `${preamble}\n` : "",
          tables: live.map((t) => flattenTable(dialect, t, mapping)),
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
  types: SqlTable[];
  seeds: Map<string, SeedRow[]>;
}> => {
  const spec = await DeterministicParser(ctx.reader).parse(ctx.settings);
  return {
    types: sqlTablesFrom(spec),
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
