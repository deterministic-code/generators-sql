import { fill } from "@deterministic-code/generators-common/fill";
import { dialectSql } from "../resources/sql.ts";
import { dialectConverter, q, type SqlDialect } from "./sql-dialect.ts";

type TriggerTable = {
  name: string;
  fields: { name: string; isPrimaryKey?: boolean }[];
};

const triggerTokens = (dialect: SqlDialect, table: TriggerTable) => {
  const pk = table.fields.find((f) => f.isPrimaryKey === true);
  return {
    quotedTable: q(dialect, table.name),
    quotedTrigger: q(dialect, `trg_${table.name}_updated_at`),
    quotedUpdated: q(dialect, "updated"),
    quotedPk: q(dialect, pk ? pk.name : "id"),
    quotedId: q(dialect, "id"),
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
): string =>
  fill(dialectSql[dialect].updatedTrigger, triggerTokens(dialect, table)).trimEnd();

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
): string => {
  const tmpl = dialectSql[dialect].seedAfter;
  return tmpl ? fill(tmpl, { tableName, quotedTable }).trimEnd() : "";
};
