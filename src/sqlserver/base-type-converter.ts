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
  quoteLeft: "[",
  quoteRight: "]",
  supportsProcedures: true,
};

const stringCol = sized("NVARCHAR(MAX)", (n) => `NVARCHAR(${n})`);
const binaryCol = sized("VARBINARY(MAX)", (n) => `VARBINARY(${n})`);

export const conversions: Record<string, NativeInfo> = {
  string: { to: "NVARCHAR(MAX)", defaults: stringy },
  character: { to: "NCHAR(1)", defaults: stringy },
  number: { to: "INT", defaults: numeric },
  integer: { to: "INT", defaults: numeric },
  unsignedinteger: { to: "BIGINT", defaults: numeric },
  smallinteger: { to: "SMALLINT", defaults: numeric },
  unsignedsmallinteger: { to: "INT", defaults: numeric },
  biginteger: { to: "BIGINT", defaults: numeric },
  unsignedbiginteger: { to: "DECIMAL(20)", defaults: numeric },
  float: { to: "FLOAT", defaults: numeric },
  decimal: { to: "DECIMAL", defaults: numeric },
  boolean: {
    to: "BIT",
    defaults: booleanDefaults((on) => (on ? "1" : "0")),
  },
  datetime: {
    to: "DATETIME2",
    defaults: datetimeDefaults(
      () => `GETDATE()`,
      () => `GETUTCDATE()`,
    ),
  },
  binary: {
    to: "VARBINARY(MAX)",
    defaults: { Hex: (arg: string) => `0x${arg}` },
  },
  uuid: {
    to: "UNIQUEIDENTIFIER",
    defaults: uuidDefaults(() => `NEWID()`),
  },
  reference: { to: "INT", defaults: {} },
};

export const toNative = (specType: string): string =>
  toNativeFrom(conversions, specType);

export const toColumnType = (field: ConverterField): string => {
  if (field.type === "string") return stringCol(field);
  if (field.type === "character") return `NCHAR(${charLen(field)})`;
  if (field.type === "decimal") {
    const [p, s] = requirePrecisionScale(field, "sqlserver");
    return `DECIMAL(${p}, ${s})`;
  }
  if (field.type === "binary") return binaryCol(field);
  return toNative(field.type);
};
