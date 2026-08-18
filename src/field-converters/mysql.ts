import {
  sized,
  charLen,
  numericFamily,
  decimalPrecisionScale,
  DialectConverter,
  type Conversion,
  type ConverterField,
  type DefaultsTable,
  type IdColumnSuffixes,
  type TriggerTable,
} from "./base.ts";

const MYSQL_VARCHAR_MAX_CHARS_UTF8MB4 = 16383;
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

class MysqlConverter extends DialectConverter {
  readonly target = "mysql";
  override readonly quoteLeft = "`";
  override readonly quoteRight = "`";
  override readonly supportsProcedures = true;
  readonly conversions: Conversion[] = [
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
  ];
  readonly defaults: DefaultsTable = {
    Boolean: (v) => (v ? "1" : "0"),
    Now: () => `(NOW(3))`,
    UtcNow: () => `(UTC_TIMESTAMP(3))`,
    NewId: () => `(UUID())`,
    Hex: (a) => `X'${a}'`,
  };
  readonly idColumn: IdColumnSuffixes = {
    integer: "INT AUTO_INCREMENT PRIMARY KEY",
    biginteger: "BIGINT AUTO_INCREMENT PRIMARY KEY",
    uuid: "CHAR(36) PRIMARY KEY DEFAULT (UUID())",
    string: "VARCHAR(64) NOT NULL PRIMARY KEY",
  };
  readonly uuidColumn = "VARCHAR(36) NOT NULL UNIQUE DEFAULT (UUID())";

  updatedTrigger(table: TriggerTable): string {
    const { t, trg } = this.triggerNames(table);
    return `CREATE TRIGGER ${trg} BEFORE UPDATE ON ${t}
FOR EACH ROW SET NEW.${this.quote("updated")} = ${this.defaults.UtcNow()};`;
  }
}

export default new MysqlConverter();
