import pg from "pg";

const SCHEMA = "bar";

const pool = new pg.Pool({
  host: process.env.PGHOST || "db",
  user: process.env.PGUSER || "poc_user",
  password: process.env.PGPASSWORD || "poc_recordweb",
  database: process.env.PGDATABASE || "poc_db",
  port: 5432,
  options: `-c search_path=${SCHEMA},public`
});

export async function initSchema() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.record_snapshots (
      id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      did                 TEXT NOT NULL,
      snapshot_hash       TEXT NOT NULL UNIQUE,
      parents             JSONB NOT NULL DEFAULT '[]',
      state               TEXT NOT NULL CHECK (state IN ('draft', 'finalized')),
      record_type         TEXT NOT NULL,
      schema_version      TEXT NOT NULL,
      owner               TEXT NOT NULL,
      payload             JSONB NOT NULL,
      payload_hash        TEXT NOT NULL,
      payload_format      TEXT NOT NULL,
      created             TIMESTAMPTZ NOT NULL DEFAULT now(),
      finalized           TIMESTAMPTZ,
      signature           TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_record_snapshots_did
      ON ${SCHEMA}.record_snapshots(did);

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.records (
      did                 TEXT PRIMARY KEY,
      record_type         TEXT NOT NULL,
      schema_version      TEXT NOT NULL,
      created             TIMESTAMPTZ NOT NULL DEFAULT now(),
      owner               TEXT NOT NULL,
      current_snapshot_id UUID REFERENCES ${SCHEMA}.record_snapshots(id)
    );

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.assessments (
      id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      status                     TEXT NOT NULL CHECK (status IN ('draft', 'finalized')),
      implementation_did         TEXT NOT NULL,
      product_name               TEXT NOT NULL,
      product_version            TEXT NOT NULL,
      deployment                 TEXT,
      rwp_version                TEXT NOT NULL,
      claims                     JSONB NOT NULL,
      evidence                   TEXT,
      expires_at                 TIMESTAMPTZ,
      tests                      JSONB NOT NULL DEFAULT '[]',
      created                    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated                    TIMESTAMPTZ NOT NULL DEFAULT now(),
      created_by                 TEXT NOT NULL,
      finalized_at               TIMESTAMPTZ,
      finalized_by               TEXT,
      conformance_record_did     TEXT REFERENCES ${SCHEMA}.records(did)
    );

    CREATE INDEX IF NOT EXISTS idx_assessments_status_updated
      ON ${SCHEMA}.assessments(status, updated DESC);

    CREATE TABLE IF NOT EXISTS ${SCHEMA}.server_logs (
      id                  SERIAL PRIMARY KEY,
      level               TEXT NOT NULL DEFAULT 'info',
      message             TEXT NOT NULL,
      created             TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

export default pool;