import { fill } from "../fill.ts";
import {
  pkFieldOf,
  writableNonAuditFields,
  pluralizeEntity,
} from "./helpers.ts";
import {
  renderInParams,
  charParamType,
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
} from "../../resources/procedures-sqlserver.ts";

export const dialectName = "sqlserver";
export const auditType = "NVARCHAR(64)";

export const paramType = (field: ProcField): string =>
  charParamType(field, "NVARCHAR", dialectName);

const allColumnNames = (
  table: ProcTable,
  idType: string | undefined,
): string[] => {
  const pk = pkFieldOf(table, idType);
  return [
    pk.name,
    "uuid",
    ...writableNonAuditFields(table, idType).map((f) => f.name),
    "created",
    "updated",
  ];
};

const renderParams = (params: Param[]): string =>
  renderInParams(params, "@");

export const generateCreate = ({
  entityName,
  table,
  idType,
  tableTok,
}: RenderCtx): string => {
  const writable = writableNonAuditFields(table, idType);
  const params: Param[] = [
    { name: "uuid", type: "NVARCHAR(36)" },
    ...writable.map((f) => ({ name: f.name, type: paramType(f) })),
    { name: "created", type: "NVARCHAR(64)" },
    { name: "updated", type: "NVARCHAR(64)" },
  ];
  const cols = ["uuid", ...writable.map((f) => f.name), "created", "updated"];
  return fill(createTmpl, {
    entityName,
    params: renderParams(params),
    tableTok,
    cols: cols.join(", "),
    placeholders: cols.map((c) => `@${c}`).join(", "),
  }).trimEnd();
};

export const generateFindOne = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    entityName,
    pkName: pk.name,
    pkType: paramType(pk),
    cols: allColumnNames(table, idType).join(", "),
    tableTok,
  }).trimEnd();

export const generateFindAll = ({
  entityName,
  table,
  idType,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    plural: pluralizeEntity(entityName),
    cols: allColumnNames(table, idType).join(", "),
    tableTok,
    pkName: pk.name,
  }).trimEnd();

export const generateFindBy = (
  { entityName, table, idType, tableTok }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    entityName,
    byField: field.name,
    fieldType: paramType(field),
    cols: allColumnNames(table, idType).join(", "),
    tableTok,
  }).trimEnd();

const updateDialect: UpdateProcDialect = {
  colRef: (c) => c,
  setLhs: (c) => c,
  argRef: (c) => `@${c}`,
  wrap: (ctx, { name, params }, updateLines) =>
    fill(updateTmpl, {
      name,
      params: renderParams(params),
      tableTok: ctx.tableTok,
      updateBody: updateLines.join("\n"),
    }).trimEnd(),
};

export const generateUpdate = makeGenerateUpdate(updateDialect);

export const generateDelete = ({
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

export const generateDeleteOcc = (
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
