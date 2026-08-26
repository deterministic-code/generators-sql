import type { TypeField } from "@deterministic-code/deterministic-specifications-typescript/parser";
import type { PackCasing } from "./default-casing.ts";
import {
  fieldOverlay,
  referenceTarget,
  type SqlTable,
} from "./sql-schema.ts";

const SNAKE_STEM = /^[a-z_][a-z0-9_]*$/;

export const isVerbatimMapping = (mapping?: string): mapping is string =>
  mapping !== undefined && !SNAKE_STEM.test(mapping);

/** Physical table/column names from datasource `mapping` overlays + pack casing. */
export class SqlMapping {
  private readonly casing: PackCasing;
  private readonly byLogicalName: ReadonlyMap<string, SqlTable>;

  constructor(casing: PackCasing, tables: readonly SqlTable[]) {
    this.casing = casing;
    this.byLogicalName = new Map(tables.map((t) => [t.name, t]));
  }

  tableStem(table: SqlTable): string {
    return table.mapping ?? table.name;
  }

  fieldStem(table: SqlTable, fieldName: string): string {
    return fieldOverlay(table, fieldName)?.mapping ?? fieldName;
  }

  tableName(table: SqlTable): string {
    return isVerbatimMapping(table.mapping)
      ? table.mapping
      : this.casing.tableName(this.tableStem(table));
  }

  columnName(table: SqlTable, fieldName: string): string {
    const mapped = fieldOverlay(table, fieldName)?.mapping;
    return isVerbatimMapping(mapped)
      ? mapped
      : this.casing.columnName(this.fieldStem(table, fieldName));
  }

  constraintName(table: SqlTable, ...parts: string[]): string {
    if (isVerbatimMapping(table.mapping)) {
      return [table.mapping, ...parts].join("_");
    }
    return this.casing.constraintName(this.tableStem(table), ...parts);
  }

  triggerName(table: SqlTable): string {
    if (isVerbatimMapping(table.mapping)) {
      return `trg_${table.mapping}_updated_at`;
    }
    return this.casing.triggerName(this.tableStem(table));
  }

  occTriggerName(table: SqlTable): string {
    if (isVerbatimMapping(table.mapping)) {
      return `trg_${table.mapping}_occ`;
    }
    return `trg_${this.casing.tableName(this.tableStem(table))}_occ`;
  }

  tableOf(logicalName: string): SqlTable {
    const table = this.byLogicalName.get(logicalName);
    if (!table) {
      throw new Error(`foreign key references unknown table "${logicalName}"`);
    }
    return table;
  }

  resolveReference(
    references: NonNullable<TypeField["references"]>,
  ): { tableName: string; columnName: string } {
    const [logicalTable, logicalCol] = referenceTarget(references);
    const target = this.tableOf(logicalTable);
    return {
      tableName: this.tableName(target),
      columnName: this.columnName(target, logicalCol),
    };
  }
}
