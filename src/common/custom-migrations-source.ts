import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { SQL_DIALECTS, normalizeDialect } from "./sql-dialect.ts";

const FILENAME_RE = /^(\d+)_([A-Za-z0-9][A-Za-z0-9_-]*)_(up|down)\.sql$/;

interface CustomMigrationPair {
  order: number;
  name: string;
  up: string;
  down: string;
}

interface Slot {
  order: number;
  name: string;
  up?: string;
  down?: string;
}

function dialectDir(deterministicDir: string, dialect: string): string {
  const key = normalizeDialect(dialect);
  if (!key) {
    throw new Error(
      `customMigrationsDirFor: unknown SQL dialect "${dialect}". Valid: ${SQL_DIALECTS.join(", ")}.`,
    );
  }
  return join(deterministicDir, "custom", key);
}

async function listSqlFiles(dir: string): Promise<string[] | null> {
  try {
    const st = await stat(dir);
    if (!st.isDirectory()) {
      throw new Error(
        `discoverCustomMigrations: ${dir} exists but is not a directory`,
      );
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
}

function addSlot(dir: string, filename: string, slots: Map<string, Slot>): void {
  const m = FILENAME_RE.exec(filename);
  if (!m) {
    throw new Error(
      `discoverCustomMigrations: ${join(dir, filename)} does not match expected pattern <order>_<name>_(up|down).sql`,
    );
  }
  const order = Number.parseInt(m[1], 10);
  if (order < 1 || order > 999) {
    throw new Error(
      `discoverCustomMigrations: ${join(dir, filename)} has order ${order}; must be in [1, 999]`,
    );
  }
  const name = m[2];
  const side = m[3] as "up" | "down";
  const key = `${order}|${name}`;
  const slot = slots.get(key) ?? { order, name };
  if (slot[side]) {
    throw new Error(
      `discoverCustomMigrations: duplicate ${side} file for order=${order} name=${name} in ${dir}`,
    );
  }
  slot[side] = filename;
  slots.set(key, slot);
}

/** Reads `custom/<dialect>/<order>_<name>_{up,down}.sql` as paired SQL. Missing dir → []. */
export async function readCustomMigrationPairs(
  deterministicDir: string,
  dialect: string,
): Promise<CustomMigrationPair[]> {
  const dir = dialectDir(deterministicDir, dialect);
  const files = await listSqlFiles(dir);
  if (files === null) return [];

  const slots = new Map<string, Slot>();
  for (const filename of files) addSlot(dir, filename, slots);

  const missing: string[] = [];
  for (const slot of slots.values()) {
    if (!slot.up)
      missing.push(`missing _up.sql counterpart for ${slot.down} in ${dir}`);
    if (!slot.down)
      missing.push(`missing _down.sql counterpart for ${slot.up} in ${dir}`);
  }
  if (missing.length > 0) {
    throw new Error(
      `discoverCustomMigrations: ${missing.length} mismatched up/down pair(s):\n  ${missing.join("\n  ")}`,
    );
  }

  const ordered = [...slots.values()].sort(
    (a, b) => a.order - b.order || (a.name < b.name ? -1 : 1),
  );
  return Promise.all(
    ordered.map(async (slot) => {
      const upPath = join(dir, slot.up!);
      const downPath = join(dir, slot.down!);
      return {
        order: slot.order,
        name: slot.name,
        up: await readFile(upPath, "utf8"),
        down: await readFile(downPath, "utf8"),
      };
    }),
  );
}
