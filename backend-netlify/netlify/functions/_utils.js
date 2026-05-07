const crypto = require("crypto");

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

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

const SECRET = process.env.JWT_SECRET || "explore-ease-secret-change-in-prod";

function signToken(payload) {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const b = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  return `${h}.${b}.${s}`;
}
function verifyToken(token) {
  try {
    const [h, b, s] = token.split(".");
    const expected = crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
    if (s !== expected) return null;
    const payload = JSON.parse(Buffer.from(b, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch { return null; }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return crypto.createHmac("sha256", salt).update(password).digest("hex") === hash;
}

function getBearerToken(headers) {
  const auth = headers["authorization"] || headers["Authorization"] || "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

function requireAuth(headers, res) {
  const token = getBearerToken(headers);
  if (!token) return { error: res(401, { error: "Not authenticated" }) };
  const payload = verifyToken(token);
  if (!payload) return { error: res(401, { error: "Invalid or expired token" }) };
  const { getTable } = require("./_db");
  const user = getTable("users").find((u) => u.id === payload.sub);
  if (!user) return { error: res(401, { error: "User not found" }) };
  return { user };
}

function ok(data, status = 200) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    },
    body: JSON.stringify(data),
  };
}

function err(status, data) { return ok(data, status); }

function advanceDate(dateStr, frequency) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (frequency === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (frequency === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (frequency === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  uuid, now, uniqueJoinCode, signToken, verifyToken,
  hashPassword, checkPassword, getBearerToken, requireAuth,
  ok, err, advanceDate,
};
