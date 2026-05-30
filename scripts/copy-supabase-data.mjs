import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const TABLES = [
  "projects",
  "rooms",
  "products",
  "room_images",
  "materials",
  "material_items",
  "room_products",
  "procurement_items",
];

function parseEnv(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const [key, ...valueParts] = line.split("=");
        const value = valueParts.join("=").trim().replace(/^"|"$/g, "");
        return [key.trim(), value];
      }),
  );
}

async function loadEnv() {
  try {
    return parseEnv(await readFile(".env", "utf8"));
  } catch {
    return {};
  }
}

async function readAll(client, table) {
  const rows = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function insertRows(client, table, rows) {
  if (!rows.length) return;
  const { error } = await client.from(table).insert(rows);
  if (error) {
    throw new Error(`${table}: ${error.message}`);
  }
}

async function clearDestination(client) {
  for (const table of [...TABLES].reverse()) {
    const { error } = await client
      .from(table)
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      throw new Error(`clear ${table}: ${error.message}`);
    }
  }
}

const env = await loadEnv();
const oldUrl = process.env.OLD_SUPABASE_URL;
const oldKey = process.env.OLD_SUPABASE_PUBLISHABLE_KEY;
const newUrl = process.env.SUPABASE_URL ?? env.SUPABASE_URL;
const newKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
const mode = process.argv.includes("--restore") ? "restore" : "backup";

if (!oldUrl || !oldKey) {
  throw new Error(
    "Set OLD_SUPABASE_URL and OLD_SUPABASE_PUBLISHABLE_KEY before running this script.",
  );
}

const source = createClient(oldUrl, oldKey, { auth: { persistSession: false } });
const backup = {};

for (const table of TABLES) {
  backup[table] = await readAll(source, table);
  console.log(`${table}: ${backup[table].length}`);
}

await mkdir("migration-backups", { recursive: true });
const backupPath = `migration-backups/meravhome-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(backupPath, JSON.stringify(backup, null, 2));
console.log(`backup: ${backupPath}`);

if (mode === "restore") {
  if (!newUrl || !newKey) {
    throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before restoring.");
  }

  const destination = createClient(newUrl, newKey, { auth: { persistSession: false } });
  await clearDestination(destination);

  for (const table of TABLES) {
    if (table === "procurement_items") continue;
    await insertRows(destination, table, backup[table]);
  }

  // room_products creates procurement rows via trigger; replace those with the original rows.
  const { error: clearProcurementError } = await destination
    .from("procurement_items")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (clearProcurementError) {
    throw new Error(`clear procurement_items: ${clearProcurementError.message}`);
  }

  await insertRows(destination, "procurement_items", backup.procurement_items);
  console.log("restore: complete");
}
