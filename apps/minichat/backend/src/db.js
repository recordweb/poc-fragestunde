const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "minichat",
  user: process.env.POSTGRES_USER || "minichat",
  password: process.env.POSTGRES_PASSWORD
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS minichat_conversations (
      conversation_id CHAR(3) PRIMARY KEY,
      sox_record_did TEXT NOT NULL UNIQUE,
      sox_submission_endpoint TEXT NOT NULL,
      title TEXT NOT NULL,
      case_reference JSONB NOT NULL,
      messages JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_submitted_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS minichat_conversations_updated_at_idx
    ON minichat_conversations (updated_at DESC)
  `);
}

module.exports = {
  pool,
  initializeDatabase
};