// Haelt Case-Records (RWP CaseRecord, Kapitel 8) synchron, wenn sich der
// Zustand eines darin per workingLink referenzierten Records aendert.
//
// Aktuell einziger Anwendungsfall: die Antwort eines Case wird finalisiert.
// Der bisherige Soft Link (workingLinks, RWP 8.4) auf die Antwort wird durch
// einen Hard Link in `result` ersetzt (jetzt mit feststehendem snapshotHash),
// die Merkle-Root wird nach RWP 8.5/9.5 neu berechnet. Der Case selbst bleibt
// dabei im Status "draft" -- das Case-Finalisieren ist ein separater, vom
// Sachbearbeiter bewusst ausgeloester Schritt (siehe routes/cases.js).
import { listRecordsByType, updateDraftPayloadInPlace } from "./recordCore.js";
import { computeMerkleRoot, collectHardHashes } from "./merkle.js";
import { RECORD_TYPE_CASE } from "./schemas.js";

export async function findCaseByWorkingLinkTarget(targetDid) {
  const cases = await listRecordsByType(RECORD_TYPE_CASE);
  return cases.find((c) => (c.payload.workingLinks || []).some((w) => w.recordDid === targetDid)) || null;
}

export async function promoteWorkingLinkToHardLink(targetDid, finalizedSnapshotHash) {
  const caseRecord = await findCaseByWorkingLinkTarget(targetDid);
  if (!caseRecord) return null;

  const payload = caseRecord.payload;
  const movedLink = (payload.workingLinks || []).find((w) => w.recordDid === targetDid);
  if (!movedLink) return null;

  const remainingWorkingLinks = (payload.workingLinks || []).filter((w) => w.recordDid !== targetDid);
  const hardLink = { type: "hard", recordDid: targetDid, snapshotHash: finalizedSnapshotHash, role: movedLink.role };

  const updatedPayload = {
    ...payload,
    workingLinks: remainingWorkingLinks,
    [movedLink.targetField]: movedLink.targetField === "decision"
      ? hardLink
      : [...(payload[movedLink.targetField] || []), hardLink]
  };
  updatedPayload.merkleRoot = computeMerkleRoot(collectHardHashes(updatedPayload));

  await updateDraftPayloadInPlace(caseRecord.id, updatedPayload);
  return { caseDid: caseRecord.did, payload: updatedPayload };
}
