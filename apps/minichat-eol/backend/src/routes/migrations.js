const express = require("express");

const { pool } = require("../db");
const {
  getSoXRecord,
  getMigration,
  getOrCreateMigration,
  mapMigration,
  ensureMigrationSchema,
  createSipForMigration,
  submitSip,
  verifyResolver,
  deleteSourcePayload,
  submitDeletionRecord
} = require("../migrationService");

const router = express.Router();

function mapCandidate(row, migration) {
  const conversation = row.payload?.conversation;
  const messages = conversation?.messages;

  return {
    id: row.id,
    did: row.did,
    title: row.title,
    version: row.version,
    snapshotHash: row.snapshot_hash || null,
    caseReference: row.payload?.caseReference || null,
    messageCount: Array.isArray(messages) ? messages.length : 0,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at || null,
    migration: migration ? ensureMigrationSchema(migration) : null
  };
}

function sendError(res, error) {
  return res.status(error.status || 500).json({
    error: error.code || "internal-error",
    message: error.message || "Internal server error",
    details: error.details || []
  });
}

/**
 * @openapi
 * /api/candidates:
 *   get:
 *     tags: [Candidates]
 *     summary: Listet finalisierte MiniChat-Records mit vorhandenen Primärdaten
 *     description: |
 *       Kandidaten sind ausschliesslich MiniChat-Records mit Status finalized,
 *       einer finalen Snapshot-Version und einer noch vorhandenen Conversation
 *       mit mindestens einer Message. Bereits gelöschte Quellen erscheinen nicht.
 *     responses:
 *       200:
 *         description: Archivierungsfähige MiniChat-Records
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Candidate'
 */
router.get("/candidates", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT
        r.*,
        latest.snapshot_hash,
        latest.finalized_at,

        m.migration_id,
        m.record_id AS migration_record_id,
        m.record_did,
        m.current_snapshot_hash,
        m.state,
        m.sip,
        m.sip_package_hash,
        m.sip_created_at,
        m.aip_id,
        m.ais_record_endpoint,
        m.ais_receipt,
        m.ais_receipt_hash,
        m.ais_accepted_at,
        m.resolver_verified_at,
        m.resolver_record_endpoint,
        m.resolver_current_snapshot_hash,
        m.deletion_record_did,
        m.deletion_record_snapshot_hash,
        m.deletion_record,
        m.source_deleted_at,
        m.deletion_record_accepted_at,
        m.error_code,
        m.error_message,
        m.error_occurred_at,
        m.created_at AS migration_created_at,
        m.updated_at AS migration_updated_at

      FROM sox_records r

      LEFT JOIN LATERAL (
        SELECT snapshot_hash, finalized_at
        FROM sox_record_snapshots
        WHERE record_id = r.id
        ORDER BY version DESC
        LIMIT 1
      ) latest ON true

      LEFT JOIN eol_migrations m
        ON m.record_id = r.id

      WHERE r.record_type = 'MiniChat'
        AND r.status = 'finalized'
        AND (
          (
            jsonb_typeof(r.payload->'conversation'->'messages') = 'array'
            AND jsonb_array_length(r.payload->'conversation'->'messages') > 0
          )
          OR m.migration_id IS NOT NULL
        )

      ORDER BY
        CASE
          WHEN m.state IN (
            'source-deleted',
            'deletion-record-submitted',
            'deletion-protocol-failed'
          ) THEN 0
          WHEN m.state IS NOT NULL THEN 1
          ELSE 2
        END,
        COALESCE(m.updated_at, r.created_at) DESC
    `);

    return res.json(
      result.rows.map((row) => {
        const migration = row.migration_id
          ? {
              migration_id: row.migration_id,
              record_id: row.migration_record_id,
              record_did: row.record_did,
              current_snapshot_hash: row.current_snapshot_hash,
              state: row.state,
              sip: row.sip,
              sip_package_hash: row.sip_package_hash,
              sip_created_at: row.sip_created_at,
              aip_id: row.aip_id,
              ais_record_endpoint: row.ais_record_endpoint,
              ais_receipt: row.ais_receipt,
              ais_receipt_hash: row.ais_receipt_hash,
              ais_accepted_at: row.ais_accepted_at,
              resolver_verified_at: row.resolver_verified_at,
              resolver_record_endpoint: row.resolver_record_endpoint,
              resolver_current_snapshot_hash:
                row.resolver_current_snapshot_hash,
              deletion_record_did: row.deletion_record_did,
              deletion_record_snapshot_hash:
                row.deletion_record_snapshot_hash,
              deletion_record: row.deletion_record,
              source_deleted_at: row.source_deleted_at,
              deletion_record_accepted_at:
                row.deletion_record_accepted_at,
              error_code: row.error_code,
              error_message: row.error_message,
              error_occurred_at: row.error_occurred_at,
              created_at: row.migration_created_at,
              updated_at: row.migration_updated_at
            }
          : null;

        return mapCandidate(row, migration);
      })
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/migrations:
 *   get:
 *     tags: [Migrations]
 *     summary: Listet alle EOL-Migrationen
 *     responses:
 *       200:
 *         description: Liste aller Migrationssteuerungen
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Migration'
 */
router.get("/migrations", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM eol_migrations
      ORDER BY updated_at DESC
    `);

    return res.json(result.rows.map(ensureMigrationSchema));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/migrations/{recordId}:
 *   get:
 *     tags: [Migrations]
 *     summary: Liefert den Steuerzustand einer EOL-Migration
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Migration gefunden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Migration'
 *       404:
 *         description: Migration nicht vorhanden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiError'
 */
