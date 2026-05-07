/**
 * /api/auth  →  POST /api/auth?action=signup|signin|signout
 *               GET  /api/auth?action=me
 */
const { getTable, setTable } = require("./_db");
const { uuid, now, signToken, hashPassword, checkPassword, getBearerToken, verifyToken, ok, err } = require("./_utils");

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});

  const action = event.queryStringParameters?.action || event.path.split("/").pop();
  const body = event.body ? JSON.parse(event.body) : {};

  // POST signup
  if (event.httpMethod === "POST" && action === "signup") {
    const { email, password, display_name } = body;
    if (!email || !password) return err(400, { error: "email and password required" });
    const users = getTable("users");
    if (users.find((u) => u.email === email)) return err(409, { error: "Email already registered" });
    const user = { id: uuid(), email, display_name: display_name || email.split("@")[0], password_hash: hashPassword(password), created_at: now() };
    setTable("users", [...users, user]);
    const token = signToken({ sub: user.id, email: user.email, exp: Date.now() + TOKEN_TTL });
    const { password_hash, ...safeUser } = user;
    return ok({ user: safeUser, token }, 201);
  }

  // POST signin
  if (event.httpMethod === "POST" && action === "signin") {
    const { email, password } = body;
    if (!email || !password) return err(400, { error: "email and password required" });
    const users = getTable("users");
    const user = users.find((u) => u.email === email);
    if (!user || !checkPassword(password, user.password_hash)) return err(401, { error: "Invalid email or password" });
    const token = signToken({ sub: user.id, email: user.email, exp: Date.now() + TOKEN_TTL });
    const { password_hash, ...safeUser } = user;
    return ok({ user: safeUser, token });
  }

  // POST signout
  if (event.httpMethod === "POST" && action === "signout") return ok({ ok: true });

  // GET me
  if (event.httpMethod === "GET" && action === "me") {
    const token = getBearerToken(event.headers);
    if (!token) return err(401, { error: "Not authenticated" });
    const payload = verifyToken(token);
    if (!payload) return err(401, { error: "Invalid or expired token" });
    const user = getTable("users").find((u) => u.id === payload.sub);
    if (!user) return err(404, { error: "User not found" });
    const { password_hash, ...safeUser } = user;
    return ok({ user: safeUser });
  }

  return err(404, { error: "Not found" });
};
