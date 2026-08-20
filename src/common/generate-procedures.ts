import { fill } from "@deterministic-code/generators-common/fill";
import type { GenerateContext } from "@deterministic-code/generators-common/generate-context";
import { content, type GenerateEntry } from "@deterministic-code/generators-common/generate-entry";
import { SpecificationParser } from "@deterministic-code/generators-common/specification-parser";
import { byFieldsFromDatasource } from "./datasource-by-fields.ts";
import type { SqlDialect } from "./sql-dialect.ts";
import {
  buildLiveTables,
  datasourceSettings,
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

const hasAuditColumns = (table: LiveTable, occ: boolean): boolean => {
  if (table.datasourceType === "readonly-lookup") return false;
  const customPk = table.fields.some((f) => f.isPrimaryKey && f.name !== "id");
  if (!customPk) return true;
  if (table.datasourceType === "many-to-many") return false;
  return table.optimisticConcurrency ?? occ;
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

  const types = await new SpecificationParser(ctx.reader).loadDatasourceTypes(
    ds.idType,
  );

  const occ = ds.useOptimisticConcurrency;
  const byFields = byFieldsFromDatasource(types);
  const tables = buildLiveTables(dialect, types, {
    pluralizeTableNames: ds.pluralizeTableNames,
  }).filter((t) => hasAuditColumns(t, occ));
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
          idType: ds.idType,
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
