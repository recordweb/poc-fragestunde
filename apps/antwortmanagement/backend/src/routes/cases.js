import express from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { validatePayload, schemaVersionHash, RECORD_TYPE_ANTWORT, RECORD_TYPE_CASE } from "../schemas.js";
import { computeMerkleRoot, collectHardHashes } from "../merkle.js";
import { resolveRecord } from "../resolveRecord.js";
import { logEvent } from "../logger.js";
import {
  getFullRecord, listRecordsByType, createSnapshot, insertRecord, setCurrentSnapshot
} from "../recordCore.js";

const router = express.Router();
const NAMESPACE_ANTWORTMANAGEMENT = "b7d4c810";
const SOX_API_BASE_URL = process.env.SOX_API_BASE_URL || "http://sox:3000/api";
const SOX_RECORD_TYPES = new Set(["MiniChat", "TeamsChat"]);

function chatRole(recordType) {
  return recordType === "MiniChat"
    ? "MiniChat (in Bearbeitung)"
    : "TeamsChat (in Bearbeitung)";
}

// Reichert einen Case um den frisch aufgeloesten Trigger (Frage, ueber den
// Resolver -- keine lokale Kopie) und die lokal bereits bekannte Antwort an
// (result, falls schon Hard Link, sonst der Draft ueber workingLinks). Beides
// zusammen ergibt genau die im UI gewuenschte Ansicht: Frage per DID-Resolve,
// Antwort direkt.
async function enrichCase(caseRow) {
  const payload = caseRow.payload;
  const resolvedFrage = await resolveRecord(payload.trigger?.recordDid);

  const antwortDid =
    payload.result?.[0]?.recordDid ||
    payload.workingLinks?.find((w) => w.targetField === "result")?.recordDid ||
    null;
  const antwort = antwortDid ? await getFullRecord(antwortDid) : null;

  return { ...caseRow, resolvedFrage, antwort };
}

// ---------- Liste (inkl. Drafts) ----------
/**
 * @openapi
 * /cases:
 *   get:
 *     tags: [Cases]
 *     summary: Alle Fragestunde-Cases auflisten (inkl. Drafts)
 *     responses:
 *       200:
 *         description: Liste aller Cases, angereichert um aufgeloeste Frage und lokale Antwort
 */
router.get("/", async (req, res) => {
  const rows = await listRecordsByType(RECORD_TYPE_CASE);
  res.json(await Promise.all(rows.map(enrichCase)));
});

// ---------- Case + Antwort gemeinsam anlegen ----------
/**
 * @openapi
 * /cases:
 *   post:
 *     tags: [Cases]
 *     summary: Neuen Case mit zugehoeriger Antwort als Draft anlegen
 *     description: >
 *       Erstellt in einem Zug (1) die Antwort als eigenstaendigen Record,
 *       (2) einen neuen Case-Record (RWP CaseRecord, Kapitel 8) und
 *       (3) verlinkt Frage (trigger, Hard Link) und Antwort (workingLinks,
 *       Soft Link solange die Antwort noch Draft ist) korrekt darin. Beide
 *       Records starten im Status "draft".
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner, antworttext, frage_did, frage_snapshot_hash]
 *             properties:
 *               owner:
 *                 type: string
 *                 example: "did:rwp:b7d4c810:users/sandra-huber"
 *               antworttext:
 *                 type: string
 *               frage_did:
 *                 type: string
 *               frage_snapshot_hash:
 *                 type: string
 *     responses:
 *       201:
 *         description: Case und Antwort erstellt
 *       422:
 *         description: Payload ungueltig
 */
