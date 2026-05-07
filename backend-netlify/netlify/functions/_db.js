/**
 * _db.js — flat-file JSON database stored in /tmp/db.json
 * NOTE: Netlify functions are stateless — /tmp persists only within a single
 * warm instance. For production persistence use a real DB (PlanetScale, Supabase, etc.)
 * This is a drop-in demo backend.
 */
const fs = require("fs");
const DB_FILE = "/tmp/eedb.json";

const DEFAULTS = {
  users: [], groups: [], group_members: [],
  expenses: [], expense_splits: [],
  recurring_expenses: [], settlements: [],
  budget_alerts_sent: [],
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULTS, null, 2));
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return JSON.parse(JSON.stringify(DEFAULTS)); }
}

function save(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); }
function getTable(t) { return load()[t] || []; }
function setTable(t, rows) { const d = load(); d[t] = rows; save(d); }

module.exports = { getTable, setTable };
