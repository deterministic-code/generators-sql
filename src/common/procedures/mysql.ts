import { fill } from "@deterministic-code/generators-common/fill";
import { mapColumnType } from "../sql-dialect.ts";
import {
  hasSystemUuidColumn,
  writableNonAuditFields,
  aliasedColumns,
  pluralizeEntity,
} from "./helpers.ts";
import {
  renderInParams,
  makeGenerateUpdate,
  type ProcField,
  type ProcTable,
  type Param,
  type RenderCtx,
  type UpdateProcDialect,
  type Dialect,
} from "./driver.ts";
import {
  createTmpl,
  findOneTmpl,
  findAllTmpl,
  findByTmpl,
  updateTmpl,
  deleteTmpl,
  deleteOccTmpl,
} from "../../resources/procedures-mysql.ts";

const dialectName = "mysql";
const native = (type: string): string =>
  mapColumnType(dialectName, { type });
const auditType = native("datetime");
const paramType = (field: ProcField): string =>
  mapColumnType(dialectName, field);

const renderParams = (params: Param[]): string =>
  renderInParams(params, "IN ");

const createProcParams = (table: ProcTable): Param[] => {
  const writable = writableNonAuditFields(table);
  return [
    ...(hasSystemUuidColumn(table)
      ? [{ name: "uuid", type: native("uuid") }]
      : []),
    ...writable.map((f) => ({ name: f.name, type: paramType(f) })),
    { name: "created", type: auditType },
    { name: "updated", type: auditType },
  ];
};

const generateCreate = ({
  entityName,
  table,
  tableTok,
  pk,
}: RenderCtx): string => {
  const generatedId = !hasSystemUuidColumn(table);
  const writable = writableNonAuditFields(table);
  const cols = generatedId
    ? [pk.name, ...writable.map((f) => f.name), "created", "updated"]
    : ["uuid", ...writable.map((f) => f.name), "created", "updated"];
  const vals = generatedId
    ? [
        "new_id",
        ...writable.map((f) => f.name),
        "created",
        "updated",
      ]
    : cols;
  return fill(createTmpl, {
    entityName,
    params: renderParams(createProcParams(table)),
    generatedId,
    lastInsertId: pk.type === "biginteger" || pk.type === "integer",
    tableTok,
    cols: cols.join(", "),
    vals: vals.join(", "),
    pkName: pk.name,
  }).trimEnd();
};

const generateFindOne = ({
  entityName,
  table,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    entityName,
    pkName: pk.name,
    pkType: paramType(pk),
    tableTok,
    aliasedCols: aliasedColumns(table),
  }).trimEnd();

const generateFindAll = ({
  entityName,
  table,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    plural: pluralizeEntity(entityName),
    tableTok,
    aliasedCols: aliasedColumns(table),
    pkName: pk.name,
  }).trimEnd();

const generateFindBy = (
  { entityName, table, tableTok }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    entityName,
    byField: field.name,
    fieldType: paramType(field),
    tableTok,
    aliasedCols: aliasedColumns(table),
  }).trimEnd();

const updateDialect: UpdateProcDialect = {
  colRef: (c) => `t.${c}`,
  setLhs: (c) => `t.${c}`,
  argRef: (c) => c,
  wrap: (ctx, { name, params }, updateBody) =>
    fill(updateTmpl, {
      name,
      params: renderParams(params),
      tableTok: ctx.tableTok,
      updateBody,
    }).trimEnd(),
};

const generateUpdate = makeGenerateUpdate(updateDialect);

const generateDelete = ({
  entityName,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(deleteTmpl, {
    entityName,
    pkName: pk.name,
    pkType: paramType(pk),
    tableTok,
  }).trimEnd();

const generateDeleteOcc = (
  { entityName, tableTok, pk }: RenderCtx,
  params: Param[],
): string =>
  fill(deleteOccTmpl, {
    entityName,
    params: renderParams(params),
    tableTok,
    pkName: pk.name,
  }).trimEnd();

export const dialect: Dialect = {
  dialectName,
  auditType,
  paramType,
  generateCreate,
  generateFindOne,
  generateFindAll,
  generateFindBy,
  generateUpdate,
  generateDelete,
  generateDeleteOcc,
};
