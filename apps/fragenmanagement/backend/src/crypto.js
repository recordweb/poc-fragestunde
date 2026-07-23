import crypto from "crypto";

function canonicalize(obj) {
  if (Array.isArray(obj)) return `[${obj.map(canonicalize).join(",")}]`;
  if (obj !== null && typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `"${k}":${canonicalize(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(obj);
}

export function sha256Hex(buffer) {
  return "sha256:" + crypto.createHash("sha256").update(buffer).digest("hex");
}

export function computeSnapshotHash(metadataWithoutHash, payload) {
  const canonical = canonicalize(metadataWithoutHash);
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  return "sha256:" + crypto.createHash("sha256")
    .update(Buffer.concat([Buffer.from(canonical), payloadBytes]))
    .digest("hex");
}

export function computePayloadHash(payload) {
  return sha256Hex(Buffer.from(JSON.stringify(payload)));
}