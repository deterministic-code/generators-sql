import type { NativeInfo } from "@deterministic-code/generators-common/base-type-converter";
import {
  renderDefault,
  type ConverterField,
  type SqlConversion,
} from "../base-type-converter.ts";
import * as mysql from "../mysql/base-type-converter.ts";
import * as oracle from "../oracle/base-type-converter.ts";
import * as postgres from "../postgres/base-type-converter.ts";
import * as sqlite from "../sqlite/base-type-converter.ts";
import * as sqlserver from "../sqlserver/base-type-converter.ts";

export const SQL_DIALECTS = [
  "sqlite",
  "mysql",
  "postgres",
  "sqlserver",
  "oracle",
] as const;

export type SqlDialect = (typeof SQL_DIALECTS)[number];

export type DialectTypeConverter = {
  sqlConversion: SqlConversion;
  conversions: Record<string, NativeInfo>;
  toNative: (specType: string) => string;
  toColumnType: (field: ConverterField) => string;
};

const DIALECTS: Record<SqlDialect, DialectTypeConverter> = {
  sqlite,
  mysql,
  postgres,
  sqlserver,
  oracle,
};

export const dialectConverter = (dialect: string): DialectTypeConverter => {
  const key = normalizeDialect(dialect) ?? dialect;
  const pack = DIALECTS[key as SqlDialect];
  if (pack === undefined) {
    throw new Error(`Unknown dialect "${dialect}"`);
  }
  return pack;
};

export const normalizeDialect = (
  raw: string | null | undefined,
): SqlDialect | null => {
  if (!raw) return null;
  const key = raw.toLowerCase();
  return (SQL_DIALECTS as readonly string[]).includes(key)
    ? (key as SqlDialect)
    : null;
};

/** Dialects listed in `datasource.dialects`, or every supported dialect. */
export const dialectsFromSettings = (
  settings: Record<string, string>,
): SqlDialect[] => {
  const raw = settings["datasource.dialects"];
  if (raw === undefined || raw === "") return [...SQL_DIALECTS];
  const out: SqlDialect[] = [];
  for (const item of raw.split(",")) {
    const key = normalizeDialect(item.trim());
    if (key !== null && !out.includes(key)) out.push(key);
  }
  return out.length > 0 ? out : [...SQL_DIALECTS];
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

export const q = (dialect: string, ident: string): string => {
  const { quoteLeft, quoteRight } = dialectConverter(dialect).sqlConversion;
  return `${quoteLeft}${ident}${quoteRight}`;
};

/** sqlite/oracle have no stored procedures — SP generators skip them. */
export const supportsProcedures = (dialect: string): boolean =>
  dialectConverter(dialect).sqlConversion.supportsProcedures;

export const mapColumnType = (
  dialect: string,
  field: ConverterField,
): string => {
  const pack = dialectConverter(dialect);
  if (field.type === "reference" && field.referencesType !== undefined) {
    return mapColumnType(dialect, {
      type: field.referencesType,
      size: field.referencesSize,
    });
  }
  return pack.toColumnType(field);
};

export const sqlDefault = (
  dialect: string,
  field: ConverterField,
): string | null =>
  renderDefault(
    dialectConverter(dialect).conversions,
    field.type,
    field.defaultValue,
  );
