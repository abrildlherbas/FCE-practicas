function hasOwn(
  object: any,
  property: string
): boolean {
  return Object.prototype.hasOwnProperty.call(object, property);
}

function isMcFallback(
  node: any
): boolean {
  return (
    node !== null &&
    typeof node === "object" &&
    !Array.isArray(node) &&
    hasOwn(node, "mc:Fallback")
  );
}

export function findElement(
  root: any,
  name: string
): any | null {
  return findElementRecursive(root, name, false);
}

function findElementRecursive(
  root: any,
  name: string,
  insideFallback: boolean
): any | null {
  if (!root) {
    return null;
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      const result = findElementRecursive(
        item,
        name,
        insideFallback
      );

      if (result !== null) {
        return result;
      }
    }

    return null;
  }

  if (typeof root !== "object") {
    return null;
  }

  /*
   * Si estamos dentro de mc:Fallback, ignoramos su contenido.
   *
   * Excepción: si explícitamente estamos buscando mc:Fallback,
   * permitimos encontrar el propio nodo.
   */
  if (
    name !== "mc:Fallback" &&
    (insideFallback || isMcFallback(root))
  ) {
    return null;
  }

  if (root[name] !== undefined) {
    return root[name];
  }

  const nextInsideFallback =
    insideFallback || isMcFallback(root);

  for (const [key, value] of Object.entries(root)) {
    // Los atributos no contienen estructura XML que nos interese recorrer.
    if (key === ":@") {
      continue;
    }

    const result = findElementRecursive(
      value,
      name,
      nextInsideFallback
    );

    if (result !== null) {
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

  collectElements(
    root,
    name,
    results,
    false
  );

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
      !Array.isArray(item) &&
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
  results: any[],
  insideFallback: boolean
): void {
  if (!root) {
    return;
  }

  if (Array.isArray(root)) {
    for (const item of root) {
      collectElements(
        item,
        name,
        results,
        insideFallback
      );
    }

    return;
  }

  if (typeof root !== "object") {
    return;
  }

  /*
   * No extraemos ningún contenido que esté dentro de
   * mc:Fallback.
   */
  if (
    name !== "mc:Fallback" &&
    (insideFallback || isMcFallback(root))
  ) {
    return;
  }

  if (root[name] !== undefined) {
    const value = root[name];

    if (Array.isArray(value)) {
      results.push(...value);
    } else {
      results.push(value);
    }

    return;
  }

  const nextInsideFallback =
    insideFallback || isMcFallback(root);

  for (const [key, value] of Object.entries(root)) {
    if (key === ":@") {
      continue;
    }

    collectElements(
      value,
      name,
      results,
      nextInsideFallback
    );
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