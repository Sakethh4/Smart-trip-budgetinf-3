/**
 * db.js — flat-file JSON database stored in db.json
 * All reads/writes go through this module.
 */
const fs = require("fs");
const path = require("path");

const DB_FILE = path.join(__dirname, "db.json");

const DEFAULTS = {
  users: [],
  groups: [],
  group_members: [],
  expenses: [],
  expense_splits: [],
  recurring_expenses: [],
  settlements: [],
  budget_alerts_sent: [],
};

function load() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULTS, null, 2));
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

function save(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getTable(table) {
  const data = load();
  return data[table] || [];
}

function setTable(table, rows) {
  const data = load();
  data[table] = rows;
  save(data);
}

module.exports = { getTable, setTable, load, save };
