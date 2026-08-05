import express from "express";
import { v4 as uuidv4 } from "uuid";
import pool from "../db.js";
import { validatePayload, schemaVersionHash, RECORD_TYPE_ANTWORT } from "../schemas.js";
import { computePayloadHash } from "../crypto.js";
import { logEvent } from "../logger.js";
import { getFullRecord, createSnapshot, insertRecord, setCurrentSnapshot } from "../recordCore.js";
import { promoteWorkingLinkToHardLink } from "../caseSync.js";

const router = express.Router();
const NAMESPACE_ANTWORTMANAGEMENT = "b7d4c810";

// ---------- Interne Liste (zeigt auch Drafts) ----------
/**
 * @openapi
 * /api/records:
 *   get:
 *     tags: [Records]
 *     summary: Alle Antwort-Records auflisten (inkl. Drafts)
 *     responses:
 *       200:
 *         description: Liste aller Antwort-Records
 */
router.get("/", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.did, r.record_type, r.owner, r.created AS record_created, s.*
    FROM records r JOIN record_snapshots s ON s.id = r.current_snapshot_id
    ORDER BY r.created DESC
  `);
  res.json(rows);
});

// ---------- Draft anlegen ----------
/**
 * @openapi
 * /api/records:
 *   post:
 *     tags: [Records]
 *     summary: Antwort-Draft anlegen
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               recordType:
 *                 type: string
 *                 example: "did:rwp:b7d4c810:schema:fragestunde-antwort"
 *               owner:
 *                 type: string
 *                 example: "did:rwp:b7d4c810:users/sandra-huber"
 *               payload:
 *                 type: object
 *                 properties:
 *                   antworttext:
 *                     type: string
 *                   bundesrat_did:
 *                     type: string
 *                   beantwortet_am:
 *                     type: string
 *     responses:
 *       201:
 *         description: >
 *           Draft erstellt. Hinweis: dieser Low-Level-Endpunkt legt nur die
 *           Antwort an, ohne Case-Verlinkung zu einer Frage. Fuer den
 *           regulaeren Ablauf (Antwort + Case + Verlinkung in einem Zug)
 *           siehe POST /api/cases.
 *       400:
 *         description: Unbekannter recordType
 *       422:
 *         description: Payload ungültig
 */
router.post("/", async (req, res) => {
  const { recordType, owner, payload } = req.body;
  if (recordType !== RECORD_TYPE_ANTWORT) {
    return res.status(400).json({ error: "Unbekannter recordType" });
  }

  const { valid, errors } = validatePayload(recordType, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  const did = `did:rwp:${NAMESPACE_ANTWORTMANAGEMENT}:records:${uuidv4()}`;

  const snapshot = await createSnapshot({
    did, parents: [], state: "draft",
    recordType, schemaVersion: schemaVersionHash(), owner,
    payload, payloadFormat: "application/json"
  });

  await insertRecord({ did, recordType, schemaVersion: snapshot.schema_version, owner, snapshotId: snapshot.id });

  res.status(201).json(await getFullRecord(did));
});

// ---------- Draft bearbeiten (in-place, kein neuer Knoten) ----------
/**
 * @openapi
 * /api/records/{did}:
 *   put:
 *     tags: [Records]
 *     summary: Antwort-Draft bearbeiten (in-place, kein neuer Snapshot-Knoten)
 *     description: Nur möglich, solange der Record den Status "draft" hat. Aktualisiert den bestehenden Snapshot direkt, ohne neuen Versionsknoten zu erzeugen.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *         example: "did:rwp:b7d4c810:records:56a2d6a6-cb2e-41b3-bee3-f443289d977f"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payload:
 *                 type: object
 *                 properties:
 *                   antworttext:
 *                     type: string
 *                   bundesrat_did:
 *                     type: string
 *                   beantwortet_am:
 *                     type: string
 *     responses:
 *       200:
 *         description: Draft erfolgreich aktualisiert
 *       404:
 *         description: Record nicht gefunden
 *       409:
 *         description: Nur Drafts können bearbeitet werden
 *       422:
 *         description: Payload ungültig
 */
router.put(/^\/(.+)$/, async (req, res, next) => {
  const did = decodeURIComponent(req.params[0]);
  if (["/finalize", "/new-version"].some(s => did.endsWith(s))) {
    return next();
  }

  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Drafts können bearbeitet werden" });
  }

  const { payload } = req.body;
  const { valid, errors } = validatePayload(record.record_type, payload);
  if (!valid) return res.status(422).json({ error: "Payload ungültig", details: errors });

  await pool.query(
    `UPDATE record_snapshots SET payload=$1, payload_hash=$2 WHERE id=$3`,
    [payload, computePayloadHash(payload), record.id]
  );

  res.json(await getFullRecord(did));
});

// ---------- Finalisieren (JSON) ----------
/**
 * @openapi
 * /api/records/{did}/finalize:
 *   put:
 *     tags: [Records]
 *     summary: Antwort-Draft finalisieren (JSON)
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Record finalisiert
 *       404:
 *         description: Record nicht gefunden
 *       409:
 *         description: Nur Drafts können finalisiert werden
 */
router.put(/^\/(.+)\/finalize$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "draft") {
    return res.status(409).json({ error: "Nur Drafts können finalisiert werden" });
  }

  const finalizedSnapshot = await createSnapshot({
    did, parents: [record.snapshot_hash].filter(Boolean),
    state: "finalized", recordType: record.record_type,
    schemaVersion: record.schema_version, owner: record.owner,
    payload: record.payload, payloadFormat: "application/json"
  });

  await setCurrentSnapshot(did, finalizedSnapshot.id);
  await logEvent(`Antwort finalisiert: ${did} (Hash: ${finalizedSnapshot.snapshot_hash})`);

  // Falls diese Antwort ueber einen Case per workingLink (RWP 8.4, Soft Link)
  // referenziert ist: Soft Link durch Hard Link in `result` ersetzen und die
  // Case-Merkle-Root neu berechnen. Der Case selbst bleibt Draft -- das
  // Case-Finalisieren ist ein separater Schritt (siehe routes/cases.js).
  const promoted = await promoteWorkingLinkToHardLink(did, finalizedSnapshot.snapshot_hash);
  if (promoted) {
    await logEvent(`Case aktualisiert: ${promoted.caseDid} (Antwort ${did} von workingLinks nach result verschoben)`);
  }

  res.json(await getFullRecord(did));
});

// ---------- Neue Version starten (nur ab finalisiertem Snapshot) ----------
/**
 * @openapi
 * /api/records/{did}/new-version:
 *   post:
 *     tags: [Records]
 *     summary: Neue Version einer finalisierten Antwort starten
 *     description: Nur möglich ab Status "finalized". Erzeugt einen neuen Draft-Snapshot mit Parent-Referenz auf den vorherigen finalisierten Snapshot. Optional mit Korrekturbegründung.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               correctionReason:
 *                 type: string
 *                 example: "Tippfehler korrigiert"
 *     responses:
 *       201:
 *         description: Neuer Draft-Snapshot erstellt
 *       404:
 *         description: Record nicht gefunden
 *       409:
 *         description: Neue Version nur ab finalisiertem Record möglich
 */
router.post(/^\/(.+)\/new-version$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });
  if (record.state !== "finalized") {
    return res.status(409).json({ error: "Neue Version nur ab finalisiertem Record möglich" });
  }

  const { correctionReason } = req.body;

  const draftSnapshot = await createSnapshot({
    did, parents: [record.snapshot_hash],
    state: "draft", recordType: record.record_type,
    schemaVersion: record.schema_version, owner: record.owner,
    payload: record.payload, payloadFormat: "application/json",
    correctionReason: correctionReason || null
  });

  await setCurrentSnapshot(did, draftSnapshot.id);
  res.status(201).json(await getFullRecord(did));
});

// ---------- Vollständige Historie eines Records ----------
/**
 * @openapi
 * /api/records/{did}/history:
 *   get:
 *     tags: [Records]
 *     summary: Vollständige Snapshot-Historie einer Antwort abrufen
 *     description: Liefert den kompletten Version-Graph (alle Snapshots) eines Records, chronologisch aufsteigend sortiert.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Liste aller Snapshots
 */
router.get(/^\/(.+)\/history$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const { rows } = await pool.query(
    `SELECT * FROM record_snapshots WHERE did=$1 ORDER BY created ASC`,
    [did]
  );
  res.json(rows);
});

// ---------- Extern lesbar — NUR finalisierte Records ----------
// Muss NACH allen spezifischen Routen stehen (Pfad-Überlappung)
/**
 * @openapi
 * /api/records/{did}:
 *   get:
 *     tags: [Records]
 *     summary: Einzelne Antwort lesen (nur wenn finalisiert)
 *     description: Extern nur sichtbar, wenn der Record den Status "finalized" hat. Drafts liefern 403, da sie nicht öffentlich lesbar sein sollen.
 *     parameters:
 *       - in: path
 *         name: did
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Vollständiger, finalisierter Record
 *       403:
 *         description: Record ist nicht finalisiert und daher nicht extern sichtbar
 *       404:
 *         description: Record nicht gefunden
 */
router.get(/^\/(.+)$/, async (req, res) => {
  const did = decodeURIComponent(req.params[0]);
  const record = await getFullRecord(did);
  if (!record) return res.status(404).json({ error: "Not found" });

  if (record.state !== "finalized") {
    return res.status(403).json({ error: "Record ist nicht finalisiert und daher nicht extern sichtbar" });
  }
  res.json(record);
});

export default router;
