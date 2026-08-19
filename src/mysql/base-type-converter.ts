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
  quoteLeft: "`",
  quoteRight: "`",
  supportsProcedures: true,
};

const MYSQL_VARCHAR_MAX_CHARS_UTF8MB4 = 16383;
const MYSQL_VARBINARY_MAX_BYTES = 65535;

const mysqlStringColumnType = (n: number): string =>
  n <= MYSQL_VARCHAR_MAX_CHARS_UTF8MB4 ? `VARCHAR(${n})` : "LONGTEXT";

const mysqlBinaryColumnType = (n: number): string =>
  n <= MYSQL_VARBINARY_MAX_BYTES ? `VARBINARY(${n})` : "LONGBLOB";

const mysqlDecimal = (field: ConverterField): string => {
  const ps = decimalPrecisionScale(field);
  return ps ? `DECIMAL(${ps[0]}, ${ps[1]})` : "DECIMAL(10, 2)";
};

const stringCol = sized("TEXT", mysqlStringColumnType);
const binaryCol = sized("BLOB", mysqlBinaryColumnType);

export const conversions: Record<string, NativeInfo> = {
  string: { to: "TEXT", defaults: stringy },
  character: { to: "CHAR(1)", defaults: stringy },
  number: { to: "INT", defaults: numeric },
  integer: { to: "INT", defaults: numeric },
  unsignedinteger: { to: "INT UNSIGNED", defaults: numeric },
  smallinteger: { to: "SMALLINT", defaults: numeric },
  unsignedsmallinteger: { to: "SMALLINT UNSIGNED", defaults: numeric },
  biginteger: { to: "BIGINT", defaults: numeric },
  unsignedbiginteger: { to: "BIGINT UNSIGNED", defaults: numeric },
  float: { to: "DOUBLE", defaults: numeric },
  decimal: { to: "DECIMAL(10, 2)", defaults: numeric },
  boolean: {
    to: "TINYINT(1)",
    defaults: booleanDefaults((on) => (on ? "1" : "0")),
  },
  datetime: {
    to: "DATETIME(3)",
    defaults: datetimeDefaults(
      () => `(NOW(3))`,
      () => `(UTC_TIMESTAMP(3))`,
    ),
  },
  binary: {
    to: "BLOB",
    defaults: { Hex: (arg: string) => `X'${arg}'` },
  },
  uuid: {
    to: "CHAR(36)",
    defaults: uuidDefaults(() => `(UUID())`),
  },
  reference: { to: "INT", defaults: {} },
};

export const toNative = (specType: string): string =>
  toNativeFrom(conversions, specType);

export const toColumnType = (field: ConverterField): string => {
  if (field.type === "string") return stringCol(field);
  if (field.type === "character") return `CHAR(${charLen(field)})`;
  if (field.type === "decimal") return mysqlDecimal(field);
  if (field.type === "binary") return binaryCol(field);
  return toNative(field.type);
};
