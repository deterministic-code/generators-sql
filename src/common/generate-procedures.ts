import { fill } from "@deterministic-code/generators-common/fill";
import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { DeterministicParser } from "@deterministic-code/deterministic-specifications-typescript/parser";
import { pkName } from "@deterministic-code/generators-common/spec-types";
import { createCasing, type PackCasing } from "./default-casing.ts";
import { byFieldsFromDatasource } from "./datasource-by-fields.ts";
import type { SqlDialect } from "./sql-dialect.ts";
import {
  buildLiveTables,
  datasourceSettings,
  hasAuditColumns,
  overlayOf,
  sqlTablesFrom,
} from "./sql-schema.ts";
import {
  generateProceduresFor,
  procedureSpecs,
  type Dialect,
} from "./procedures/driver.ts";
import { dialect as postgres } from "./procedures/postgres.ts";
import { dialect as mysql } from "./procedures/mysql.ts";
import { dialect as sqlserver } from "./procedures/sqlserver.ts";
import { dropRoutineTmpl } from "../resources/procedures-shared.ts";
import {
  migrationUpTmpl as pgUp,
  migrationDownTmpl as pgDown,
} from "../resources/procedures-postgres.ts";
import {
  migrationUpTmpl as myUp,
  migrationDownTmpl as myDown,
} from "../resources/procedures-mysql.ts";
import {
  migrationUpTmpl as ssUp,
  migrationDownTmpl as ssDown,
} from "../resources/procedures-sqlserver.ts";

type Pack = {
  dialect: Dialect;
  verb: "FUNCTION" | "PROCEDURE";
  up: string;
  down: string;
};

const PACKS: Partial<Record<SqlDialect, Pack>> = {
  postgres: { dialect: postgres, verb: "FUNCTION", up: pgUp, down: pgDown },
  mysql: { dialect: mysql, verb: "PROCEDURE", up: myUp, down: myDown },
  sqlserver: { dialect: sqlserver, verb: "PROCEDURE", up: ssUp, down: ssDown },
};

const withNl = (text: string, casing: PackCasing): string => {
  const out = casing.applyKeywords(text);
  return out.endsWith("\n") ? out : `${out}\n`;
};

/** Stored-procedure migration for one dialect — empty when unsupported or disabled. */
export const generateProceduresForDialect = async (
  dialect: SqlDialect,
  ctx: GenerateContext,
): Promise<GenerateEntry[]> => {
  const pack = PACKS[dialect];
  const ds = datasourceSettings(ctx.settings);
  if (!pack || !ds.useStoredProcedures) return [];

  const spec = await DeterministicParser(ctx.reader).parse(ctx.settings);
  const types = sqlTablesFrom(spec);
  const casing = createCasing(ctx.settings);
  const tables = buildLiveTables(types, casing).filter(hasAuditColumns);
  if (tables.length === 0) return [];

  const occ = ds.useOptimisticConcurrency;
  const byFields = byFieldsFromDatasource(types);
  const parts = tables.map((t) => {
    const fields = byFields.get(t.name) ?? [];
    const table = {
      name: t.tableName,
      entityName: t.name,
      fields: t.fields,
      pkName: pkName(t, overlayOf(t)),
    };
    return {
      body: [
        `-- ${t.name}`,
        ...generateProceduresFor(pack.dialect, table, fields, occ, casing),
      ].join("\n\n"),
      drops: procedureSpecs(t.name, fields, occ, casing).map((spec) =>
        fill(dropRoutineTmpl, { verb: pack.verb, name: spec.name }).trimEnd(),
      ),
    };
  });

  return [
    content(
      `${dialect}/migrations/0002_stored_procedures_up.sql`,
      withNl(fill(pack.up, { body: parts.map((p) => p.body).join("\n\n") }), casing),
    ),
    content(
      `${dialect}/migrations/0002_stored_procedures_down.sql`,
      withNl(fill(pack.down, { drops: parts.flatMap((p) => p.drops) }), casing),
    ),
  ];
};
