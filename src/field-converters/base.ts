/** The all-zero uuid, used when a uuid field's default is the `Empty` token. */
const EMPTY_UUID = "00000000-0000-0000-0000-000000000000";

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

/** Classify a field's `default_value` into `{ token, arg }` — Now/UtcNow/NewId/Empty/Hex, `DateTime('…')`, `uuid('…')`, numeric/boolean/string literals. */
function parseDefaultToken(type: string, value: unknown): DefaultToken {
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

/** The `size` a field carries: a scalar length, a `[precision, scale]` tuple, the `"unlimited"` sentinel, or absent. */
export type FieldSize = number | number[] | "unlimited" | null;

/** The field shape every converter reads — `type` is the discriminator; the rest are the optional metadata the sizing/reference/default renderers consult. */
export interface ConverterField {
  type: string;
  name?: string;
  size?: FieldSize;
  referencesType?: string;
  referencesSize?: FieldSize;
  defaultValue?: string | boolean | number | null;
}

/** A `native` renderer for a sized column type — takes the field, returns the dialect type string. */
export type NativeRenderer = (field: ConverterField) => string;

/** One `datasource_type → native type` entry in a converter module's `conversions` table. */
export interface Conversion {
  type: string;
  native: string | NativeRenderer;
}

/** The parsed-default argument a renderer receives — a string literal or a boolean, or absent for the argument-free generator tokens. */
type DefaultArg = string | boolean;

/** One symbolic-default renderer: turns a token's argument into the dialect's expression, or `null` when the token has no expression (e.g. sqlite `NewId`). */
type DefaultRenderer = (arg?: DefaultArg) => string | null;

/** A converter module's per-token default renderers, keyed by token name. */
export type DefaultsTable = Record<string, DefaultRenderer>;

/** Type suffix for the implicit `id` PK column, keyed by datasource `id_type`. */
export interface IdColumnSuffixes {
  integer: string;
  biginteger: string;
  uuid: string;
  string: string;
}

/** Minimal table shape dialect converters need for updated-at triggers. */
export interface TriggerTable {
  name: string;
  fields: { name: string; primaryKey: boolean }[];
}

/** Per-dialect converter: type mappings, defaults, quoting, DROP, triggers, seed wraps. */
export abstract class DialectConverter {
  abstract readonly target: string;
  readonly targetKind = "dialect" as const;
  abstract readonly conversions: Conversion[];
  abstract readonly defaults: DefaultsTable;
  abstract readonly idColumn: IdColumnSuffixes;
  abstract readonly uuidColumn: string;
  readonly quoteLeft: string = '"';
  readonly quoteRight: string = '"';
  readonly supportsProcedures: boolean = false;

  quote(ident: string): string {
    return `${this.quoteLeft}${ident}${this.quoteRight}`;
  }

  dropTable(quoted: string): string {
    return `DROP TABLE IF EXISTS ${quoted};`;
  }

  abstract updatedTrigger(table: TriggerTable): string;

  migrationPreamble(): string[] {
    return [];
  }

  seedBefore(_quoted: string): string | null {
    return null;
  }

  seedAfter(_table: string, _quoted: string): string | null {
    return null;
  }

  protected triggerNames(table: TriggerTable): { t: string; trg: string } {
    return {
      t: this.quote(table.name),
      trg: this.quote(`trg_${table.name}_updated_at`),
    };
  }
}

export type ConverterModule = DialectConverter;

/** Single-quote a value as a SQL string literal, doubling embedded quotes. */
export function sqlStringLiteral(
  value: string | number | boolean | null | undefined,
): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The `[precision, scale]` of a decimal field's `size`, or `null` when unspecified — throws on a malformed size so a bad contract fails loudly. */
export function decimalPrecisionScale(
  field: ConverterField,
): [number, number] | null {
  const s = field.size;
  if (Array.isArray(s) && s.length === 2) {
    const [p, sc] = s;
    if (!Number.isInteger(p) || !Number.isInteger(sc))
      throw new Error(
        `decimal field "${field.name}" size must be [precision, scale] integers; got ${JSON.stringify(s)}`,
      );
    return [p, sc];
  }
  if (s === undefined || s === null) return null;
  throw new Error(
    `decimal field "${field.name}" size must be [precision, scale] tuple; got ${JSON.stringify(s)}`,
  );
}

/** True when a sized field (`string`/`binary`) carries no explicit size and defaults to the dialect's unbounded column type. */
function isUnlimited(size?: FieldSize): boolean {
  return size === "unlimited" || size === undefined || size === null;
}

/** A `native` renderer for a sized column type — `unlimited` when the field has no size, else `render(n)`. */
export function sized(
  unlimited: string,
  render: (n: number) => string,
): NativeRenderer {
  return (field) =>
    isUnlimited(field.size) ? unlimited : render(Number(field.size));
}

/** The four whole-number conversion entries (`number`/`integer` share `intType`) for a target — keeps each dialect's type names local without repeating the entry shape. */
export function numericFamily(
  intType: string,
  smallType: string,
  bigType: string,
): Conversion[] {
  return [
    { type: "number", native: intType },
    { type: "integer", native: intType },
    { type: "smallinteger", native: smallType },
    { type: "biginteger", native: bigType },
  ];
}

/** A fixed-length character field's length, defaulting to 1 when unsized. */
export function charLen(field: ConverterField): number {
  return field.size === undefined || field.size === null
    ? 1
    : Number(field.size);
}

/** The `[precision, scale]` a `decimal` column requires in a dialect that has no sensible default — throws naming the dialect when absent. */
export function requirePrecisionScale(
  field: ConverterField,
  dialect: string,
): [number, number] {
  const ps = decimalPrecisionScale(field);
  if (!ps) {
    throw new Error(
      `decimal field "${field.name}" requires size: [precision, scale] for ${dialect}`,
    );
  }
  return ps;
}

function conversionFor(mod: ConverterModule, type: string): Conversion {
  const entry = mod.conversions.find((c) => c.type === type);
  if (!entry) {
    throw new Error(
      `Unknown field type "${type}" for dialect "${mod.target}"`,
    );
  }
  return entry;
}

/** The native column type for a field, resolving reference recursion. */
export function nativeTypeFor(
  mod: ConverterModule,
  field: ConverterField,
): string {
  if (field.type === "reference" && field.referencesType !== undefined) {
    return nativeTypeFor(mod, {
      type: field.referencesType,
      size: field.referencesSize,
    });
  }
  const { native } = conversionFor(mod, field.type);
  return typeof native === "function" ? native(field) : native;
}

/** The SQL `DEFAULT` expression for a field, translating each symbolic default token to this dialect's form — the dialect-invariant cases live here, the varying ones in the dialect module's `defaults` table. */
export function renderSqlDefault(
  mod: ConverterModule,
  field: ConverterField,
): string | null {
  const { token, arg } = parseDefaultToken(field.type, field.defaultValue);
  switch (token) {
    case "None":
      return null;
    case "Numeric":
      return arg as string;
    case "Empty":
      return sqlStringLiteral(EMPTY_UUID);
    case "Boolean":
      return mod.defaults.Boolean(arg);
    case "Now":
      return mod.defaults.Now();
    case "UtcNow":
      return mod.defaults.UtcNow();
    case "NewId":
      return mod.defaults.NewId();
    case "Hex":
      return mod.defaults.Hex(arg);
    default:
      return sqlStringLiteral(arg);
  }
}
