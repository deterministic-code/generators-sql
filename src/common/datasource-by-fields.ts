/** Unique fields + single-column unique indexes → `find/update_<entity>_by_<field>` keys. */

import {
  pkName,
  uniqueLookupFields,
} from "@deterministic-code/generators-common/spec-types";
import { overlayOf, type SqlTable } from "./sql-schema.ts";

export const byFieldsFromDatasource = (
  types: SqlTable[],
): Map<string, string[]> =>
  new Map(
    types.flatMap((type) => {
      const overlay = overlayOf(type);
      const pk = pkName(type, overlay);
      const names = uniqueLookupFields(type, overlay)
        .map((f) => f.field)
        .filter((name) => name !== pk);
      return names.length > 0 ? [[type.name, names] as const] : [];
    }),
  );
