import pg from "pg";

const pool = new pg.Pool({
  host: process.env.PGHOST || "db",
  user: process.env.PGUSER || "poc_user",
  password: process.env.PGPASSWORD || "poc_recordweb",
  database: process.env.PGDATABASE || "poc_db",
  port: 5432
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS records (
      did              TEXT PRIMARY KEY,
      snapshot_hash     TEXT,
      record_type       TEXT NOT NULL,
      schema_version     TEXT NOT NULL,
      state             TEXT NOT NULL DEFAULT 'draft',
      created           TIMESTAMPTZ NOT NULL DEFAULT now(),
      finalized         TIMESTAMPTZ,
      owner             TEXT NOT NULL,
      parents           JSONB NOT NULL DEFAULT '[]',
      payload_hash       TEXT,
      payload_format     TEXT NOT NULL DEFAULT 'application/json',
      signature         TEXT,
      payload           JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ldn_notifications (
      id                TEXT PRIMARY KEY,
      record_did        TEXT NOT NULL,
      target            TEXT NOT NULL,
      published         TIMESTAMPTZ NOT NULL DEFAULT now(),
      payload           JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS solid_links (
      id                TEXT PRIMARY KEY,
      record_did        TEXT NOT NULL,
      snapshot_hash     TEXT NOT NULL,
      pod_url           TEXT NOT NULL,
      linked_by         TEXT NOT NULL,
      linked_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS server_logs (
      id         SERIAL PRIMARY KEY,
      level      TEXT NOT NULL DEFAULT 'info',
      message    TEXT NOT NULL,
      created    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS record_snapshots (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      did                   TEXT NOT NULL,
      snapshot_hash         TEXT NOT NULL,
      parents               JSONB NOT NULL DEFAULT '[]',
      state                 TEXT NOT NULL CHECK (state IN ('draft','finalized')),
      record_type           TEXT NOT NULL,
      schema_version        TEXT NOT NULL,
      owner                 TEXT NOT NULL,
      payload               JSONB NOT NULL,
      payload_hash          TEXT NOT NULL,
      payload_format        TEXT NOT NULL,
      payload_representations JSONB,
      correction_reason     TEXT,
      created               TIMESTAMPTZ NOT NULL DEFAULT now(),
      finalized             TIMESTAMPTZ,
      signature             TEXT
    );

    CREATE INDEX idx_snapshots_did ON record_snapshots(did);

    ALTER TABLE records ADD COLUMN current_snapshot_id UUID REFERENCES record_snapshots(id);
  `);
}

export default pool;