import type { JsonValue } from "@deterministic-code/generator-sdk/read-settings";

/** JSON pointer paths use the inner key for keyed collections (single-key map arrays) rather than the array index, so they stay stable across re-orderings. This deviates from strict RFC 6901. */
export type DiffOp =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "remove"; path: string; from_value: JsonValue }
  | { op: "replace"; path: string; value: JsonValue; from_value: JsonValue };

type JsonObject = { [key: string]: JsonValue };
type KeyedEntry = { [key: string]: JsonValue };

export function diffValues(
  before: JsonValue,
  after: JsonValue,
  basePath = "",
): DiffOp[] {
  if (isKeyedCollection(before) && isKeyedCollection(after)) {
    return diffKeyedCollection(before, after, basePath);
  }
  if (isPlainArray(before) && isPlainArray(after)) {
    return diffPlainArray(before, after, basePath);
  }
  if (isObjectLike(before) && isObjectLike(after)) {
    return diffObject(before, after, basePath);
  }
  return diffScalar(before, after, basePath);
}

function isObjectLike(val: JsonValue): val is JsonObject {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function isKeyedCollection(val: JsonValue): val is KeyedEntry[] {
  if (!Array.isArray(val)) return false;
  if (val.length === 0) return true;
  return val.every(
    (item) => isObjectLike(item) && Object.keys(item).length === 1,
  );
}

function isPlainArray(val: JsonValue): val is JsonValue[] {
  if (!Array.isArray(val)) return false;
  if (val.length === 0) return false;
  return !isKeyedCollection(val);
}

function firstEntry(item: KeyedEntry): [string, JsonValue] {
  const key = Object.keys(item)[0];
  return [key, item[key]];
}

function diffKeyedCollection(
  before: KeyedEntry[],
  after: KeyedEntry[],
  basePath: string,
): DiffOp[] {
  const beforeMap = new Map<string, JsonValue>(before.map(firstEntry));
  const afterMap = new Map<string, JsonValue>(after.map(firstEntry));
  const diffs: DiffOp[] = [];
  for (const [key, fromValue] of beforeMap) {
    if (!afterMap.has(key)) {
      diffs.push({
        op: "remove",
        path: `${basePath}/${key}`,
        from_value: fromValue,
      });
    }
  }
  for (const [key, afterVal] of afterMap) {
    if (!beforeMap.has(key)) {
      diffs.push({ op: "add", path: `${basePath}/${key}`, value: afterVal });
    } else {
      diffs.push(
        ...diffValues(beforeMap.get(key)!, afterVal, `${basePath}/${key}`),
      );
    }
  }
  return diffs;
}

function diffPlainArray(
  before: JsonValue[],
  after: JsonValue[],
  basePath: string,
): DiffOp[] {
  const diffs: DiffOp[] = [];
  const minLen = Math.min(before.length, after.length);
  for (let i = 0; i < minLen; i++) {
    diffs.push(...diffValues(before[i], after[i], `${basePath}/${i}`));
  }
  for (let i = after.length; i < before.length; i++) {
    diffs.push({
      op: "remove",
      path: `${basePath}/${i}`,
      from_value: before[i],
    });
  }
  for (let i = before.length; i < after.length; i++) {
    diffs.push({ op: "add", path: `${basePath}/${i}`, value: after[i] });
  }
  return diffs;
}

function diffObject(
  before: JsonObject,
  after: JsonObject,
  basePath: string,
): DiffOp[] {
  const diffs: DiffOp[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!(key in before)) {
      diffs.push({ op: "add", path: `${basePath}/${key}`, value: after[key] });
    } else if (!(key in after)) {
      diffs.push({
        op: "remove",
        path: `${basePath}/${key}`,
        from_value: before[key],
      });
    } else {
      diffs.push(...diffValues(before[key], after[key], `${basePath}/${key}`));
    }
  }
  return diffs;
}

function diffScalar(
  before: JsonValue,
  after: JsonValue,
  basePath: string,
): DiffOp[] {
  if (Object.is(before, after)) return [];
  return [{ op: "replace", path: basePath, value: after, from_value: before }];
}
