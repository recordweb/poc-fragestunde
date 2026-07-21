import pool from "./db.js";

export async function logEvent(message, level = "info") {
  console.log(`[${level.toUpperCase()}] ${message}`);
  try {
    await pool.query(
      `INSERT INTO server_logs (level, message) VALUES ($1, $2)`,
      [level, message]
    );
  } catch (err) {
    console.error("Logging fehlgeschlagen:", err);
  }
}