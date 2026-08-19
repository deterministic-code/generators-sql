import type { NativeInfo } from "@deterministic-code/generators-common/base-type-converter";
import {
  EMPTY_UUID,
  parseDefaultToken,
} from "@deterministic-code/generators-common/default-token";

export type SqlConversion = {
  quoteLeft: string;
  quoteRight: string;
  supportsProcedures: boolean;
};

export type FieldSize = number | number[] | "unlimited" | null;

export type ConverterField = {
  type: string;
  name?: string;
  size?: FieldSize;
  referencesType?: string;
  referencesSize?: FieldSize;
  defaultValue?: string | boolean | number | null;
};

export const sqlStringLiteral = (
  value: string | number | boolean | null | undefined,
): string => `'${String(value).replace(/'/g, "''")}'`;

export const numeric: NativeInfo["defaults"] = {
  Numeric: (arg: string) => arg,
  String: (arg: string) => arg,
};

export const stringy: NativeInfo["defaults"] = {
  String: sqlStringLiteral,
  Numeric: sqlStringLiteral,
};

export const uuidDefaults = (
  newId: () => string,
): NativeInfo["defaults"] => ({
  NewId: newId,
  Empty: () => sqlStringLiteral(EMPTY_UUID),
  Uuid: sqlStringLiteral,
});

export const datetimeDefaults = (
  now: () => string,
  utcNow: () => string,
): NativeInfo["defaults"] => ({
  Now: now,
  UtcNow: utcNow,
  DateTime: sqlStringLiteral,
});

export const booleanDefaults = (
  render: (on: boolean) => string,
): NativeInfo["defaults"] => ({
  Boolean: (arg: string) => render(arg === "true"),
});

export const toNativeFrom = (
  conversions: Record<string, NativeInfo>,
  specType: string,
): string => {
  const info = conversions[specType];
  if (info === undefined) {
    throw new Error(`Unknown spec field type: ${specType}`);
  }
  return info.to;
};

export const renderDefault = (
  conversions: Record<string, NativeInfo>,
  specType: string,
  value: unknown,
): string | null => {
  const { token, arg } = parseDefaultToken(specType, value);
  if (token === "None") return null;
  const info = conversions[specType];
  if (info === undefined) {
    throw new Error(`Unknown spec field type: ${specType}`);
  }
  const render = info.defaults[token];
  if (render === undefined) return null;
  const expr = render(arg === undefined ? "" : String(arg));
  return expr === "" ? null : expr;
};

const isUnlimited = (size?: FieldSize): boolean =>
  size === "unlimited" || size === undefined || size === null;

export const sized = (
  unlimited: string,
  render: (n: number) => string,
): ((field: ConverterField) => string) => {
  return (field) =>
    isUnlimited(field.size) ? unlimited : render(Number(field.size));
};

export const charLen = (field: ConverterField): number =>
  field.size === undefined || field.size === null ? 1 : Number(field.size);

export const decimalPrecisionScale = (
  field: ConverterField,
): [number, number] | null => {
  const s = field.size;
  if (Array.isArray(s) && s.length === 2) {
    const [p, sc] = s;
    if (!Number.isInteger(p) || !Number.isInteger(sc)) {
      throw new Error(
        `decimal field "${field.name}" size must be [precision, scale] integers; got ${JSON.stringify(s)}`,
      );
    }
    return [p, sc];
  }
  if (s === undefined || s === null) return null;
  throw new Error(
    `decimal field "${field.name}" size must be [precision, scale] tuple; got ${JSON.stringify(s)}`,
  );
};

export const requirePrecisionScale = (
  field: ConverterField,
  dialect: string,
): [number, number] => {
  const ps = decimalPrecisionScale(field);
  if (!ps) {
    throw new Error(
      `decimal field "${field.name}" requires size: [precision, scale] for ${dialect}`,
    );
  }
  return ps;
};
