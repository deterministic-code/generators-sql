import {
  sized,
  charLen,
  numericFamily,
  requirePrecisionScale,
  DialectConverter,
  type Conversion,
  type DefaultsTable,
  type IdColumnSuffixes,
  type TriggerTable,
} from "./base.ts";

class SqlServerConverter extends DialectConverter {
  readonly target = "sqlserver";
  override readonly quoteLeft = "[";
  override readonly quoteRight = "]";
  override readonly supportsProcedures = true;
  readonly conversions: Conversion[] = [
    {
      type: "string",
      native: sized("NVARCHAR(MAX)", (n) => `NVARCHAR(${n})`),
    },
    {
      type: "character",
      native: (f) => `NCHAR(${charLen(f)})`,
    },
    ...numericFamily("INT", "SMALLINT", "BIGINT"),
    { type: "unsignedinteger", native: "BIGINT" },
    { type: "unsignedsmallinteger", native: "INT" },
    { type: "unsignedbiginteger", native: "DECIMAL(20)" },
    { type: "float", native: "FLOAT" },
    {
      type: "decimal",
      native: (f) => {
        const [p, s] = requirePrecisionScale(f, "sqlserver");
        return `DECIMAL(${p}, ${s})`;
      },
    },
    { type: "boolean", native: "BIT" },
    { type: "datetime", native: "DATETIME2" },
    {
      type: "binary",
      native: sized("VARBINARY(MAX)", (n) => `VARBINARY(${n})`),
    },
    { type: "uuid", native: "UNIQUEIDENTIFIER" },
    { type: "reference", native: "INT" },
  ];
  readonly defaults: DefaultsTable = {
    Boolean: (v) => (v ? "1" : "0"),
    Now: () => `GETDATE()`,
    UtcNow: () => `GETUTCDATE()`,
    NewId: () => `NEWID()`,
    Hex: (a) => `0x${a}`,
  };
  readonly idColumn: IdColumnSuffixes = {
    integer: "INT IDENTITY(1,1) PRIMARY KEY",
    biginteger: "BIGINT IDENTITY(1,1) PRIMARY KEY",
    uuid: "UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID()",
    string: "NVARCHAR(64) NOT NULL PRIMARY KEY",
  };
  readonly uuidColumn =
    "UNIQUEIDENTIFIER NOT NULL UNIQUE DEFAULT NEWID()";

  updatedTrigger(table: TriggerTable): string {
    const { t, trg } = this.triggerNames(table);
    const id = this.quote("id");
    return `CREATE TRIGGER ${trg} ON ${t}
AFTER UPDATE AS
BEGIN
  SET NOCOUNT ON;
  UPDATE ${t} SET ${this.quote("updated")} = ${this.defaults.UtcNow()}
  FROM ${t} t INNER JOIN inserted i ON t.${id} = i.${id};
END;`;
  }

  override seedBefore(quoted: string): string {
    return `SET IDENTITY_INSERT ${quoted} ON;`;
  }

  override seedAfter(_table: string, quoted: string): string {
    return `SET IDENTITY_INSERT ${quoted} OFF;`;
  }
}

export default new SqlServerConverter();
