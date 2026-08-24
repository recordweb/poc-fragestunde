import pool from "./db.js";

export async function persistFinalizedConformanceRecord(record, assessment, userDid) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const snapshot = record.metadata;

    const snapshotResult = await client.query(
      `
      INSERT INTO record_snapshots (
        did,
        snapshot_hash,
        parents,
        state,
        record_type,
        schema_version,
        owner,
        payload,
        payload_hash,
        payload_format,
        created,
        finalized,
        signature
      )
      VALUES (
        $1, $2, $3::jsonb, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13
      )
      RETURNING id
      `,
      [
        record.did,
        snapshot.snapshotHash,
        JSON.stringify(snapshot.parents),
        snapshot.state,
        snapshot.recordType,
        snapshot.schemaVersion,
        snapshot.owner,
        JSON.stringify(record.payload),
        snapshot.payloadHash,
        snapshot.payloadFormat,
        snapshot.created,
        snapshot.finalized,
        snapshot.signature
      ]
    );

    const snapshotId = snapshotResult.rows[0].id;

    await client.query(
      `
      INSERT INTO records (
        did,
        record_type,
        schema_version,
        created,
        owner,
        current_snapshot_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        record.did,
        snapshot.recordType,
        snapshot.schemaVersion,
        snapshot.created,
        userDid,
        snapshotId
      ]
    );

    await client.query(
      `
      UPDATE assessments
      SET
        status = 'finalized',
        updated = now(),
        finalized_at = $2,
        finalized_by = $3,
        conformance_record_did = $4
      WHERE id = $1
        AND status = 'draft'
      `,
      [
        assessment.id,
        snapshot.finalized,
        userDid,
        record.did
      ]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}