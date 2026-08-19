import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { requireDialect, type SqlDialect } from "./sql-dialect.ts";
import {
  entityUsesOptimisticConcurrency,
  mappedTableNameForEntity,
  normalizeTable,
  type SchemaData,
} from "./sql-schema.ts";
import { effectiveTableName } from "./effective-table-name.ts";

const CREATE_TABLE_RE =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([A-Za-z_][A-Za-z0-9_]*)["`\]]?/gi;
const UPDATED_COL_RE = /[(,]\s*["`\[]?updated["`\]]?\s/i;

const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

const createdTables = (sqlList: string[]): Set<string> => {
  const out = new Set<string>();
  for (const sql of sqlList) {
    const text = stripComments(sql);
    CREATE_TABLE_RE.lastIndex = 0;
    for (let m; (m = CREATE_TABLE_RE.exec(text)); ) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
};

const tableBody = (
  sql: string,
  names: Set<string>,
): string | undefined => {
  const text = stripComments(sql);
  CREATE_TABLE_RE.lastIndex = 0;
  for (let m; (m = CREATE_TABLE_RE.exec(text)); ) {
    if (!names.has(m[1].toLowerCase())) continue;
    const open = text.indexOf("(", m.index + m[0].length);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")" && --depth === 0) {
        return text.slice(open + 1, i);
      }
    }
  }
  return undefined;
};

const hasUpdatedColumn = (names: Set<string>, sqlList: string[]): boolean =>
  sqlList.some((sql) => {
    const body = tableBody(sql, names);
    return body !== undefined && UPDATED_COL_RE.test(`(${body}`);
  });

const loadUpSql = async (dir: string): Promise<string[]> => {
  try {
    const st = await stat(dir);
    if (!st.isDirectory()) {
      throw new Error(`assertSkipMigrationsCovered: ${dir} is not a directory`);
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const files = (await readdir(dir)).filter((f) => f.endsWith("_up.sql"));
  return Promise.all(files.map((f) => readFile(join(dir, f), "utf8")));
};

type SkipEntity = {
  entityName: string;
  physicalTable: string;
  names: Set<string>;
  occ: boolean;
};

const skipEntities = (data: SchemaData, globalOcc: boolean): SkipEntity[] =>
  data.types.flatMap((entry) => {
    const [entityName, body] = Object.entries(entry)[0];
    if (body.skip_migrations !== true) return [];
    const normalized = normalizeTable(entry, {
      pluralizeTableNames: false,
      data,
    });
    const singular = normalized.name;
    const physical = mappedTableNameForEntity(data, entityName) ?? singular;
    return [
      {
        entityName,
        physicalTable: physical,
        names: new Set(
          [physical, singular, effectiveTableName(singular, true), entityName]
            .filter(Boolean)
            .map((s) => s.toLowerCase()),
        ),
        occ: entityUsesOptimisticConcurrency(normalized, globalOcc),
      },
    ];
  });

/** Every `skip_migrations` entity needs covering custom CREATE TABLE DDL per dialect. */
export const assertSkipMigrationsCovered = async (args: {
  data: SchemaData;
  deterministicDir: string;
  dialects: SqlDialect[];
  useOptimisticConcurrency: boolean;
}): Promise<void> => {
  const dialects = args.dialects.map(requireDialect);
  const entities = skipEntities(args.data, args.useOptimisticConcurrency);
  if (dialects.length === 0 || entities.length === 0) return;

  const coverageGaps: string[] = [];
  const occGaps: string[] = [];

  for (const dialect of dialects) {
    const customDir = join(
      resolve(args.deterministicDir),
      "custom",
      dialect,
    );
    const sqlList = await loadUpSql(customDir);
    const covered = createdTables(sqlList);

    for (const ent of entities) {
      const hit = [...ent.names].some((n) => covered.has(n));
      if (!hit) {
        coverageGaps.push(
          `  - entity "${ent.entityName}" (physical table "${ent.physicalTable}") uncovered for "${dialect}"\n` +
            `      expected: ${customDir}/<NNN>_${ent.entityName}_up.sql`,
        );
        continue;
      }
      if (ent.occ && !hasUpdatedColumn(ent.names, sqlList)) {
        occGaps.push(
          `  - entity "${ent.entityName}" (physical table "${ent.physicalTable}"), dialect "${dialect}"`,
        );
      }
    }
  }

  if (coverageGaps.length > 0) {
    throw new Error(
      [
        `skip_migrations coverage gap: ${coverageGaps.length} (entity, dialect) pair(s) need hand-authored custom SQL.`,
        "Every entity with `skip_migrations: true` must have a covering CREATE TABLE in deterministic/custom/<dialect>/*_up.sql.",
        "",
        ...coverageGaps,
      ].join("\n"),
    );
  }
  if (occGaps.length > 0) {
    throw new Error(
      [
        `optimistic-concurrency integrity: ${occGaps.length} skip_migrations (entity, dialect) pair(s) are OCC-enabled but their custom DDL has no "updated" column.`,
        "Add an `updated` column to the custom CREATE TABLE, or set `use_optimistic_concurrency: false` on the datasource_type.",
        "",
        ...occGaps,
      ].join("\n"),
    );
  }
};
