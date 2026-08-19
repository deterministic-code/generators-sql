import type { NativeInfo } from "@deterministic-code/generators-common/base-type-converter";
import {
  booleanDefaults,
  charLen,
  datetimeDefaults,
  decimalPrecisionScale,
  numeric,
  sized,
  stringy,
  toNativeFrom,
  uuidDefaults,
  type ConverterField,
  type SqlConversion,
} from "../base-type-converter.ts";

export const sqlConversion: SqlConversion = {
  quoteLeft: '"',
  quoteRight: '"',
  supportsProcedures: true,
};

const stringCol = sized("TEXT", (n) => `VARCHAR(${n})`);

export const conversions: Record<string, NativeInfo> = {
  string: { to: "TEXT", defaults: stringy },
  character: { to: "CHAR(1)", defaults: stringy },
  number: { to: "INTEGER", defaults: numeric },
  integer: { to: "INTEGER", defaults: numeric },
  unsignedinteger: { to: "BIGINT", defaults: numeric },
  smallinteger: { to: "SMALLINT", defaults: numeric },
  unsignedsmallinteger: { to: "INTEGER", defaults: numeric },
  biginteger: { to: "BIGINT", defaults: numeric },
  unsignedbiginteger: { to: "NUMERIC(20)", defaults: numeric },
  float: { to: "DOUBLE PRECISION", defaults: numeric },
  decimal: { to: "NUMERIC", defaults: numeric },
  boolean: {
    to: "BOOLEAN",
    defaults: booleanDefaults((on) => (on ? "TRUE" : "FALSE")),
  },
  datetime: {
    to: "TIMESTAMPTZ",
    defaults: datetimeDefaults(
      () => `LOCALTIMESTAMP`,
      () => `(NOW() AT TIME ZONE 'UTC')`,
    ),
  },
  binary: {
    to: "BYTEA",
    defaults: { Hex: (arg: string) => `'\\x${arg}'` },
  },
  uuid: {
    to: "UUID",
    defaults: uuidDefaults(() => `gen_random_uuid()`),
  },
  reference: { to: "INTEGER", defaults: {} },
};

export const toNative = (specType: string): string =>
  toNativeFrom(conversions, specType);

export const toColumnType = (field: ConverterField): string => {
  if (field.type === "string") return stringCol(field);
  if (field.type === "character") return `CHAR(${charLen(field)})`;
  if (field.type === "decimal") {
    const ps = decimalPrecisionScale(field);
    return ps ? `NUMERIC(${ps[0]}, ${ps[1]})` : "NUMERIC";
  }
  return toNative(field.type);
};
