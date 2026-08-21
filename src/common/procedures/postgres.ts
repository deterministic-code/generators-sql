import { mapColumnType } from "../sql-dialect.ts";
import { fill } from "@deterministic-code/generators-common/fill";
import {
  createParamFields,
  aliasedColumns,
  pluralizeEntity,
} from "./helpers.ts";
import {
  renderInParams,
  makeGenerateUpdate,
  type ProcField,
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
} from "../../resources/procedures-postgres.ts";

const dialectName = "postgres";
const paramType = (field: ProcField): string =>
  mapColumnType(dialectName, field);

const generateCreate = ({
  entityName,
  table,
  tableTok,
  pk,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const pkType = paramType(pk);
  const params: Param[] = paramFields.map((f) => ({
    name: f.name,
    type: paramType(f),
  }));
  const cols = paramFields.map((f) => f.name);
  return fill(createTmpl, {
    entityName,
    params: renderInParams(params),
    pkType,
    tableTok,
    cols: cols.join(", "),
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
  setLhs: (c) => c,
  argRef: (c, name) => `${name}.${c}`,
  wrap: (ctx, { name, params }, updateBody) =>
    fill(updateTmpl, {
      name,
      params: renderInParams(params),
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
    params: renderInParams(params),
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
