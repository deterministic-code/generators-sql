import { fill } from "@deterministic-code/generators-common/fill";
import { mapColumnType } from "../sql-dialect.ts";
import {
  createParamFields,
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
} from "../../resources/procedures-sqlserver.ts";

const dialectName = "sqlserver";
const paramType = (field: ProcField): string =>
  mapColumnType(dialectName, field);

const allColumnNames = (table: ProcTable): string[] =>
  table.fields.map((f) => f.name);

const renderParams = (params: Param[]): string =>
  renderInParams(params, "@");

const generateCreate = ({
  entityName,
  table,
  tableTok,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const params: Param[] = paramFields.map((f) => ({
    name: f.name,
    type: paramType(f),
  }));
  const cols = paramFields.map((f) => f.name);
  return fill(createTmpl, {
    entityName,
    params: renderParams(params),
    tableTok,
    cols: cols.join(", "),
    placeholders: cols.map((c) => `@${c}`).join(", "),
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
    cols: allColumnNames(table).join(", "),
    tableTok,
  }).trimEnd();

const generateFindAll = ({
  entityName,
  table,
  tableTok,
  pk,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    plural: pluralizeEntity(entityName),
    cols: allColumnNames(table).join(", "),
    tableTok,
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
    cols: allColumnNames(table).join(", "),
    tableTok,
  }).trimEnd();

const updateDialect: UpdateProcDialect = {
  colRef: (c) => c,
  setLhs: (c) => c,
  argRef: (c) => `@${c}`,
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
  paramType,
  generateCreate,
  generateFindOne,
  generateFindAll,
  generateFindBy,
  generateUpdate,
  generateDelete,
  generateDeleteOcc,
};
