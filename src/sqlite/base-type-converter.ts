import type { NativeInfo } from "@deterministic-code/generators-common/base-type-converter";
import {
  booleanDefaults,
  datetimeDefaults,
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
  supportsProcedures: false,
};

const stringCol = sized("TEXT", (n) => `VARCHAR(${n})`);

export const conversions: Record<string, NativeInfo> = {
  string: { to: "TEXT", defaults: stringy },
  character: { to: "TEXT", defaults: stringy },
  number: { to: "INTEGER", defaults: numeric },
  integer: { to: "INTEGER", defaults: numeric },
  unsignedinteger: { to: "INTEGER", defaults: numeric },
  smallinteger: { to: "INTEGER", defaults: numeric },
  unsignedsmallinteger: { to: "INTEGER", defaults: numeric },
  biginteger: { to: "INTEGER", defaults: numeric },
  unsignedbiginteger: { to: "INTEGER", defaults: numeric },
  float: { to: "REAL", defaults: numeric },
  decimal: { to: "NUMERIC", defaults: numeric },
  boolean: {
    to: "BOOLEAN",
    defaults: booleanDefaults((on) => (on ? "1" : "0")),
  },
  datetime: {
    to: "TEXT",
    defaults: datetimeDefaults(
      () => `(strftime('%Y-%m-%dT%H:%M:%f', 'now', 'localtime'))`,
      () => `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    ),
  },
  binary: {
    to: "BLOB",
    defaults: { Hex: (arg: string) => `X'${arg}'` },
  },
  uuid: {
    to: "TEXT",
    defaults: uuidDefaults(() => ""),
  },
  reference: { to: "INTEGER", defaults: {} },
};

export const toNative = (specType: string): string =>
  toNativeFrom(conversions, specType);

export const toColumnType = (field: ConverterField): string => {
  if (field.type === "string") return stringCol(field);
  return toNative(field.type);
};
