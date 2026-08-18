import {
  sized,
  charLen,
  numericFamily,
  decimalPrecisionScale,
  type ConverterModule,
} from "./base.ts";

/** Postgres field converter: datasource_type → Postgres column type + `DEFAULT` expression. */
export default {
  target: "postgres",
  targetKind: "dialect",
  conversions: [
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
  ],
  defaults: {
    Boolean: (v) => (v ? "TRUE" : "FALSE"),
    Now: () => `LOCALTIMESTAMP`,
    UtcNow: () => `(NOW() AT TIME ZONE 'UTC')`,
    NewId: () => `gen_random_uuid()`,
    Hex: (a) => `'\\x${a}'`,
  },
} satisfies ConverterModule;
