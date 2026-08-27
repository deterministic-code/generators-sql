import type {
  DatasourceFieldOverlay,
  TypeField,
} from "@deterministic-code/deterministic-specifications-typescript/parser";
import {
  usesNativeRowVersion,
  type ConverterField,
} from "../base-type-converter.ts";
import { dialectConverter, type SqlDialect } from "./sql-dialect.ts";

export const converterFieldOf = (
  field: TypeField,
  overlay?: DatasourceFieldOverlay,
): ConverterField => ({
  type: field.type,
  name: field.name,
  size: field.size,
  defaultValue: field.defaultValue,
  ...(overlay?.isOptimisticConcurrency !== undefined
    ? { isOptimisticConcurrency: overlay.isOptimisticConcurrency }
    : {}),
  ...(overlay?.useNativeRowVersion !== undefined
    ? { useNativeRowVersion: overlay.useNativeRowVersion }
    : {}),
});

const ZERO8 = "0000000000000000";

const binaryBump: Record<SqlDialect, (oldRef: string) => string> = {
  postgres: (oldRef) =>
    `decode(lpad(to_hex((('x' || encode(COALESCE(${oldRef}, '\\x${ZERO8}'::bytea), 'hex'))::bit(64)::bigint + 1) & x'ffffffffffffffff'::bigint), 16, '0'), 'hex')`,
  mysql: (oldRef) =>
    `UNHEX(LPAD(HEX(CAST(CONV(HEX(COALESCE(${oldRef}, X'${ZERO8}')), 16, 10) AS UNSIGNED) + 1), 16, '0'))`,
  sqlite: (oldRef) => {
    const blob = `COALESCE(${oldRef}, X'${ZERO8}')`;
    const asInt = [1, 2, 3, 4, 5, 6, 7, 8]
      .map((i) => {
        const byte = `unicode(substr(${blob}, ${i}, 1))`;
        const shift = 8 * (8 - i);
        return shift === 0 ? byte : `(${byte} << ${shift})`;
      })
      .join(" + ");
    return `unhex(printf('%016x', (${asInt} + 1)))`;
  },
  sqlserver: (oldRef) =>
    `CONVERT(BINARY(8), CONVERT(BIGINT, CONVERT(VARBINARY(8), ${oldRef})) + 1)`,
  oracle: (oldRef) =>
    `HEXTORAW(LPAD(TRIM(TO_CHAR(TO_NUMBER(RAWTOHEX(NVL(${oldRef}, HEXTORAW('${ZERO8}'))), 'XXXXXXXXXXXXXXXX') + 1, 'XXXXXXXXXXXXXXXX')), 16, '0'))`,
};

export const occZeroDefault = (dialect: SqlDialect): string => {
  switch (dialect) {
    case "postgres":
      return `'\\x${ZERO8}'`;
    case "mysql":
    case "sqlite":
      return `X'${ZERO8}'`;
    case "sqlserver":
      return `0x${ZERO8}`;
    case "oracle":
      return `HEXTORAW('${ZERO8}')`;
  }
};

/** Increment expression for an OCC column, or `null` when the engine owns the bump. */
export const occBumpSql = (
  dialect: SqlDialect,
  field: ConverterField,
  oldRef: string,
): string | null => {
  if (dialect === "sqlserver" && usesNativeRowVersion(field)) return null;
  if (field.type === "integer" || field.type === "number") {
    return `${oldRef} + 1`;
  }
  if (field.type === "datetime") {
    return dialectConverter(dialect).conversions.datetime.defaults.UtcNow("");
  }
  if (field.type === "binary") return binaryBump[dialect](oldRef);
  return `${oldRef} + 1`;
};
