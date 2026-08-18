/** The whole-file entry kind every generator returns. */
export const CONTENT = "content";

/** A whole-file `content` entry — the union an generator's `entries` array holds. */
export type GenerateEntry = {
  kind: string;
  filename: string;
  contents: unknown;
};
