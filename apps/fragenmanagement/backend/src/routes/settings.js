import express from "express";
import { getConfiguredInboxUrl, setConfiguredInboxUrl } from "../settingsStore.js";

const router = express.Router();

/**
 * @openapi
 * /api/settings/ldn-inbox-url:
 *   get:
 *     tags: [Settings]
 *     summary: Aktuell konfigurierte LDN-Inbox-Zustelladresse abfragen
 *     responses:
 *       200:
 *         description: Aktueller Wert
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 value: { type: string, example: "http://antwort-api:3000/antwortmanagement/api/inbox" }
 */
router.get("/ldn-inbox-url", async (req, res) => {
  res.json({ value: await getConfiguredInboxUrl() });
});

/**
 * @openapi
 * /api/settings/ldn-inbox-url:
 *   put:
 *     tags: [Settings]
 *     summary: LDN-Inbox-Zustelladresse setzen
 *     description: |
 *       Bewusst ohne Authentifizierung, wie alle anderen Routen in diesem PoC.
 *       Erlaubt es, im Demonstrator gezielt eine falsche Adresse einzutragen und
 *       das resultierende Fehlerverhalten (Etappe 4: Retry/Dead-Letter) zu zeigen.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [value]
 *             properties:
 *               value: { type: string }
 *     responses:
 *       200:
 *         description: Gespeicherter Wert
 *       400:
 *         description: Ungültiger Wert
 */
router.put("/ldn-inbox-url", async (req, res) => {
  const { value } = req.body || {};
  if (typeof value !== "string" || value.trim().length === 0) {
    return res.status(400).json({ error: "value (nicht-leerer String) erforderlich" });
  }
  const saved = await setConfiguredInboxUrl(value.trim());
  res.json({ value: saved });
});

export default router;
