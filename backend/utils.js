/**
 * utils.js — shared helpers
 */
const crypto = require("crypto");

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

// 6-char join code, no ambiguous chars
function genJoinCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  for (let i = 0; i < 6; i++) r += chars[Math.floor(Math.random() * chars.length)];
  return r;
}

function uniqueJoinCode(groups) {
  let code;
  do { code = genJoinCode(); } while (groups.find((g) => g.join_code === code));
  return code;
}

// Simple JWT-like token using HMAC-SHA256
const SECRET = process.env.JWT_SECRET || "explore-ease-secret-key-change-in-prod";

function signToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  try {
    const [header, body, sig] = token.split(".");
    const expected = crypto.createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// Hash password with SHA-256 + salt (simple, no bcrypt dependency)
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  const attempt = crypto.createHmac("sha256", salt).update(password).digest("hex");
  return attempt === hash;
}

// Parse JSON body from request
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// Send JSON response
function send(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  });
  res.end(JSON.stringify(data));
}

// Extract bearer token from Authorization header
function getBearerToken(req) {
  const auth = req.headers["authorization"] || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// Advance a date by frequency
function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  uuid, now, uniqueJoinCode,
  signToken, verifyToken,
  hashPassword, checkPassword,
  parseBody, send, getBearerToken,
  advanceDate,
};
