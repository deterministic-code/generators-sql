import type { NativeInfo } from "@deterministic-code/generators-common/base-type-converter";
import {
  booleanDefaults,
  charLen,
  datetimeDefaults,
  numeric,
  requirePrecisionScale,
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

const stringCol = sized("CLOB", (n) => `VARCHAR2(${n})`);
const binaryCol = sized("BLOB", (n) => `RAW(${n})`);

export const conversions: Record<string, NativeInfo> = {
  string: { to: "CLOB", defaults: stringy },
  character: { to: "CHAR(1)", defaults: stringy },
  number: { to: "NUMBER(10)", defaults: numeric },
  integer: { to: "NUMBER(10)", defaults: numeric },
  unsignedinteger: { to: "NUMBER(10)", defaults: numeric },
  smallinteger: { to: "NUMBER(5)", defaults: numeric },
  unsignedsmallinteger: { to: "NUMBER(5)", defaults: numeric },
  biginteger: { to: "NUMBER(19)", defaults: numeric },
  unsignedbiginteger: { to: "NUMBER(20)", defaults: numeric },
  float: { to: "BINARY_DOUBLE", defaults: numeric },
  decimal: { to: "NUMBER", defaults: numeric },
  boolean: {
    to: "NUMBER(1)",
    defaults: booleanDefaults((on) => (on ? "1" : "0")),
  },
  datetime: {
    to: "TIMESTAMP",
    defaults: datetimeDefaults(
      () => `LOCALTIMESTAMP`,
      () => `SYS_EXTRACT_UTC(SYSTIMESTAMP)`,
    ),
  },
  binary: {
    to: "BLOB",
    defaults: { Hex: (arg: string) => `HEXTORAW('${arg}')` },
  },
  uuid: {
    to: "VARCHAR2(36)",
    defaults: uuidDefaults(() => `SYS_GUID()`),
  },
  reference: { to: "NUMBER(10)", defaults: {} },
};

export const toNative = (specType: string): string =>
  toNativeFrom(conversions, specType);

export const toColumnType = (field: ConverterField): string => {
  if (field.type === "string") return stringCol(field);
  if (field.type === "character") return `CHAR(${charLen(field)})`;
  if (field.type === "decimal") {
    const [p, s] = requirePrecisionScale(field, "oracle");
    return `NUMBER(${p}, ${s})`;
  }
  if (field.type === "binary") return binaryCol(field);
  return toNative(field.type);
};
