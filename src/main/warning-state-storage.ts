import fs from "node:fs/promises";
import type {
  ParseWarning,
  WarningState,
} from "../converter/models/Article";

function statePath(sourcePath: string): string {
  return `${sourcePath}.warnings.json`;
}

function isWarningState(value: unknown): value is WarningState {
  if (value === null || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.id === "string" &&
    state.id.startsWith("warning:") &&
    typeof state.ordinal === "number" &&
    Number.isInteger(state.ordinal) &&
    state.ordinal > 0 &&
    (state.status === "pendiente" || state.status === "resuelto")
  );
}

export async function readWarningStates(
  sourcePath: string
): Promise<WarningState[]> {
  let content: string;
  try {
    content = await fs.readFile(statePath(sourcePath), "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const stored: unknown = JSON.parse(content);
  if (!Array.isArray(stored) || !stored.every(isWarningState)) {
    throw new Error("El archivo de estados de errores no es válido.");
  }
  return stored;
}

export async function persistWarningStates(
  sourcePath: string,
  warnings: ParseWarning[]
): Promise<void> {
  const previous = await readWarningStates(sourcePath);
  const merged = new Map(
    previous.map((state) => [state.id, state])
  );

  for (const warning of warnings) {
    if (
      !warning.id ||
      !warning.ordinal ||
      !Number.isInteger(warning.ordinal)
    ) {
      throw new Error(
        "No se puede persistir un error sin identidad y numeración."
      );
    }
    merged.set(warning.id, {
      id: warning.id,
      ordinal: warning.ordinal,
      status: warning.status,
    });
  }

  const states = [...merged.values()].sort(
    (left, right) => left.ordinal - right.ordinal
  );
  await fs.writeFile(
    statePath(sourcePath),
    `${JSON.stringify(states, null, 2)}\n`,
    "utf8"
  );
}
