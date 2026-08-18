import type { DialectConverter } from "./base.ts";
import sqlite from "./sqlite.ts";
import mysql from "./mysql.ts";
import postgres from "./postgres.ts";
import oracle from "./oracle.ts";
import sqlserver from "./sqlserver.ts";

/** Every SQL-dialect field-converter module, keyed by dialect. */
export const CONVERTER_MODULES: Record<string, DialectConverter> = {
  sqlite,
  mysql,
  postgres,
  oracle,
  sqlserver,
};

/** The converter module for a dialect key — throws on an unknown dialect. */
export function converterFor(dialect: string): DialectConverter {
  const mod = CONVERTER_MODULES[dialect];
  if (!mod) throw new Error(`Unknown dialect "${dialect}"`);
  return mod;
}
