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
  columnName,
}: RenderCtx): string => {
  const paramFields = createParamFields(table);
  const pkType = paramType(pk);
  const params: Param[] = paramFields.map((f) => ({
    name: columnName(f.name),
    type: paramType(f),
  }));
  const cols = paramFields.map((f) => columnName(f.name));
  return fill(createTmpl, {
    routineName,
    params: renderInParams(params),
    pkType,
    tableTok,
    cols: cols.join(", "),
    pkName: columnName(pk.name),
  }).trimEnd();
};

const generateFindOne = ({
  routineName,
  table,
  tableTok,
  pk,
  columnName,
}: RenderCtx): string =>
  fill(findOneTmpl, {
    routineName,
    pkName: columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
    aliasedCols: aliasedColumns(table, "t", columnName),
  }).trimEnd();

const generateFindAll = ({
  routineName,
  table,
  tableTok,
  pk,
  columnName,
}: RenderCtx): string =>
  fill(findAllTmpl, {
    routineName,
    tableTok,
    aliasedCols: aliasedColumns(table, "t", columnName),
    pkName: columnName(pk.name),
  }).trimEnd();

const generateFindBy = (
  { routineName, table, tableTok, columnName }: RenderCtx,
  field: ProcField,
): string =>
  fill(findByTmpl, {
    routineName,
    byField: columnName(field.name),
    fieldType: paramType(field),
    tableTok,
    aliasedCols: aliasedColumns(table, "t", columnName),
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
  columnName,
}: RenderCtx): string =>
  fill(deleteTmpl, {
    routineName,
    pkName: columnName(pk.name),
    pkType: paramType(pk),
    tableTok,
  }).trimEnd();

const generateDeleteOcc = (
  { routineName, tableTok, pk, columnName, table }: RenderCtx,
  params: Param[],
): string =>
  fill(deleteOccTmpl, {
    routineName,
    params: renderInParams(params),
    tableTok,
    pkName: columnName(pk.name),
    occCol: table.occField
      ? columnName(table.occField.name)
      : columnName("updated"),
    expectedOcc: table.occField
      ? `expected_${columnName(table.occField.name)}`
      : columnName("expected_updated"),
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
