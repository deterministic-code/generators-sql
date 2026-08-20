/** Unique fields + single-column unique indexes → `find/update_<entity>_by_<field>` keys. */

import {
  uniqueLookupFields,
  type DatasourceType,
} from "@deterministic-code/generators-common/specification";

export const byFieldsFromDatasource = (
  types: DatasourceType[],
): Map<string, string[]> =>
  new Map(
    types.flatMap((type) => {
      const names = uniqueLookupFields(type).map((f) => f.field);
      return names.length > 0 ? [[type.name, names] as const] : [];
    }),
  );
