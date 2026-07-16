// Server-side persistence for templates (PLAN-TEMPLATE): one JSON array in
// data/templates.json — same data-dir pattern as settings.ts/historyMeta.ts.

import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { MAX_TEMPLATES, type Template } from "./templates";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "templates.json");

export async function readTemplates(): Promise<Template[]> {
  try {
    const list = JSON.parse(await fs.readFile(FILE, "utf-8"));
    return Array.isArray(list) ? (list as Template[]) : [];
  } catch {
    return [];
  }
}

async function writeTemplates(list: Template[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(list, null, 2), "utf-8");
}

/** Insert (no id) or update (with id) one template. Newest first; capped at
 *  MAX_TEMPLATES by dropping the oldest. */
export async function upsertTemplate(input: Omit<Template, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<Template[]> {
  const list = await readTemplates();
  const now = Date.now();
  const existing = input.id ? list.find((t) => t.id === input.id) : undefined;
  if (existing) {
    Object.assign(existing, input, { updatedAt: now });
  } else {
    list.unshift({ ...input, id: randomUUID(), createdAt: now, updatedAt: now });
  }
  const capped = list.slice(0, MAX_TEMPLATES);
  await writeTemplates(capped);
  return capped;
}

export async function deleteTemplate(id: string): Promise<Template[]> {
  const list = (await readTemplates()).filter((t) => t.id !== id);
  await writeTemplates(list);
  return list;
}
