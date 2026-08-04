import express from "express";
import pool from "../db.js";
import { logEvent } from "../logger.js";

const router = express.Router();
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "https://vps.recordweb.dev";

// ---------- Validierung ----------
// Prüft nur die für LDN/ActivityStreams zwingenden Felder — keine Signatur-
// oder Herkunftsprüfung (Etappe 5), keine Zugriffskontrolle (bewusst offen,
// siehe INTERFACES.md: PoC/Demonstrator).
function validateLdnNotification(body) {
  const errors = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return ["Body fehlt oder ist kein JSON-Objekt"];
  }
  if (!body["@context"]) errors.push("@context fehlt");
  if (!body.id) errors.push("id fehlt");
  if (!body.type) errors.push("type fehlt");
  if (!body.actor) errors.push("actor fehlt");
  if (!body.object || typeof body.object !== "object") {
    errors.push("object fehlt oder ist kein Objekt");
  } else if (!body.object.id) {
    errors.push("object.id fehlt");
  }
  return errors;
}

// ---------- POST /inbox — Notification entgegennehmen ----------
/**
 * @openapi
 * /inbox:
 *   post:
 *     tags: [LDN]
 *     summary: LDN-Notification entgegennehmen (W3C Linked Data Notifications)
 *     description: >
 *       Nimmt ActivityStreams-2.0-Notifications gemäss W3C LDN entgegen.
 *       Validiert nur die Pflichtfelder — keine Authentifizierung im PoC.
 *     requestBody:
 *       required: true
 *       content:
 *         application/ld+json:
 *           schema:
 *             type: object
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       201:
 *         description: Notification gespeichert
 *       400:
 *         description: Notification ungültig
 */
router.post("/", async (req, res) => {
  const body = req.body;
  const errors = validateLdnNotification(body);

  if (errors.length) {
    await logEvent(`LDN-Inbox: ungültige Notification abgelehnt (${errors.join(", ")})`, "warn");
    return res.status(400).json({ error: "Ungültige LDN-Notification", details: errors });
  }

  const { rows } = await pool.query(
    `INSERT INTO ldn_inbox (notification_id, actor, target, object_did, payload)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, received`,
    [body.id, body.actor, body.target || null, body.object.id, body]
  );
  const saved = rows[0];

  await logEvent(`LDN-Inbox: Notification von ${body.actor} für ${body.object.id} empfangen (${saved.id})`);

  res
    .status(201)
    .set("Location", `${PUBLIC_BASE_URL}/antwortmanagement/api/inbox/${saved.id}`)
    .json({ status: "accepted", id: saved.id, received: saved.received });
});

// ---------- GET /inbox — Liste für Admin-GUI ----------
/**
 * @openapi
 * /inbox:
 *   get:
 *     tags: [LDN]
 *     summary: Empfangene LDN-Notifications auflisten
 *     responses:
 *       200:
 *         description: Liste der Notifications (neueste zuerst)
 */
router.get("/", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, notification_id, actor, target, object_did, received, payload
     FROM ldn_inbox ORDER BY received DESC LIMIT 100`
  );
  res.json(rows);
});

// ---------- GET /inbox/:id — Einzelne Notification ----------
/**
 * @openapi
 * /inbox/{id}:
 *   get:
 *     tags: [LDN]
 *     summary: Einzelne empfangene Notification abrufen
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Notification
 *       404:
 *         description: Nicht gefunden
 */
router.get("/:id", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, notification_id, actor, target, object_did, received, payload
     FROM ldn_inbox WHERE id = $1`,
    [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Notification nicht gefunden" });
  res.json(rows[0]);
});

export default router;