router.get("/migrations/:recordId", async (req, res, next) => {
  try {
    const migration = await getMigration(req.params.recordId);

    if (!migration) {
      return res.status(404).json({
        error: "not-found",
        message: "Migration not found",
        details: []
      });
    }

    return res.json(ensureMigrationSchema(migration));
  } catch (error) {
    next(error);
  }
});

/**
 * @openapi
 * /api/migrations/{recordId}/sip:
 *   post:
 *     tags: [Migrations]
 *     summary: Validiert die SoX-Daten und erzeugt ein persistiertes MiniChat-SIP
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: SIP wurde erzeugt
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Migration'
 *       409:
 *         description: SIP-Erzeugung ist im aktuellen Zustand nicht erlaubt
 *       422:
 *         description: SoX-Record ist kein gültiger Archivierungskandidat
 */
router.post("/migrations/:recordId/sip", async (req, res) => {
  try {
    const migration = await createSipForMigration(req.params.recordId);

    return res.json(migration);
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * @openapi
 * /api/migrations/{recordId}/submit:
 *   post:
 *     tags: [Migrations]
 *     summary: Sendet das erzeugte SIP an AIS
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: AIS hat die SIP akzeptiert
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Migration'
 *       409:
 *         description: SIP wurde noch nicht erzeugt oder Zustand ist ungültig
 *       502:
 *         description: AIS ist nicht erreichbar oder liefert eine ungültige Antwort
 */
router.post("/migrations/:recordId/submit", async (req, res) => {
  try {
    const migration = await submitSip(req.params.recordId);

    return res.json(migration);
  } catch (error) {
    return sendError(res, error);
  }
});

/**
 * @openapi
 * /api/migrations/{recordId}/verify-resolver:
 *   post:
 *     tags: [Migrations]
 *     summary: Prüft nach manuellem Resolverwechsel den AIS-Standort
 *     description: |
 *       Der Resolverwechsel wird nicht durch die EOL-App vorgenommen.
 *       Diese Operation prüft nur, ob die MiniChat-DID zum erwarteten
 *       AIS Record Endpoint und zur erwarteten finalen Snapshot-Version führt.
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resolver und AIS Record wurden erfolgreich geprüft
 *       422:
 *         description: Der Resolver zeigt noch nicht auf AIS oder AIS ist nicht abrufbar
 */
router.post(
  "/migrations/:recordId/verify-resolver",
  async (req, res) => {
    try {
      const migration = await verifyResolver(req.params.recordId);

      return res.json(migration);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

/**
 * @openapi
 * /api/migrations/{recordId}/delete-source-payload:
 *   post:
 *     tags: [Migrations]
 *     summary: Löscht nach bestätigtem Resolverwechsel die Primärdaten im SoX
 *     description: |
 *       Die Operation wird nur bei resolver-confirmed ausgeführt. Sie entfernt
 *       die Conversation-Payload in sox_records und die lokalen Payload-Kopien
 *       in sox_record_snapshots. DID, Metadaten, Hashes und Version-Graph
 *       bleiben erhalten. Gleichzeitig wird ein DeletionRecord erzeugt.
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Primärdaten gelöscht und DeletionRecord erzeugt
 *       409:
 *         description: Resolverwechsel nicht bestätigt oder Quelle bereits bereinigt
 */
router.post(
  "/migrations/:recordId/delete-source-payload",
  async (req, res) => {
    try {
      const migration = await deleteSourcePayload(req.params.recordId);

      return res.json(migration);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

/**
 * @openapi
 * /api/migrations/{recordId}/submit-deletion-record:
 *   post:
 *     tags: [Migrations]
 *     summary: Übermittelt den DeletionRecord als Löschprotokoll an AIS
 *     parameters:
 *       - in: path
 *         name: recordId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Löschprotokoll wurde von AIS bestätigt, Migration ist abgeschlossen
 *       409:
 *         description: Quelllöschung bzw. DeletionRecord-Erzeugung fehlt
 *       502:
 *         description: AIS ist nicht erreichbar
 */
router.post(
  "/migrations/:recordId/submit-deletion-record",
  async (req, res) => {
    try {
      const migration = await submitDeletionRecord(req.params.recordId);

      return res.json(migration);
    } catch (error) {
      return sendError(res, error);
    }
  }
);

module.exports = router;