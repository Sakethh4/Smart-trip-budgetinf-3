/**
 * auth.js — sign-up, sign-in, sign-out, /me
 * POST /auth/signup   { email, password, display_name? }
 * POST /auth/signin   { email, password }
 * POST /auth/signout  (requires token)
 * GET  /auth/me       (requires token)
 */
const { getTable, setTable } = require("./db");
const {
  uuid, now, signToken, verifyToken,
  hashPassword, checkPassword,
  parseBody, send, getBearerToken,
} = require("./utils");

// 7-day expiry
const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;

async function handleAuth(req, res, parts) {
  const action = parts[1]; // signup | signin | signout | me

  if (req.method === "POST" && action === "signup") {
    const body = await parseBody(req);
    const { email, password, display_name } = body;
    if (!email || !password) return send(res, 400, { error: "email and password required" });

    const users = getTable("users");
    if (users.find((u) => u.email === email)) return send(res, 409, { error: "Email already registered" });

    const user = {
      id: uuid(),
      email,
      display_name: display_name || email.split("@")[0],
      password_hash: hashPassword(password),
      created_at: now(),
    };
    setTable("users", [...users, user]);

    const token = signToken({ sub: user.id, email: user.email, exp: Date.now() + TOKEN_TTL });
    const { password_hash, ...safeUser } = user;
    return send(res, 201, { user: safeUser, token });
  }

  if (req.method === "POST" && action === "signin") {
    const body = await parseBody(req);
    const { email, password } = body;
    if (!email || !password) return send(res, 400, { error: "email and password required" });

    const users = getTable("users");
    const user = users.find((u) => u.email === email);
    if (!user || !checkPassword(password, user.password_hash))
      return send(res, 401, { error: "Invalid email or password" });

    const token = signToken({ sub: user.id, email: user.email, exp: Date.now() + TOKEN_TTL });
    const { password_hash, ...safeUser } = user;
    return send(res, 200, { user: safeUser, token });
  }

  if (req.method === "POST" && action === "signout") {
    // Stateless — client just discards the token
    return send(res, 200, { ok: true });
  }

  if (req.method === "GET" && action === "me") {
    const token = getBearerToken(req);
    if (!token) return send(res, 401, { error: "Not authenticated" });
    const payload = verifyToken(token);
    if (!payload) return send(res, 401, { error: "Invalid or expired token" });

    const users = getTable("users");
    const user = users.find((u) => u.id === payload.sub);
    if (!user) return send(res, 404, { error: "User not found" });

    const { password_hash, ...safeUser } = user;
    return send(res, 200, { user: safeUser });
  }

  return send(res, 404, { error: "Not found" });
}

// Middleware: extract user from token, attach to req.user
function requireAuth(req, res) {
  const token = getBearerToken(req);
  if (!token) { send(res, 401, { error: "Not authenticated" }); return null; }
  const payload = verifyToken(token);
  if (!payload) { send(res, 401, { error: "Invalid or expired token" }); return null; }
  const users = getTable("users");
  const user = users.find((u) => u.id === payload.sub);
  if (!user) { send(res, 401, { error: "User not found" }); return null; }
  return user;
}

module.exports = { handleAuth, requireAuth };
