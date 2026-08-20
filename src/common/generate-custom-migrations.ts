import { readCustomMigrationPairs } from "./custom-migrations-source.ts";

const CUSTOM_TOKEN = "_custom_";

type Direction = "up" | "down";

interface CustomMigrationFile {
  filename: string;
  content: string;
}

function generatedFilenameForCustom(
  order: number,
  name: string,
  direction: Direction,
): string {
  if (!Number.isInteger(order) || order < 1 || order > 999) {
    throw new Error(
      `generatedFilenameForCustom: order must be an integer in [1, 999], got ${order}`,
    );
  }
  if (direction !== "up" && direction !== "down") {
    throw new Error(
      `generatedFilenameForCustom: direction must be "up" or "down", got "${direction}"`,
    );
  }
  const stamp = String(order).padStart(10, "0");
  return `${stamp}${CUSTOM_TOKEN}${String(order).padStart(3, "0")}_${name}_${direction}.sql`;
}

export async function buildCustomMigrationFiles(
  deterministicDir: string,
  dialect: string,
): Promise<CustomMigrationFile[]> {
  const pairs = await readCustomMigrationPairs(deterministicDir, dialect);
  return pairs.flatMap((pair) => [
    {
      filename: generatedFilenameForCustom(pair.order, pair.name, "up"),
      content: pair.up,
    },
    {
      filename: generatedFilenameForCustom(pair.order, pair.name, "down"),
      content: pair.down,
    },
  ]);
}
