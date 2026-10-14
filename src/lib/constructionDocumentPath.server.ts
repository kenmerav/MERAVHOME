export function projectDocumentStoragePath(fileUrl: string, projectId: string, supabaseUrl: string) {
  const url = new URL(fileUrl);
  if (url.origin !== new URL(supabaseUrl).origin) throw new Error("Unsupported document location");
  const match = decodeURIComponent(url.pathname).match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/project-files\/(.+)$/);
  const path = match?.[1];
  if (!path?.startsWith(`${projectId}/construction-docs/`) || path.split("/").includes("..") || !/\.pdf$/i.test(path))
    throw new Error("Unsupported project document path");
  return path;
}
