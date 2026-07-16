import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
  "B2_BUCKET_NAME",
];

const PAGE_SIZE = 1000;
const MAX_SINGLE_UPLOAD_BYTES = 4.5 * 1024 * 1024 * 1024;

function requireEnvironment() {
  const missing = REQUIRED_ENV.filter((name) => !String(process.env[name] ?? "").trim());
  if (missing.length) throw new Error(`Missing backup environment variables: ${missing.join(", ")}`);
}

function isoPath(date) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function encodeB2FileName(fileName) {
  return fileName.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function sha1(buffer) {
  return createHash("sha1").update(buffer).digest("hex");
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Preserve a short response excerpt without ever including credentials.
  }
  if (!response.ok) {
    const detail = body?.message || body?.code || text.slice(0, 200) || response.statusText;
    throw new Error(`${label} failed (${response.status}): ${detail}`);
  }
  return body;
}

async function authorizeB2() {
  const credentials = Buffer.from(`${process.env.B2_KEY_ID}:${process.env.B2_APPLICATION_KEY}`).toString("base64");
  const response = await fetch("https://api.backblazeb2.com/b2api/v4/b2_authorize_account", {
    headers: { Authorization: `Basic ${credentials}` },
  });
  const authorization = await jsonResponse(response, "Backblaze authorization");
  const storageApi = authorization?.apiInfo?.storageApi;
  const allowedBuckets = storageApi?.allowed?.buckets;
  const backupBucket = Array.isArray(allowedBuckets)
    ? allowedBuckets.find((bucket) => bucket.name === process.env.B2_BUCKET_NAME)
    : null;
  if (!storageApi?.apiUrl || !backupBucket?.id || !authorization?.authorizationToken) {
    throw new Error("Backblaze key is not restricted to the expected backup bucket.");
  }
  if (allowedBuckets.length !== 1) {
    throw new Error("Backblaze key must be restricted to only the Studio backup bucket.");
  }
  const capabilities = storageApi.allowed?.capabilities ?? [];
  for (const capability of ["listFiles", "writeFiles"]) {
    if (!capabilities.includes(capability)) {
      throw new Error(`Backblaze key is missing the ${capability} capability.`);
    }
  }
  return {
    apiUrl: storageApi.apiUrl,
    authorizationToken: authorization.authorizationToken,
    bucketId: backupBucket.id,
  };
}

async function listB2Files(b2, prefix = "") {
  const files = new Map();
  let startFileName = null;
  do {
    const url = new URL(`${b2.apiUrl}/b2api/v4/b2_list_file_names`);
    url.searchParams.set("bucketId", b2.bucketId);
    url.searchParams.set("maxFileCount", "10000");
    if (prefix) url.searchParams.set("prefix", prefix);
    if (startFileName) url.searchParams.set("startFileName", startFileName);
    const response = await fetch(url, { headers: { Authorization: b2.authorizationToken } });
    const page = await jsonResponse(response, "Backblaze file listing");
    for (const file of page?.files ?? []) {
      if (file.action === "upload") files.set(file.fileName, file);
    }
    startFileName = page?.nextFileName ?? null;
  } while (startFileName);
  return files;
}

async function getB2UploadTarget(b2) {
  const response = await fetch(`${b2.apiUrl}/b2api/v4/b2_get_upload_url`, {
    method: "POST",
    headers: {
      Authorization: b2.authorizationToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId: b2.bucketId }),
  });
  return jsonResponse(response, "Backblaze upload URL");
}

async function uploadB2File(b2, fileName, content, contentType, info = {}) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  if (buffer.byteLength > MAX_SINGLE_UPLOAD_BYTES) {
    throw new Error(`${fileName} exceeds the safe single-file backup limit.`);
  }

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const target = await getB2UploadTarget(b2);
    const headers = {
      Authorization: target.authorizationToken,
      "Content-Length": String(buffer.byteLength),
      "Content-Type": contentType || "b2/x-auto",
      "X-Bz-Content-Sha1": sha1(buffer),
      "X-Bz-File-Name": encodeB2FileName(fileName),
    };
    for (const [key, value] of Object.entries(info)) {
      if (value !== null && value !== undefined && value !== "") {
        headers[`X-Bz-Info-${key}`] = encodeURIComponent(String(value));
      }
    }

    let response;
    try {
      response = await fetch(target.uploadUrl, { method: "POST", headers, body: buffer });
    } catch (error) {
      if (attempt === 5) throw error;
      continue;
    }
    if (response.ok) return jsonResponse(response, `Upload ${fileName}`);
    if (attempt === 5 || (response.status !== 401 && response.status !== 408 && response.status < 500)) {
      await jsonResponse(response, `Upload ${fileName}`);
    }
  }
  throw new Error(`Upload ${fileName} failed after five attempts.`);
}

