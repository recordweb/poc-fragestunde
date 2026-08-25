const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "ais-db",
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || "ais_db",
  user: process.env.POSTGRES_USER || "poc_user",
  password: process.env.POSTGRES_PASSWORD
});

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ais_aips (
      aip_id TEXT PRIMARY KEY,
      record_id TEXT NOT NULL UNIQUE,
      record_did TEXT NOT NULL UNIQUE,
      sip_package_hash TEXT NOT NULL UNIQUE,
      sip_profile TEXT NOT NULL,
      sip_profile_version TEXT NOT NULL,
      sip_created_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL,
      preservation_metadata JSONB NOT NULL,
      manifest JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ais_aips_accepted_at_idx
    ON ais_aips (accepted_at DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ais_records (
      id TEXT PRIMARY KEY,
      did TEXT NOT NULL UNIQUE,
      record_type TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      payload_metadata JSONB NOT NULL,
      primary_data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL,
      aip_id TEXT NOT NULL UNIQUE
        REFERENCES ais_aips(aip_id)
        ON DELETE RESTRICT
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ais_records_created_at_idx
    ON ais_records (created_at DESC)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ais_records_record_type_idx
    ON ais_records (record_type)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ais_record_snapshots (
      snapshot_hash TEXT PRIMARY KEY,
      record_id TEXT NOT NULL
        REFERENCES ais_records(id)
        ON DELETE RESTRICT,
      did TEXT NOT NULL,
      version INTEGER NOT NULL,
      state TEXT NOT NULL,
      parents JSONB NOT NULL,
      payload JSONB NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_format TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      finalized_at TIMESTAMPTZ NOT NULL,
      UNIQUE (record_id, version)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ais_record_snapshots_record_id_idx
    ON ais_record_snapshots (record_id, version DESC)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ais_submission_receipts (
      receipt_id TEXT PRIMARY KEY,
      aip_id TEXT NOT NULL UNIQUE
        REFERENCES ais_aips(aip_id)
        ON DELETE RESTRICT,
      receipt JSONB NOT NULL,
      receipt_hash TEXT NOT NULL UNIQUE,
      received_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ais_deletion_records (
      deletion_record_did TEXT PRIMARY KEY,
      target_record_did TEXT NOT NULL UNIQUE
        REFERENCES ais_records(did)
        ON DELETE RESTRICT,
      target_snapshot_hash TEXT NOT NULL,
      deletion_record JSONB NOT NULL,
      submitted_at TIMESTAMPTZ NOT NULL,
      deletion_performed_at TIMESTAMPTZ NOT NULL,
      deletion_record_snapshot_hash TEXT UNIQUE
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS ais_deletion_records_submitted_at_idx
    ON ais_deletion_records (submitted_at DESC)
  `);
}

module.exports = {
  pool,
  initializeDatabase
};