import { fill } from "@deterministic-code/generators-common/fill";
import {
  paramsTmpl,
  updateBodyTmpl,
} from "../../resources/procedures-shared.ts";
import type { PackCasing } from "../default-casing.ts";
import { q } from "../sql-dialect.ts";
import {
  pad,
  paramAlignWidth,
  pkFieldOf,
  updatedFieldOf,
  writableNonAuditFields,
} from "./helpers.ts";

export type ProcField = {
  name: string;
  type: string;
};

export type ProcTable = {
  name: string;
  entityName: string;
  fields: ProcField[];
};

export type Param = {
  name: string;
  type: string;
};

export type Variant = {
  occ?: boolean;
  byField?: string;
};

type ProcOp =
  | "create"
  | "findOne"
  | "findAll"
  | "findBy"
  | "update"
  | "updateOcc"
  | "updateBy"
  | "delete"
  | "deleteOcc";

type ProcSpec = {
  op: ProcOp;
  name: string;
  byField?: string;
};

export type RenderCtx = {
  entityName: string;
  table: ProcTable;
  tableTok: string;
  pk: ProcField;
  casing: PackCasing;
  routineName: string;
};

export type UpdateSpec = {
  writable: ProcField[];
  name: string;
  params: Param[];
};

export type Dialect = {
  dialectName: string;
  paramType(field: ProcField): string;
  generateCreate(ctx: RenderCtx): string;
  generateFindOne(ctx: RenderCtx): string;
  generateFindAll(ctx: RenderCtx): string;
  generateFindBy(ctx: RenderCtx, field: ProcField): string;
  generateUpdate(ctx: RenderCtx, variant: Variant, spec: UpdateSpec): string;
  generateDelete(ctx: RenderCtx): string;
  generateDeleteOcc(ctx: RenderCtx, params: Param[]): string;
};

/** Ordered CRUD ops + routine names for one entity (CREATE bodies and DROP names). */
export const procedureSpecs = (
  entityName: string,
  byFields: string[],
  occ: boolean,
  casing: PackCasing,
): ProcSpec[] => {
  const name = (stem: string): string => casing.routineName(stem);
  return [
    { op: "create", name: name(`create_${entityName}`) },
    { op: "findOne", name: name(`find_${entityName}`) },
    {
      op: "findAll",
      name: name(`find_${casing.pluralTableName(entityName)}`),
    },
    ...byFields.map((bf) => ({
      op: "findBy" as const,
      name: name(`find_${entityName}_by_${bf}`),
      byField: bf,
    })),
    { op: "update", name: name(`update_${entityName}`) },
    ...(occ
      ? [
          {
            op: "updateOcc" as const,
            name: name(`update_${entityName}_optimistic_concurrency`),
          },
        ]
      : []),
    ...byFields.map((bf) => ({
      op: "updateBy" as const,
      name: name(`update_${entityName}_by_${bf}`),
      byField: bf,
    })),
    { op: "delete", name: name(`delete_${entityName}`) },
    ...(occ
      ? [
          {
            op: "deleteOcc" as const,
            name: name(`delete_${entityName}_optimistic_concurrency`),
          },
        ]
      : []),
  ];
};

const requireField = (
  table: ProcTable,
  byField: string | undefined,
  procName: string,
): ProcField => {
  const field = table.fields.find((f) => f.name === byField);
  if (!field) {
    throw new Error(
      `${procName}: field "${byField}" not declared on entity "${table.entityName}"`,
    );
  }
  return field;
};

const updateSpec = (
  dialect: Dialect,
  table: ProcTable,
  variant: Variant,
  name: string,
  casing: PackCasing,
): UpdateSpec => {
  const { occ = false, byField } = variant;
  const key = byField ? requireField(table, byField, name) : pkFieldOf(table);
  const updated = updatedFieldOf(table);
  const writable = writableNonAuditFields(table).filter(
    (f) => f.name !== byField,
  );
  const col = (field: string): string => casing.columnName(field);
  return {
    writable,
    name,
    params: [
      { name: col(key.name), type: dialect.paramType(key) },
      ...(occ
        ? [{ name: col("expected_updated"), type: dialect.paramType(updated) }]
        : []),
      ...writable.map((f) => ({
        name: col(f.name),
        type: dialect.paramType(f),
      })),
      { name: col("new_updated"), type: dialect.paramType(updated) },
    ],
  };
};