router.post("/", async (req, res) => {
  const { owner, antworttext, frage_did, frage_snapshot_hash } = req.body;

  if (!frage_did || !frage_snapshot_hash) {
    return res.status(422).json({ error: "frage_did und frage_snapshot_hash sind erforderlich" });
  }

  const antwortPayload = { antworttext, bundesrat_did: owner, beantwortet_am: new Date().toISOString() };
  const antwortCheck = validatePayload(RECORD_TYPE_ANTWORT, antwortPayload);
  if (!antwortCheck.valid) {
    return res.status(422).json({ error: "Antwort-Payload ungueltig", details: antwortCheck.errors });
  }

  // 1. Antwort als eigener Record (draft) -- kennt ihre Frage nicht mehr
  // selbst, das uebernimmt ausschliesslich der Case.
  const antwortDid = `did:rwp:${NAMESPACE_ANTWORTMANAGEMENT}:records:${uuidv4()}`;
  const antwortSnapshot = await createSnapshot({
    did: antwortDid, parents: [], state: "draft",
    recordType: RECORD_TYPE_ANTWORT, schemaVersion: schemaVersionHash(RECORD_TYPE_ANTWORT), owner,
    payload: antwortPayload, payloadFormat: "application/json"
  });
  await insertRecord({
    did: antwortDid, recordType: RECORD_TYPE_ANTWORT,
    schemaVersion: antwortSnapshot.schema_version, owner, snapshotId: antwortSnapshot.id
  });

  // 2. Case (draft): trigger = Frage (bereits finalisiert -> sofort Hard
  // Link moeglich), Antwort zunaechst nur als Soft Link (workingLinks), da
  // sie selbst noch Draft ist (RWP 8.4: Hard Links duerfen nur auf
  // finalisierte Snapshots zeigen).
  const caseDid = `did:rwp:${NAMESPACE_ANTWORTMANAGEMENT}:records:${uuidv4()}`;
  const casePayload = {
    caseId: caseDid,
    caseType: RECORD_TYPE_CASE,
    title: `Fragestunde-Case zu Frage ${frage_did}`,
    trigger: { type: "hard", recordDid: frage_did, snapshotHash: frage_snapshot_hash, role: "Parlamentarische Frage" },
    context: [],
    process: [],
    decision: null,
    result: [],
    workingLinks: [{ type: "working", recordDid: antwortDid, targetField: "result", role: "Antwort (in Bearbeitung)" }]
  };
  casePayload.merkleRoot = computeMerkleRoot(collectHardHashes(casePayload));

  const caseCheck = validatePayload(RECORD_TYPE_CASE, casePayload);
  if (!caseCheck.valid) {
    return res.status(422).json({ error: "Case-Payload ungueltig", details: caseCheck.errors });
  }

  const caseSnapshot = await createSnapshot({
    did: caseDid, parents: [], state: "draft",
    recordType: RECORD_TYPE_CASE, schemaVersion: schemaVersionHash(RECORD_TYPE_CASE), owner,
    payload: casePayload, payloadFormat: "application/json"
  });
  await insertRecord({
    did: caseDid, recordType: RECORD_TYPE_CASE,
    schemaVersion: caseSnapshot.schema_version, owner, snapshotId: caseSnapshot.id
  });

  await logEvent(`Case angelegt: ${caseDid} (Frage: ${frage_did}, Antwort: ${antwortDid})`);

  res.status(201).json(await enrichCase(await getFullRecord(caseDid)));
});

