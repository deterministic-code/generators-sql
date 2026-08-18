import type { ConverterModule } from "./field-converters/base.ts";
import sqlite from "./field-converters/sqlite.ts";
import mysql from "./field-converters/mysql.ts";
import postgres from "./field-converters/postgres.ts";
import oracle from "./field-converters/oracle.ts";
import sqlserver from "./field-converters/sqlserver.ts";

/** Every SQL-dialect field-converter module, keyed by dialect. */
export const CONVERTER_MODULES: Record<string, ConverterModule> = {
  sqlite,
  mysql,
  postgres,
  oracle,
  sqlserver,
};
