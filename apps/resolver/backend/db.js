const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'resolver.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS persons (
    did TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    kuerzel TEXT,
    created TEXT NOT NULL,
    updated TEXT NOT NULL,
    didDocument TEXT NOT NULL
  );
`);

module.exports = db;
