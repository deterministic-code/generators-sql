import { generateMigrationSql } from "../../lib/generate-migration-sql.ts";
import {
  canonicalDialectName,
  normalizeDialect,
} from "../../lib/generate-sql.ts";
import type { SchemaData } from "../../lib/generate-sql.ts";

interface GenerateRollbackSqlOptions {
  dialect: string;
  beforeSchema: SchemaData;
  afterSchema: SchemaData;
  pluralizeTableNames?: boolean;
}

interface RollbackResult {
  path: string;
  content: string;
  todos: string[];
  isEmpty: boolean;
}

export function generateRollbackSql({
  dialect,
  beforeSchema,
  afterSchema,
  pluralizeTableNames = true,
}: GenerateRollbackSqlOptions): RollbackResult {
  const key = normalizeDialect(dialect);
  if (!key) {
    throw new Error(`Unknown SQL dialect "${dialect}".`);
  }
  const forward = generateMigrationSql({
    dialect,
    beforeSchema: afterSchema,
    afterSchema: beforeSchema,
    pluralizeTableNames,
  });
  const content = forward.content.replace(
    /^-- Generated migration for /,
    "-- Generated rollback for ",
  );
  return {
    path: `rollback_migration.${canonicalDialectName(key).toLowerCase()}.sql`,
    content,
    todos: forward.todos,
    isEmpty: forward.isEmpty,
  };
}
