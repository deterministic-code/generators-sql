import { mapColumnType } from "../sql-dialect.ts";
import { fill } from "@deterministic-code/generators-common/fill";
import { createParamFields, aliasedColumns } from "./helpers.ts";
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
  routineName,
  table,
  tableTok,
  pk,
  casing,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const pkType = paramType(pk);
  const params: Param[] = paramFields.map((f) => ({
    name: casing.columnName(f.name),
    type: paramType(f),
  }));
  const cols = paramFields.map((f) => casing.columnName(f.name));
  return fill(createTmpl, {
    routineName,
    params: renderInParams(params),
    pkType,
    tableTok,
    cols: cols.join(", "),
    pkName: casing.columnName(pk.name),
  }).trimEnd();
};

const generateFindOne = ({
  routineName,
  table,
  tableTok,
  pk,
  casing,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    routineName,
    pkName: casing.columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
    aliasedCols: aliasedColumns(table, "t", casing.columnName),
  }).trimEnd();

const generateFindAll = ({
  routineName,
  table,
  tableTok,
  pk,
  casing,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    routineName,
    tableTok,
    aliasedCols: aliasedColumns(table, "t", casing.columnName),
    pkName: casing.columnName(pk.name),
  }).trimEnd();

const generateFindBy = (
  { routineName, table, tableTok, casing }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    routineName,
    byField: casing.columnName(field.name),
    fieldType: paramType(field),
    tableTok,
    aliasedCols: aliasedColumns(table, "t", casing.columnName),
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
  routineName,
  tableTok,
  pk,
  casing,
}: RenderCtx): string =>
  fill(deleteTmpl, {
    routineName,
    pkName: casing.columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
  }).trimEnd();

const generateDeleteOcc = (
  { routineName, tableTok, pk, casing }: RenderCtx,
  params: Param[],
): string =>
  fill(deleteOccTmpl, {
    routineName,
    params: renderInParams(params),
    tableTok,
    pkName: casing.columnName(pk.name),
    updatedCol: casing.columnName("updated"),
    expectedUpdated: casing.columnName("expected_updated"),
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
