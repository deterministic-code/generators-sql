/** The all-zero uuid, shared by the SQL default renderer for the `Empty` uuid token. */
export const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

/** Field types whose `default_value` renders as a bare numeric literal (no quoting). */
const NUMERIC_LITERAL_TYPES = new Set([
  "number",
  "integer",
  "smallinteger",
  "biginteger",
  "float",
  "decimal",
  "reference",
]);

const DATETIME_LITERAL = /^DateTime\('(.*)'\)$/;
const UUID_LITERAL = /^uuid\('(.*)'\)$/;
const HEX_LITERAL = /^Hex\('(.*)'\)$/;

interface DefaultToken {
  token: string;
  arg?: string | boolean;
}

/** Classify a field's `default_value` into `{ token, arg }` — the one place the symbolic-default grammar (Now/UtcNow/NewId/Empty/Hex, `DateTime('…')`, `uuid('…')`, numeric/boolean/string literals) is parsed. */
export function parseDefaultToken(type: string, value: unknown): DefaultToken {
  if (value === undefined || value === null) return { token: "None" };
  const v = String(value);
  if (type === "boolean") return { token: "Boolean", arg: Boolean(value) };
  if (NUMERIC_LITERAL_TYPES.has(type)) return { token: "Numeric", arg: v };
  if (type === "datetime") return datetimeToken(v);
  if (type === "uuid") return uuidToken(v);
  if (type === "binary") return hexToken(v);
  return { token: "String", arg: v };
}

function datetimeToken(v: string): DefaultToken {
  if (v === "Now") return { token: "Now" };
  if (v === "UtcNow") return { token: "UtcNow" };
  const m = DATETIME_LITERAL.exec(v);
  return { token: "DateTime", arg: m ? m[1] : v };
}

function uuidToken(v: string): DefaultToken {
  if (v === "NewId") return { token: "NewId" };
  if (v === "Empty") return { token: "Empty" };
  const m = UUID_LITERAL.exec(v);
  return { token: "Uuid", arg: m ? m[1] : v };
}

function hexToken(v: string): DefaultToken {
  const m = HEX_LITERAL.exec(v);
  return { token: "Hex", arg: m ? m[1] : v };
}
