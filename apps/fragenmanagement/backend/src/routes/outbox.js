import express from "express";
import pool from "../db.js";
import { attemptDelivery, MAX_ATTEMPTS } from "../outbox.js";

const router = express.Router();

/**
 * @openapi
 * /api/outbox:
 *   get:
 *     tags: [Outbox]
 *     summary: LDN-Zustellversuche auflisten (Status, Anzahl Versuche, letzter Fehler)
 *     description: |
 *       Analog zu /api/logs — zeigt für jede Notification den aktuellen
 *       Zustellstatus (pending/failed/delivered/dead_letter), die Anzahl
 *       bisheriger Versuche, den letzten Fehler und den nächsten geplanten
 *       automatischen Retry-Zeitpunkt.
 *     responses:
 *       200:
 *         description: Liste, neueste zuerst
 */
router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, record_did, target, target_url, status, attempts, delivery_error,
            next_attempt_at, published
     FROM ldn_notifications
     ORDER BY published DESC
     LIMIT 100`
  );
  res.json(rows.map(r => ({ ...r, max_attempts: MAX_ATTEMPTS })));
});

/**
 * @openapi
 * /api/outbox/{id}/retry:
 *   post:
 *     tags: [Outbox]
 *     summary: Zustellung sofort erneut versuchen (manuell, unabhängig vom Backoff)
 *     description: |
 *       Funktioniert auch für bereits als Dead Letter markierte Notifications —
 *       nützlich, um im PoC zu zeigen, dass eine Korrektur der Zustelladresse
 *       (siehe /api/settings/ldn-inbox-url) eine zuvor fehlgeschlagene
 *       Zustellung sofort erfolgreich nachholen kann.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Aktualisierter Zustellstatus
 *       404:
 *         description: Nicht gefunden
 *       409:
 *         description: Bereits erfolgreich zugestellt
 */
router.post("/:id/retry", async (req, res) => {
  const { rows } = await pool.query(`SELECT status FROM ldn_notifications WHERE id = $1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Notification nicht gefunden" });
  if (rows[0].status === "delivered") return res.status(409).json({ error: "Bereits zugestellt" });
  const updated = await attemptDelivery(req.params.id);
  res.json(updated);
});

export default router;