const renderOp = (dialect: Dialect, spec: ProcSpec, ctx: RenderCtx): string => {
  switch (spec.op) {
    case "create":
      return dialect.generateCreate(ctx);
    case "findOne":
      return dialect.generateFindOne(ctx);
    case "findAll":
      return dialect.generateFindAll(ctx);
    case "findBy":
      return dialect.generateFindBy(
        ctx,
        requireField(ctx.table, spec.byField, spec.name),
      );
    case "update":
    case "updateOcc":
    case "updateBy": {
      const variant: Variant =
        spec.op === "updateOcc"
          ? { occ: true }
          : spec.op === "updateBy"
            ? { byField: spec.byField }
            : {};
      return dialect.generateUpdate(
        ctx,
        variant,
        updateSpec(dialect, ctx.table, variant, spec.name, ctx.casing),
      );
    }
    case "delete":
      return dialect.generateDelete(ctx);
    case "deleteOcc": {
      const { pk, table, casing } = ctx;
      return dialect.generateDeleteOcc(ctx, [
        { name: casing.columnName(pk.name), type: dialect.paramType(pk) },
        {
          name: casing.columnName("expected_updated"),
          type: dialect.paramType(updatedFieldOf(table)),
        },
      ]);
    }
  }
};

export const generateProceduresFor = (
  dialect: Dialect,
  table: ProcTable,
  byFields: string[],
  occ: boolean,
  casing: PackCasing,
): string[] => {
  const base: Omit<RenderCtx, "routineName"> = {
    entityName: table.entityName,
    table,
    tableTok: q(dialect.dialectName, table.name),
    pk: pkFieldOf(table),
    casing,
  };
  return procedureSpecs(table.entityName, byFields, occ, casing).map((spec) =>
    renderOp(dialect, spec, { ...base, routineName: spec.name }),
  );
};

/** Aligned `IN`/`@`/bare params; `prefix` is `""` (postgres), `"IN "` (mysql), `"@"` (sqlserver). */
export const renderInParams = (params: Param[], prefix = ""): string => {
  const width = paramAlignWidth(params);
  return fill(paramsTmpl, {
    params: params.map((p, i) => ({
      prefix,
      paddedName: pad(p.name, width),
      type: p.type,
      last: i === params.length - 1,
    })),
  }).trimEnd();
};

export type UpdateProcDialect = {
  colRef(col: string): string;
  setLhs(col: string): string;
  argRef(col: string, procName: string): string;
  wrap(ctx: RenderCtx, spec: UpdateSpec, updateBody: string): string;
};

/** Direct SET (no COALESCE) — PATCH-merge is in the service layer; COALESCE blocked SQL NULL. */
export const makeGenerateUpdate =
  (d: UpdateProcDialect) =>
  (ctx: RenderCtx, variant: Variant, spec: UpdateSpec): string => {
    const col = (field: string): string => ctx.casing.columnName(field);
    const argOf = (field: string) => d.argRef(col(field), spec.name);
    const pk = ctx.pk.name;
    const where = variant.byField
      ? `${d.colRef(col(variant.byField))} = ${argOf(variant.byField)}`
      : variant.occ === true
        ? `${d.colRef(col(pk))} = ${argOf(pk)} AND ${d.colRef(col("updated"))} = ${argOf("expected_updated")}`
        : `${d.colRef(col(pk))} = ${argOf(pk)}`;
    const sets = [
      ...spec.writable.map((f) => ({
        lhs: d.setLhs(col(f.name)),
        padEq: "    = ",
        rhs: argOf(f.name),
      })),
      {
        lhs: d.setLhs(col("updated")),
        padEq: " = ",
        rhs: argOf("new_updated"),
      },
    ];
    return d.wrap(
      ctx,
      spec,
      fill(updateBodyTmpl, {
        sets: sets.map((s, i) => ({
          ...s,
          first: i === 0,
          last: i === sets.length - 1,
        })),
        where,
      }).trimEnd(),
    );
  };
