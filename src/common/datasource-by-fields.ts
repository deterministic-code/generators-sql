/** Unique fields + single-column unique indexes → `find/update_<entity>_by_<field>` keys. */

import type { SchemaData } from "./sql-schema.ts";

const named = <T,>(entry: Record<string, T>): [string, T] =>
  Object.entries(entry)[0];

export const byFieldsFromDatasource = (
  data: SchemaData,
): Map<string, string[]> =>
  new Map(
    data.types.flatMap((entry) => {
      const [entity, def] = named(entry);
      const names = [
        ...def.fields.flatMap((f) => {
          const [name, body] = named(f);
          return body.is_unique === true ? [name] : [];
        }),
        ...(def.indexes ?? []).flatMap((idx) => {
          const { is_unique, fields } = Object.values(idx)[0];
          return is_unique === true && fields.length === 1 ? [fields[0]] : [];
        }),
      ];
      const unique = [...new Set(names)];
      return unique.length > 0 ? [[entity, unique] as const] : [];
    }),
  );
