const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "sox",
  user: process.env.POSTGRES_USER || "sox",
  password: process.env.POSTGRES_PASSWORD
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sox_records (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL UNIQUE,
      record_type TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS sox_records_created_at_idx
    ON sox_records (created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS sox_records_record_type_idx
    ON sox_records (record_type)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sox_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    `);

    await pool.query(`
    INSERT INTO sox_settings (setting_key, setting_value)
    VALUES
      ('miniChatEndpoint', ''),
      ('teamsChatEndpoint', '')
    ON CONFLICT (setting_key) DO NOTHING
    `);
}

module.exports = {
  pool,
  initializeDatabase
};