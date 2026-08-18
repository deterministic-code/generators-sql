import pluralize from "pluralize";

/** Pluralize only the last `_`-token (`backend_type` → `backend_types`) when the flag is on. */
export const effectiveTableName = (
  name: string,
  pluralizeFlag: boolean,
): string =>
  pluralizeFlag && name
    ? name.replace(/[^_]+$/, (token) => pluralize(token))
    : name;
