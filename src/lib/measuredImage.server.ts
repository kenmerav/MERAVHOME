import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { ProjectAccessError } from "./measuredAccess.server";
import { dataUrlToBuffer } from "./roomImageStorage.server";

const LIMIT = 20 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
// Fail closed for IPv6 outside global unicast. Exclude mapped/translation,
// link-local, unique-local, multicast, documentation and transition addresses.
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) !== 6) return false;
  const [first, second] = address.split(":").slice(0,2).map(part => parseInt(part || "0", 16));
  return first >= 0x2000 && first < 0x3fff && first !== 0x2002 && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
}
export function publicImageUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    (isIP(host) && !isPublicAddress(host))) throw new ProjectAccessError("Choose a public HTTPS image URL.", 400);
  return url;
}
export async function safeImageBuffer(value: string, signal = AbortSignal.timeout(15000)) {
  if (value.startsWith("data:")) return dataUrlToBuffer(value);
  let url = publicImageUrl(value);
  for (let hop = 0; hop <= 3; hop++) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (signal.aborted) throw new ProjectAccessError("Image download timed out.", 504);
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await new Promise<Array<{address:string;family:number}>>((resolve,reject) => {
      const expired = () => reject(new ProjectAccessError("Image download timed out.",504));
      signal.addEventListener("abort",expired,{once:true});
      lookup(host,{all:true}).then(addresses => { signal.removeEventListener("abort",expired); resolve(addresses); }, error => { signal.removeEventListener("abort",expired); reject(error); });
    });
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new ProjectAccessError("Choose a public image URL.", 400);
    // Pin the connection to the checked address; no second DNS resolution can
    // turn an initially public hostname into a private-address request.
    const address = addresses[0];
    const result = await new Promise<{ location?: string; buffer?: Buffer; contentType?: string }>((resolve, reject) => {
      const req = httpsRequest(url, {
        agent: false, signal,
        headers: { Accept: "image/png,image/jpeg,image/webp,image/gif", "Accept-Encoding": "identity" },
        lookup: (_host, options, callback) => {
          if (typeof options === "object" && options.all) callback(null, [{ address: address.address, family: address.family }]);
          else callback(null, address.address, address.family);
        },
      }, res => {
        if ([301,302,303,307,308].includes(res.statusCode ?? 0) && res.headers.location) {
          resolve({ location: res.headers.location }); res.destroy(); return;
        }
        const type = String(res.headers["content-type"] ?? "").split(";")[0].toLowerCase();
        if (res.statusCode !== 200 || !MIME.has(type) || (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")) {
          reject(new ProjectAccessError("URL did not return a supported image.", 400)); res.destroy(); return;
        }
        if (Number(res.headers["content-length"]) > LIMIT) { reject(new ProjectAccessError("Keep images under 20 MB.", 413)); res.destroy(); return; }
        const chunks: Buffer[] = []; let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > LIMIT) { reject(new ProjectAccessError("Keep images under 20 MB.", 413)); res.destroy(); }
          else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => size ? resolve({ buffer: Buffer.concat(chunks), contentType: type }) : reject(new ProjectAccessError("Image is empty.", 400)));
      });
      req.on("error", reject); req.end();
    });
    if (result.location) { url = publicImageUrl(new URL(result.location, url).href); continue; }
    return { buffer: result.buffer!, contentType: result.contentType! };
  }
  throw new ProjectAccessError("Too many image redirects.", 400);
}
