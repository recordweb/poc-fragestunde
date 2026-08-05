// Merkle-Root-Berechnung fuer Case-Records gemaess RWP Abschnitt 9.5
// ("Merkle Tree Algorithm") und Abschnitt 8.5 ("Case Merkle Root").
//
// Algorithmus (woertlich aus der Spezifikation):
//   function merkleRoot(hashes: SHA256[]) -> SHA256:
//     if hashes.length == 0: return SHA256("")
//     if hashes.length == 1: return hashes[0]
//     sorted = sort(hashes) // alphabetisch nach Hex-String
//     while sorted.length > 1:
//       nextLevel = []
//       for i in range(0, sorted.length, 2):
//         if i + 1 < sorted.length: nextLevel.append(SHA256(sorted[i] || sorted[i+1]))
//         else: nextLevel.append(sorted[i]) // ungerades Element unveraendert uebernehmen
//       sorted = nextLevel
//     return sorted[0]
//
// "sorted[i] || sorted[i+1]" wird hier als Byte-Konkatenation der beiden
// Hash-Digests interpretiert (nicht der "sha256:"-Praefix-Strings).
import crypto from "crypto";

function hexToBuf(shaWithPrefix) {
  return Buffer.from(shaWithPrefix.replace(/^sha256:/, ""), "hex");
}

function bufToSha(buf) {
  return "sha256:" + buf.toString("hex");
}

function pairHash(a, b) {
  return bufToSha(crypto.createHash("sha256").update(Buffer.concat([hexToBuf(a), hexToBuf(b)])).digest());
}

export function computeMerkleRoot(hashes) {
  if (!hashes || hashes.length === 0) {
    return bufToSha(crypto.createHash("sha256").update(Buffer.from("")).digest());
  }
  if (hashes.length === 1) return hashes[0];

  let level = [...hashes].sort();
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? pairHash(level[i], level[i + 1]) : level[i]);
    }
    level = next;
  }
  return level[0];
}

// Sammelt alle Hard-Link-snapshotHash-Werte eines Case-Payloads in der von
// RWP 8.5 vorgesehenen Reihenfolge (trigger, context, process, decision,
// result) -- die tatsaechliche Sortierung passiert innerhalb von
// computeMerkleRoot, die Reihenfolge hier dient nur der Lesbarkeit.
export function collectHardHashes(payload) {
  const hashes = [];
  if (payload.trigger?.snapshotHash) hashes.push(payload.trigger.snapshotHash);
  for (const l of payload.context || []) if (l.type === "hard" && l.snapshotHash) hashes.push(l.snapshotHash);
  for (const l of payload.process || []) if (l.type === "hard" && l.snapshotHash) hashes.push(l.snapshotHash);
  if (payload.decision?.snapshotHash) hashes.push(payload.decision.snapshotHash);
  for (const l of payload.result || []) if (l.snapshotHash) hashes.push(l.snapshotHash);
  return hashes;
}
