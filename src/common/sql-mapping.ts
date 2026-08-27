import type { TypeField } from "@deterministic-code/deterministic-specifications-typescript/parser";
import type { PackCasing } from "./default-casing.ts";
import {
  fieldOverlay,
  referenceTarget,
  type SqlTable,
} from "./sql-schema.ts";

/** Physical table/column names from datasource `mapping` overlays + pack casing. */
export class SqlMapping {
  constructor(
    private readonly casing: PackCasing,
    tables: readonly SqlTable[],
  ) {
    this.byLogicalName = new Map(tables.map((t) => [t.name, t]));
  }

  private readonly byLogicalName: ReadonlyMap<string, SqlTable>;

  tableStem(table: SqlTable): string {
    return table.mapping ?? table.name;
  }

  fieldStem(table: SqlTable, fieldName: string): string {
    return fieldOverlay(table, fieldName)?.mapping ?? fieldName;
  }

  tableName(table: SqlTable): string {
    return this.casing.tableName(this.tableStem(table));
  }

  columnName(table: SqlTable, fieldName: string): string {
    return this.casing.columnName(this.fieldStem(table, fieldName));
  }

  constraintName(table: SqlTable, ...parts: string[]): string {
    return this.casing.constraintName(this.tableStem(table), ...parts);
  }

  triggerName(table: SqlTable): string {
    return this.casing.triggerName(this.tableStem(table));
  }

  occTriggerName(table: SqlTable): string {
    return this.casing.occTriggerName(this.tableStem(table));
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