async function discoverPublicResources(supabaseUrl, serviceRoleKey) {
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/`, {
    headers: {
      Accept: "application/openapi+json",
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
  const specification = await jsonResponse(response, "Supabase schema discovery");
  return Object.entries(specification?.paths ?? {})
    .filter(([path, operations]) => path.startsWith("/") && !path.startsWith("/rpc/") && operations?.get)
    .map(([path]) => decodeURIComponent(path.slice(1)))
    .filter(Boolean)
    .sort();
}

async function readAllRows(supabase, table) {
  const rows = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

async function exportPublicData(supabase, supabaseUrl, serviceRoleKey) {
  const resources = await discoverPublicResources(supabaseUrl, serviceRoleKey);
  const tables = {};
  for (const table of resources) {
    tables[table] = await readAllRows(supabase, table);
    console.log(`database: ${table} (${tables[table].length} rows)`);
  }
  return tables;
}

async function exportAuthUsers(supabase) {
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`auth.users: ${error.message}`);
    users.push(...(data?.users ?? []));
    if (!data?.users || data.users.length < PAGE_SIZE) return users;
  }
}

async function listStorageObjects(supabase, bucketName, prefix = "") {
  const objects = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase.storage.from(bucketName).list(prefix, {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`${bucketName}/${prefix}: ${error.message}`);
    for (const item of data ?? []) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id) {
        objects.push({
          bucket: bucketName,
          path,
          size: Number(item.metadata?.size ?? 0),
          contentType: item.metadata?.mimetype || item.metadata?.contentType || "application/octet-stream",
          updatedAt: item.updated_at || item.created_at || "",
        });
      } else {
        objects.push(...await listStorageObjects(supabase, bucketName, path));
      }
    }
    if (!data || data.length < PAGE_SIZE) return objects;
  }
}

function storageBackupName(object) {
  return `storage/${object.bucket}/${object.path}`;
}

function storageObjectIsCurrent(existing, source) {
  const sourceUpdatedAt = decodeURIComponent(existing?.fileInfo?.source_updated_at ?? "");
  return Number(existing?.contentLength ?? -1) === source.size && sourceUpdatedAt === source.updatedAt;
}

async function backUpStorage(supabase, b2, existingFiles) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`storage buckets: ${error.message}`);

  const manifest = [];
  let uploaded = 0;
  let skipped = 0;
  for (const bucket of buckets ?? []) {
    const objects = await listStorageObjects(supabase, bucket.name);
    console.log(`storage: ${bucket.name} (${objects.length} files)`);
    for (const object of objects) {
      const backupName = storageBackupName(object);
      manifest.push({ ...object, backupName });
      if (storageObjectIsCurrent(existingFiles.get(backupName), object)) {
        skipped += 1;
        continue;
      }
      const { data, error: downloadError } = await supabase.storage.from(object.bucket).download(object.path);
      if (downloadError || !data) throw new Error(`${object.bucket}/${object.path}: ${downloadError?.message || "download failed"}`);
      const content = Buffer.from(await data.arrayBuffer());
      await uploadB2File(b2, backupName, content, object.contentType, {
        source_updated_at: object.updatedAt,
        source_size: object.size,
      });
      uploaded += 1;
    }
  }
  return { manifest, uploaded, skipped };
}

async function main() {
  requireEnvironment();
  const startedAt = new Date();
  const timestamp = isoPath(startedAt);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });
  const b2 = await authorizeB2();
  const existingFiles = await listB2Files(b2, "storage/");

  const tables = await exportPublicData(supabase, process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const authUsers = await exportAuthUsers(supabase);
  console.log(`auth: users (${authUsers.length} rows)`);

  const storage = await backUpStorage(supabase, b2, existingFiles);
  const databasePrefix = `database/${startedAt.getUTCFullYear()}/${String(startedAt.getUTCMonth() + 1).padStart(2, "0")}/${String(startedAt.getUTCDate()).padStart(2, "0")}/${timestamp}`;
  const publicData = gzipSync(Buffer.from(JSON.stringify({ generatedAt: startedAt.toISOString(), tables })));
  const authData = gzipSync(Buffer.from(JSON.stringify({ generatedAt: startedAt.toISOString(), users: authUsers })));
  const storageManifest = gzipSync(Buffer.from(JSON.stringify({ generatedAt: startedAt.toISOString(), objects: storage.manifest })));

  await uploadB2File(b2, `${databasePrefix}/public-data.json.gz`, publicData, "application/gzip");
  await uploadB2File(b2, `${databasePrefix}/auth-users.json.gz`, authData, "application/gzip");
  await uploadB2File(b2, `${databasePrefix}/storage-manifest.json.gz`, storageManifest, "application/gzip");

  const summary = {
    formatVersion: 1,
    generatedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    publicResources: Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.length])),
    authUsers: authUsers.length,
    storageFiles: storage.manifest.length,
    storageUploaded: storage.uploaded,
    storageUnchanged: storage.skipped,
    notes: [
      "Production was read only during this backup.",
      "Source deletions are never propagated to Backblaze.",
      "Auth account metadata is exported; Supabase managed database backups remain the password-preserving Auth backup.",
    ],
  };
  await uploadB2File(b2, `${databasePrefix}/manifest.json`, Buffer.from(JSON.stringify(summary, null, 2)), "application/json");
  console.log(`backup complete: ${databasePrefix}`);
  console.log(`storage: ${storage.uploaded} uploaded, ${storage.skipped} unchanged`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
