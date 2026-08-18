import {
  sized,
  charLen,
  numericFamily,
  decimalPrecisionScale,
  DialectConverter,
  type Conversion,
  type DefaultsTable,
  type IdColumnSuffixes,
  type TriggerTable,
} from "./base.ts";

class PostgresConverter extends DialectConverter {
  readonly target = "postgres";
  override readonly supportsProcedures = true;
  readonly conversions: Conversion[] = [
    {
      type: "string",
      native: sized("TEXT", (n) => `VARCHAR(${n})`),
    },
    {
      type: "character",
      native: (f) => `CHAR(${charLen(f)})`,
    },
    ...numericFamily("INTEGER", "SMALLINT", "BIGINT"),
    { type: "unsignedinteger", native: "BIGINT" },
    { type: "unsignedsmallinteger", native: "INTEGER" },
    { type: "unsignedbiginteger", native: "NUMERIC(20)" },
    { type: "float", native: "DOUBLE PRECISION" },
    {
      type: "decimal",
      native: (f) => {
        const ps = decimalPrecisionScale(f);
        return ps ? `NUMERIC(${ps[0]}, ${ps[1]})` : "NUMERIC";
      },
    },
    { type: "boolean", native: "BOOLEAN" },
    { type: "datetime", native: "TIMESTAMPTZ" },
    { type: "binary", native: "BYTEA" },
    { type: "uuid", native: "UUID" },
    { type: "reference", native: "INTEGER" },
  ];
  readonly defaults: DefaultsTable = {
    Boolean: (v) => (v ? "TRUE" : "FALSE"),
    Now: () => `LOCALTIMESTAMP`,
    UtcNow: () => `(NOW() AT TIME ZONE 'UTC')`,
    NewId: () => `gen_random_uuid()`,
    Hex: (a) => `'\\x${a}'`,
  };
  readonly idColumn: IdColumnSuffixes = {
    integer: "SERIAL PRIMARY KEY",
    biginteger: "BIGSERIAL PRIMARY KEY",
    uuid: "UUID PRIMARY KEY DEFAULT gen_random_uuid()",
    string: "VARCHAR(64) NOT NULL PRIMARY KEY",
  };
  readonly uuidColumn = "UUID NOT NULL UNIQUE DEFAULT gen_random_uuid()";

  override migrationPreamble(): string[] {
    return [
      "-- Shared updated_at function",
      `CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW."updated" = NOW() AT TIME ZONE 'UTC';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
      "",
    ];
  }

  updatedTrigger(table: TriggerTable): string {
    const { t, trg } = this.triggerNames(table);
    return `CREATE TRIGGER ${trg} BEFORE UPDATE ON ${t} FOR EACH ROW EXECUTE FUNCTION set_updated_at();`;
  }

  override seedAfter(table: string, quoted: string): string {
    return `SELECT setval(pg_get_serial_sequence('${table}', 'id'), (SELECT MAX("id") FROM ${quoted}));`;
  }
}

export default new PostgresConverter();
