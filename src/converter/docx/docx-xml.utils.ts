export function findElement(
  root: any,
  name: string
): any | null {
  if (!root) return null;

  if (Array.isArray(root)) {
    for (const item of root) {
      const result = findElement(item, name);

      if (result) {
        return result;
      }
    }

    return null;
  }

  if (typeof root !== "object") {
    return null;
  }

  if (root[name]) {
    return root[name];
  }

  for (const value of Object.values(root)) {
    const result = findElement(value, name);

    if (result) {
      return result;
    }
  }

  return null;
}

export function findElements(
  root: any,
  name: string
): any[] {
  const results: any[] = [];

  collectElements(root, name, results);

  return results;
}

export function findDirectChildren(
  root: any,
  name: string
): any[] {
  if (!Array.isArray(root)) {
    return [];
  }

  const results: any[] = [];

  for (const item of root) {
    if (
      item &&
      typeof item === "object" &&
      item[name] !== undefined
    ) {
      results.push(item);
    }
  }

  return results;
}

function collectElements(
  root: any,
  name: string,
  results: any[]
): void {
  if (!root) {
    return;
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      collectElements(item, name, results);
    }

    return;
  }

  if (typeof root !== "object") {
    return;
  }

  if (root[name]) {
    const value = root[name];

    if (Array.isArray(value)) {
      results.push(...value);
    } else {
      results.push(value);
    }

    return;
  }
}

export function extractText(
  node: any
): string {
  if (typeof node === "string") {
    return node;
  }

  if (node?.["#text"] !== undefined) {
    return String(node["#text"]);
  }

  return "";
}

export function readWId(
  node: any
): number | null {
  const raw = node["@_w:id"];

  if (raw === undefined) {
    return null;
  }

  const id = Number(raw);

  return Number.isNaN(id) ? null : id;
}