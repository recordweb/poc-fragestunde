const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "db",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "poc_db",
  user: process.env.POSTGRES_USER || "poc_user",
  password: process.env.POSTGRES_PASSWORD
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eol_migrations (
      migration_id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL UNIQUE,
      record_did TEXT NOT NULL UNIQUE,
      current_snapshot_hash TEXT NOT NULL,
      state TEXT NOT NULL,
      sip JSONB,
      sip_package_hash TEXT,
      sip_created_at TIMESTAMPTZ,
      aip_id TEXT,
      ais_record_endpoint TEXT,
      ais_receipt JSONB,
      ais_receipt_hash TEXT,
      ais_accepted_at TIMESTAMPTZ,
      resolver_verified_at TIMESTAMPTZ,
      resolver_record_endpoint TEXT,
      resolver_current_snapshot_hash TEXT,
      deletion_record_did TEXT,
      deletion_record_snapshot_hash TEXT,
      deletion_record JSONB,
      source_deleted_at TIMESTAMPTZ,
      deletion_record_accepted_at TIMESTAMPTZ,
      error_code TEXT,
      error_message TEXT,
      error_occurred_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS eol_migrations_state_idx
    ON eol_migrations (state)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS eol_migrations_updated_at_idx
    ON eol_migrations (updated_at DESC)
  `);
}

module.exports = {
  pool,
  initializeDatabase
};