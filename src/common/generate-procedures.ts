import { fill } from "@deterministic-code/generators-common/fill";
import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { DeterministicParser } from "@deterministic-code/generators-common/specification-parser";
import { DATASOURCE_TYPES_YAML } from "@deterministic-code/generators-common/specification";
import { byFieldsFromDatasource } from "./datasource-by-fields.ts";
import type { SqlDialect } from "./sql-dialect.ts";
import {
  buildLiveTables,
  datasourceSettings,
  hasAuditColumns,
  type LiveTable,
} from "./sql-schema.ts";
import {
  procedureSpecs,
  generateProceduresFor,
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
  kind: "function" | "procedure";
  up: string;
  down: string;
};

const PACKS: Partial<Record<SqlDialect, Pack>> = {
  postgres: { dialect: postgres, kind: "function", up: pgUp, down: pgDown },
  mysql: { dialect: mysql, kind: "procedure", up: myUp, down: myDown },
  sqlserver: { dialect: sqlserver, kind: "procedure", up: ssUp, down: ssDown },
};

const withNl = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;

/** Stored-procedure migration for one dialect — empty when unsupported or disabled. */
export const generateProceduresForDialect = async (
  dialect: SqlDialect,
  ctx: GenerateContext,
): Promise<GenerateEntry[]> => {
  const pack = PACKS[dialect];
  const ds = datasourceSettings(ctx.settings);
  if (!pack || !ds.useStoredProcedures) return [];

  await ctx.reader.read(DATASOURCE_TYPES_YAML);
  const types = (await DeterministicParser(ctx.reader).parse(ctx.settings))
    .expandedDatasourceTypes;

  const occ = ds.useOptimisticConcurrency;
  const byFields = byFieldsFromDatasource(types);
  const tables = buildLiveTables(dialect, types, {
    pluralizeTableNames: ds.pluralizeTableNames,
  }).filter((t) => hasAuditColumns(t));
  if (tables.length === 0) return [];

  const parts = tables.map((t) => {
    const fields = byFields.get(t.name) ?? [];
    const table = {
      name: t.tableName,
      entityName: t.name,
      fields: t.fields,
    };
    return {
      body: [
        `-- ${t.name}`,
        ...generateProceduresFor(pack.dialect, table, {
          byFields: fields,
          useOptimisticConcurrency: occ,
        }),
      ].join("\n\n"),
      drops: procedureSpecs(t.name, { byFields: fields, occ }).map((spec) =>
        fill(dropRoutineTmpl, {
          verb: pack.kind === "function" ? "FUNCTION" : "PROCEDURE",
          name: spec.name,
        }).trimEnd(),
      ),
    };
  });
  const body = parts.map((p) => p.body).join("\n\n");
  if (body.length === 0) return [];

  return [
    content(
      `${dialect}/migrations/0002_stored_procedures_up.sql`,
      withNl(fill(pack.up, { body })),
    ),
    content(
      `${dialect}/migrations/0002_stored_procedures_down.sql`,
      withNl(fill(pack.down, { drops: parts.flatMap((p) => p.drops) })),
    ),
  ];
};
