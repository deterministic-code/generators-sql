import {
  sized,
  charLen,
  numericFamily,
  decimalPrecisionScale,
  type ConverterField,
  type ConverterModule,
} from "./base.ts";

/** Max chars a utf8mb4 `VARCHAR` can hold before MySQL's 65535-byte row limit forces `LONGTEXT`. */
const MYSQL_VARCHAR_MAX_CHARS_UTF8MB4 = 16383;
/** Max bytes a `VARBINARY` can hold before MySQL forces `LONGBLOB`. */
const MYSQL_VARBINARY_MAX_BYTES = 65535;

function mysqlStringColumnType(n: number): string {
  return n <= MYSQL_VARCHAR_MAX_CHARS_UTF8MB4 ? `VARCHAR(${n})` : "LONGTEXT";
}

function mysqlBinaryColumnType(n: number): string {
  return n <= MYSQL_VARBINARY_MAX_BYTES ? `VARBINARY(${n})` : "LONGBLOB";
}

function mysqlDecimal(field: ConverterField): string {
  const ps = decimalPrecisionScale(field);
  return ps ? `DECIMAL(${ps[0]}, ${ps[1]})` : "DECIMAL(10, 2)";
}

/** MySQL field converter: datasource_type → MySQL column type + `DEFAULT` expression. */
export default {
  target: "mysql",
  targetKind: "dialect",
  conversions: [
    {
      type: "string",
      native: sized("TEXT", mysqlStringColumnType),
    },
    {
      type: "character",
      native: (f) => `CHAR(${charLen(f)})`,
    },
    ...numericFamily("INT", "SMALLINT", "BIGINT"),
    { type: "unsignedinteger", native: "INT UNSIGNED" },
    { type: "unsignedsmallinteger", native: "SMALLINT UNSIGNED" },
    { type: "unsignedbiginteger", native: "BIGINT UNSIGNED" },
    { type: "float", native: "DOUBLE" },
    {
      type: "decimal",
      native: (f) => mysqlDecimal(f),
    },
    { type: "boolean", native: "TINYINT(1)" },
    { type: "datetime", native: "DATETIME(3)" },
    {
      type: "binary",
      native: sized("BLOB", mysqlBinaryColumnType),
    },
    { type: "uuid", native: "CHAR(36)" },
    { type: "reference", native: "INT" },
  ],
  defaults: {
    Boolean: (v) => (v ? "1" : "0"),
    Now: () => `(NOW(3))`,
    UtcNow: () => `(UTC_TIMESTAMP(3))`,
    NewId: () => `(UUID())`,
    Hex: (a) => `X'${a}'`,
  },
} satisfies ConverterModule;