router.post(/^\/(.+)\/chat-records$/, async (req, res) => {
  const caseDid = decodeURIComponent(req.params[0]);
  const { recordType } = req.body || {};

  if (!SOX_RECORD_TYPES.has(recordType)) {
    return res.status(400).json({
      error: "recordType must be MiniChat or TeamsChat"
    });
  }

  const caseRecord = await getFullRecord(caseDid);
  if (!caseRecord || caseRecord.record_type !== RECORD_TYPE_CASE) {
    return res.status(404).json({
      error: "Case nicht gefunden"
    });
  }

  if (caseRecord.state !== "draft") {
    return res.status(409).json({
      error: "Chats können nur bei Draft-Cases gestartet werden"
    });
  }

  const existingChat = (caseRecord.payload.workingLinks || []).find((link) =>
    link.targetField === "process" &&
    link.recordType === recordType
  );

  if (existingChat) {
    return res.status(409).json({
      error: `Für diesen Case existiert bereits ein offener ${recordType}-Record`,
      recordDid: existingChat.recordDid
    });
  }

  const caseReference = {
    system: "antwortmanagement",
    caseId: caseDid,
    uri: `${process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev"}/antwortmanagement/api/cases/${encodeURIComponent(caseDid)}`
  };

  const title = `${recordType} zu ${caseRecord.payload.title || caseDid}`;

  let soxResponse;
  try {
    soxResponse = await fetch(`${SOX_API_BASE_URL}/records`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        recordType,
        title,
        caseReference
      })
    });
  } catch {
    return res.status(502).json({
      error: "SoX ist nicht erreichbar"
    });
  }

  const soxBody = await soxResponse.json().catch(() => ({}));

  if (!soxResponse.ok) {
    return res.status(soxResponse.status >= 500 ? 502 : soxResponse.status).json({
      error: soxBody.error || "SoX konnte keinen Chat-Record erstellen"
    });
  }

  const payload = structuredClone(caseRecord.payload);
  payload.workingLinks = payload.workingLinks || [];
  payload.workingLinks.push({
    type: "working",
    recordDid: soxBody.did,
    targetField: "process",
    role: chatRole(recordType),
    recordType
  });
  payload.merkleRoot = computeMerkleRoot(collectHardHashes(payload));

  const payloadCheck = validatePayload(RECORD_TYPE_CASE, payload);
  if (!payloadCheck.valid) {
    return res.status(422).json({
      error: "Aktualisierter Case-Payload ungültig",
      details: payloadCheck.errors
    });
  }

  const updatedSnapshot = await createSnapshot({
    did: caseDid,
    parents: [caseRecord.snapshot_hash].filter(Boolean),
    state: "draft",
    recordType: caseRecord.record_type,
    schemaVersion: caseRecord.schema_version,
    owner: caseRecord.owner,
    payload,
    payloadFormat: "application/json"
  });

  await setCurrentSnapshot(caseDid, updatedSnapshot.id);

  await logEvent(
    `${recordType} gestartet: ${soxBody.did} mit Case ${caseDid} verknüpft`
  );

  res.status(201).json({
    chatRecord: soxBody,
    case: await enrichCase(await getFullRecord(caseDid))
  });
});

// ---------- Case finalisieren ----------
/**
 * @openapi
 * /cases/{did}/finalize:
 *   put:
 *     tags: [Cases]
 *     summary: Case finalisieren
 *     description: >
 *       Nur moeglich, wenn keine offenen workingLinks mehr bestehen (d.h.
 *       die verlinkte Antwort bereits finalisiert wurde) und mindestens ein
 *       Result als Hard Link vorhanden ist (RWP 8.2/8.4). Der Case selbst
 *       kennt kein "Bearbeiten" -- nur Verlinkung und Finalisierung.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Case finalisiert
 *       404:
 *         description: Case nicht gefunden
 *       409:
 *         description: Case kann noch nicht finalisiert werden
 */
router.put(/^\/(.+)\/finalize$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record || record.record_type !== RECORD_TYPE_CASE) {
    return res.status(404).json({ error: "Case nicht gefunden" });
  }
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Draft-Cases koennen finalisiert werden" });
  }

  const payload = structuredClone(record.payload);
  const unresolvedWorkingLinks = [];

  for (const workingLink of payload.workingLinks || []) {
    const linkedRecord = await resolveRecord(workingLink.recordDid);

    if (
      !linkedRecord ||
      linkedRecord.status !== "finalized" ||
      !linkedRecord.snapshotHash
    ) {
      unresolvedWorkingLinks.push({
        recordDid: workingLink.recordDid,
        targetField: workingLink.targetField,
        role: workingLink.role,
        status: linkedRecord?.status || "not-resolvable"
      });
      continue;
    }

    const hardLink = {
      type: "hard",
      recordDid: workingLink.recordDid,
      snapshotHash: linkedRecord.snapshotHash,
      role: workingLink.role
    };

    if (workingLink.targetField === "decision") {
      payload.decision = hardLink;
    } else {
      payload[workingLink.targetField] = [
        ...(payload[workingLink.targetField] || []),
        hardLink
      ];
    }
  }

  payload.workingLinks = unresolvedWorkingLinks.map((link) => ({
    type: "working",
    recordDid: link.recordDid,
    targetField: link.targetField,
    role: link.role
  }));

  payload.merkleRoot = computeMerkleRoot(collectHardHashes(payload));

  if (payload.workingLinks.length > 0) {
    return res.status(409).json({
      error: "Case kann erst finalisiert werden, wenn alle verlinkten Records finalisiert sind",
      openWorkingReferences: unresolvedWorkingLinks
    });
  }

  if (!payload.result || payload.result.length < 1) {
    return res.status(409).json({ error: "Case benoetigt mindestens ein Result (die finalisierte Antwort)" });
  }

  const expectedRoot = computeMerkleRoot(collectHardHashes(payload));
  if (expectedRoot !== payload.merkleRoot) {
    return res.status(409).json({ error: "Merkle-Root stimmt nicht ueberein", expected: expectedRoot, stored: payload.merkleRoot });
  }

  const finalizedSnapshot = await createSnapshot({
    did, parents: [record.snapshot_hash].filter(Boolean),
    state: "finalized", recordType: record.record_type,
    schemaVersion: record.schema_version, owner: record.owner,
    payload, payloadFormat: "application/json"
  });
  await setCurrentSnapshot(did, finalizedSnapshot.id);
  await logEvent(`Case finalisiert: ${did} (Merkle-Root: ${finalizedSnapshot.snapshot_hash})`);

  res.json(await enrichCase(await getFullRecord(did)));
});

