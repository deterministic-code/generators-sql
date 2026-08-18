import {
  CONVERTER_MODULES,
  converterFor,
} from "../field-converters/index.ts";
import {
  nativeTypeFor,
  type ConverterField,
} from "../field-converters/base.ts";

export const SQL_DIALECTS = [
  "sqlite",
  "mysql",
  "postgres",
  "sqlserver",
  "oracle",
] as const;

export type SqlDialect = (typeof SQL_DIALECTS)[number];
export const DEFAULT_SQL_DIALECT: SqlDialect = "sqlite";

export const normalizeDialect = (
  raw: string | null | undefined,
): SqlDialect | null => {
  if (!raw) return null;
  const key = raw.toLowerCase();
  return (SQL_DIALECTS as readonly string[]).includes(key)
    ? (key as SqlDialect)
    : null;
};

export const requireDialect = (language: string): SqlDialect => {
  const key = normalizeDialect(language);
  if (!key) {
    throw new Error(
      `Unknown SQL dialect "${language}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  return key;
};

export const q = (dialect: string, ident: string): string =>
  (CONVERTER_MODULES[dialect] ?? CONVERTER_MODULES.sqlite).quote(ident);

/** sqlite/oracle have no stored procedures — SP generators skip them. */
export const supportsProcedures = (dialect: string): boolean => {
  const key = normalizeDialect(dialect) ?? dialect;
  return CONVERTER_MODULES[key]?.supportsProcedures === true;
};

export const mapColumnType = (
  dialect: string,
  field: ConverterField,
): string => nativeTypeFor(converterFor(dialect), field);
