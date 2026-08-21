import { fill } from "@deterministic-code/generators-common/fill";
import { dialectSql } from "../resources/sql.ts";
import type { PackCasing } from "./default-casing.ts";
import { dialectConverter, q, type SqlDialect } from "./sql-dialect.ts";

type TriggerTable = {
  name: string;
  tableName: string;
  fields: { name: string; isPrimaryKey?: boolean }[];
};

const triggerTokens = (
  dialect: SqlDialect,
  table: TriggerTable,
  casing: PackCasing,
) => {
  const pk = table.fields.find((f) => f.isPrimaryKey === true);
  return {
    quotedTable: q(dialect, table.tableName),
    quotedTrigger: q(dialect, casing.triggerName(table.name)),
    quotedUpdated: q(dialect, casing.columnName("updated")),
    quotedPk: q(dialect, casing.columnName(pk ? pk.name : "id")),
    quotedId: q(dialect, casing.columnName("id")),
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
  casing: PackCasing,
): string =>
  fill(
    dialectSql[dialect].updatedTrigger,
    triggerTokens(dialect, table, casing),
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