// ---------- Vollstaendigkeitspruefung (RWP 8.6) ----------
/**
 * @openapi
 * /cases/{did}/completeness:
 *   get:
 *     tags: [Cases]
 *     summary: Case-Vollstaendigkeitspruefung gemaess RWP 8.6
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vollstaendigkeitsstatus
 *       404:
 *         description: Case nicht gefunden
 */
router.get(/^\/(.+)\/completeness$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record || record.record_type !== RECORD_TYPE_CASE) {
    return res.status(404).json({ error: "Case nicht gefunden" });
  }
  const payload = record.payload;
  const missingElements = [];
  if (!payload.trigger) missingElements.push("trigger");
  if (!payload.result || payload.result.length < 1) missingElements.push("result");

  const openWorkingReferences = (payload.workingLinks || []).map((link) => ({
    recordDid: link.recordDid,
    targetField: link.targetField,
    role: link.role
  }));

  const merkleRootValid = computeMerkleRoot(collectHardHashes(payload)) === payload.merkleRoot;

  res.json({
    caseId: payload.caseId,
    complete: missingElements.length === 0 && openWorkingReferences.length === 0,
    missingElements,
    openWorkingReferences,
    merkleRootValid
  });
});

router.get(/^\/(.+)\/chat-records\/(.+)$/, async (req, res) => {
  const caseDid = decodeURIComponent(req.params[0]);
  const chatDid = decodeURIComponent(req.params[1]);

  const caseRecord = await getFullRecord(caseDid);
  if (!caseRecord || caseRecord.record_type !== RECORD_TYPE_CASE) {
    return res.status(404).json({
      error: "Case nicht gefunden"
    });
  }

  const chatLink = [
    ...(caseRecord.payload.process || []),
    ...(caseRecord.payload.workingLinks || [])
  ].find((link) =>
    link.recordDid === chatDid &&
    (link.targetField === "process" || link.type === "hard")
  );

  if (!chatLink) {
    return res.status(404).json({
      error: "Der SoX-Record ist nicht mit diesem Case verknüpft"
    });
  }

  const record = await resolveRecord(chatDid);
  if (!record) {
    return res.status(502).json({
      error: "SoX-Record konnte nicht aufgelöst werden"
    });
  }

  res.json(record);
});

// ---------- Einzelner Case (muss nach den spezifischen Routen stehen) ----------
/**
 * @openapi
 * /cases/{did}:
 *   get:
 *     tags: [Cases]
 *     summary: Einzelnen Case lesen
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Case, angereichert um aufgeloeste Frage und lokale Antwort
 *       404:
 *         description: Case nicht gefunden
 */
router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record || record.record_type !== RECORD_TYPE_CASE) {
    return res.status(404).json({ error: "Case nicht gefunden" });
  }
  res.json(await enrichCase(record));
});

export default router;
