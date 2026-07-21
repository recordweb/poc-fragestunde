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
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  const canonicalMeta = canonicalize(metadataWithoutHash);
  return sha256Hex(Buffer.concat([Buffer.from(canonicalMeta), payloadBytes]));
}

export function computePayloadHash(payload) {
  return sha256Hex(Buffer.from(JSON.stringify(payload)));
}