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

const SQL_DIALECTS = [
  "sqlite",
  "mysql",
  "postgres",
  "sqlserver",
  "oracle",
] as const;

export type SqlDialect = (typeof SQL_DIALECTS)[number];

type Pack = {
  sqlConversion: SqlConversion;
  conversions: Record<string, NativeInfo>;
  toColumnType: (field: ConverterField) => string;
};

const DIALECTS: Record<SqlDialect, Pack> = {
  sqlite,
  mysql,
  postgres,
  sqlserver,
  oracle,
};

export const dialectConverter = (dialect: string): Pack => {
  const pack = DIALECTS[dialect as SqlDialect];
  if (pack === undefined) {
    throw new Error(
      `Unknown SQL dialect "${dialect}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  return pack;
};

export const requireDialect = (language: string): SqlDialect => {
  dialectConverter(language);
  return language as SqlDialect;
};

/** Dialects listed in `backend.datasources`. */
export const dialectsFromSettings = (
  settings: Record<string, string>,
): SqlDialect[] => {
  const raw = settings["backend.datasources"];
  if (raw === undefined || raw === "") return ["sqlite"];
  const out: SqlDialect[] = [];
  for (const name of raw.split(",")) {
    const key = name.trim();
    if (key === "") continue;
    const dialect = requireDialect(key);
    if (!out.includes(dialect)) out.push(dialect);
  }
  return out.length > 0 ? out : ["sqlite"];
};

export const q = (dialect: string, ident: string): string => {
  const { quoteLeft, quoteRight } = dialectConverter(dialect).sqlConversion;
  return `${quoteLeft}${ident}${quoteRight}`;
};

export const mapColumnType = (
  dialect: string,
  field: ConverterField,
): string => dialectConverter(dialect).toColumnType(field);

export const sqlDefault = (
  dialect: string,
  field: ConverterField,
): string | null =>
  renderDefault(
    dialectConverter(dialect).conversions,
    field.type,
    field.defaultValue,
  );
