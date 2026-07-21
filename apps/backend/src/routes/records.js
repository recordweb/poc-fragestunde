import express from "express";
import pool from "../db.js";

const router = express.Router();

// Liste aller Records (später filterbar nach recordType)
router.get("/", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM records ORDER BY created DESC");
  res.json(rows);
});

export default router;