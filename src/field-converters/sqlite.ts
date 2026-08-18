import {
  sized,
  numericFamily,
  DialectConverter,
  type Conversion,
  type DefaultsTable,
  type IdColumnSuffixes,
  type TriggerTable,
} from "./base.ts";

class SqliteConverter extends DialectConverter {
  readonly target = "sqlite";
  readonly conversions: Conversion[] = [
    {
      type: "string",
      native: sized("TEXT", (n) => `VARCHAR(${n})`),
    },
    { type: "character", native: "TEXT" },
    ...numericFamily("INTEGER", "INTEGER", "INTEGER"),
    { type: "unsignedinteger", native: "INTEGER" },
    { type: "unsignedsmallinteger", native: "INTEGER" },
    { type: "unsignedbiginteger", native: "INTEGER" },
    { type: "float", native: "REAL" },
    { type: "decimal", native: "NUMERIC" },
    { type: "boolean", native: "BOOLEAN" },
    { type: "datetime", native: "TEXT" },
    { type: "binary", native: "BLOB" },
    { type: "uuid", native: "TEXT" },
    { type: "reference", native: "INTEGER" },
  ];
  readonly defaults: DefaultsTable = {
    Boolean: (v) => (v ? "1" : "0"),
    Now: () => `(strftime('%Y-%m-%dT%H:%M:%f', 'now', 'localtime'))`,
    UtcNow: () => `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    NewId: () => null,
    Hex: (a) => `X'${a}'`,
  };
  readonly idColumn: IdColumnSuffixes = {
    integer: "INTEGER PRIMARY KEY AUTOINCREMENT",
    biginteger: "INTEGER PRIMARY KEY AUTOINCREMENT",
    uuid: "TEXT PRIMARY KEY",
    string: "VARCHAR(64) NOT NULL PRIMARY KEY",
  };
  readonly uuidColumn = "VARCHAR(36) NOT NULL UNIQUE";

  updatedTrigger(table: TriggerTable): string {
    const { t, trg } = this.triggerNames(table);
    const pk = table.fields.find((f) => f.primaryKey);
    const pkCol = this.quote(pk ? pk.name : "id");
    return `CREATE TRIGGER ${trg}
AFTER UPDATE ON ${t}
FOR EACH ROW
BEGIN
  UPDATE ${t} SET ${this.quote("updated")} = ${this.defaults.UtcNow()} WHERE ${pkCol} = OLD.${pkCol};
END;`;
  }
}

export default new SqliteConverter();
