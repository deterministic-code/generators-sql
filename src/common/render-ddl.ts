import { fill } from "@deterministic-code/generators-common/fill";
import { dialectSql } from "../resources/sql.ts";
import type { SqlMapping } from "./sql-mapping.ts";
import type { SqlTable } from "./sql-schema.ts";
import { dialectConverter, q, type SqlDialect } from "./sql-dialect.ts";

type TriggerTable = SqlTable & { tableName: string; pkName?: string };

const triggerTokens = (
  dialect: SqlDialect,
  table: TriggerTable,
  mapping: SqlMapping,
) => {
  const pk = table.pkName ?? "id";
  return {
    quotedTable: q(dialect, table.tableName),
    quotedTrigger: q(dialect, mapping.triggerName(table)),
    quotedUpdated: q(dialect, mapping.columnName(table, "updated")),
    quotedPk: q(dialect, mapping.columnName(table, pk)),
    quotedId: q(dialect, mapping.columnName(table, "id")),
    utcNow: dialectConverter(dialect).conversions.datetime.defaults.UtcNow(""),
  };
};

export const renderDropTable = (
  dialect: SqlDialect,
  tableName: string,
): string =>
  fill(dialectSql[dialect].dropTable, {
    quotedName: q(dialect, tableName),
  }).trimEnd();

export const renderUpdatedTrigger = (
  dialect: SqlDialect,
  table: TriggerTable,
  mapping: SqlMapping,
): string =>
  fill(
    dialectSql[dialect].updatedTrigger,
    triggerTokens(dialect, table, mapping),
  ).trimEnd();

export const renderPreamble = (dialect: SqlDialect): string => {
  const tmpl = dialectSql[dialect].preamble;
  return tmpl ? fill(tmpl, {}) : "";
};

export const renderSeedBefore = (
  dialect: SqlDialect,
  quotedTable: string,
): string => {
  const tmpl = dialectSql[dialect].seedBefore;
  return tmpl ? fill(tmpl, { quotedTable }).trimEnd() : "";
};

export const renderSeedAfter = (
  dialect: SqlDialect,
  tableName: string,
  quotedTable: string,
  idColumn: string,
  quotedId: string,
): string => {
  const tmpl = dialectSql[dialect].seedAfter;
  return tmpl
    ? fill(tmpl, { tableName, quotedTable, idColumn, quotedId }).trimEnd()
    : "";
};
