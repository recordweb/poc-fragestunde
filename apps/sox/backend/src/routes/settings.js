const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const SETTING_KEYS = new Set([
  "miniChatEndpoint",
  "teamsChatEndpoint"
]);

function mapSettings(rows) {
  const settings = {
    miniChatEndpoint: "",
    teamsChatEndpoint: ""
  };

  rows.forEach((row) => {
    settings[row.setting_key] = row.setting_value;
  });

  return settings;
}

router.get("/", async (_req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT setting_key, setting_value
      FROM sox_settings
      ORDER BY setting_key
    `);

    res.json(mapSettings(result.rows));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req, res, next) => {
  try {
    const settings = req.body || {};

    for (const key of Object.keys(settings)) {
      if (!SETTING_KEYS.has(key)) {
        return res.status(400).json({
          error: `Unknown setting: ${key}`
        });
      }

      if (typeof settings[key] !== "string") {
        return res.status(400).json({
          error: `${key} must be a string`
        });
      }

      const value = settings[key].trim();

      if (value) {
        try {
          new URL(value);
        } catch {
          return res.status(400).json({
            error: `${key} must be an absolute URL`
          });
        }
      }
    }

    for (const key of SETTING_KEYS) {
      if (!(key in settings)) continue;

      await pool.query(
        `
        INSERT INTO sox_settings (setting_key, setting_value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (setting_key)
        DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          updated_at = NOW()
        `,
        [key, settings[key].trim()]
      );
    }

    const result = await pool.query(`
      SELECT setting_key, setting_value
      FROM sox_settings
      ORDER BY setting_key
    `);

    res.json(mapSettings(result.rows));
  } catch (error) {
    next(error);
  }
});

module.exports = router;