import { sized, numericFamily, type ConverterModule } from "./base.ts";

/** SQLite field converter: datasource_type → SQLite column type + `DEFAULT` expression. */
export default {
  target: "sqlite",
  targetKind: "dialect",
  conversions: [
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
  ],
  defaults: {
    Boolean: (v) => (v ? "1" : "0"),
    Now: () => `(strftime('%Y-%m-%dT%H:%M:%f', 'now', 'localtime'))`,
    UtcNow: () => `(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    NewId: () => null,
    Hex: (a) => `X'${a}'`,
  },
} satisfies ConverterModule;
