/**
 * server.js — main entry point
 * Pure Node.js HTTP server, no external dependencies.
 *
 * Routes:
 *   /auth/*          → auth.js
 *   /groups/*        → groups.js
 *   /expenses/*      → expenses.js
 *   /recurring/*     → recurring.js
 *   /settlements/*   → settlements.js
 *   /health          → { ok: true }
 */
const http = require("http");
const { send } = require("./utils");
const { handleAuth } = require("./auth");
const { handleGroups } = require("./groups");
const { handleExpenses } = require("./expenses");
const { handleRecurring, processDueRecurring } = require("./recurring");
const { handleSettlements } = require("./settlements");

const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    });
    return res.end();
  }

  // Parse path — strip query string
  const rawPath = req.url.split("?")[0].replace(/\/+$/, "") || "/";
  const parts = rawPath.split("/").filter(Boolean); // e.g. ["groups", "abc123", "members"]
  const resource = parts[0];

  try {
    if (resource === "health") {
      return send(res, 200, { ok: true, time: new Date().toISOString() });
    }
    if (resource === "auth") return await handleAuth(req, res, parts);
    if (resource === "groups") return await handleGroups(req, res, parts);
    if (resource === "expenses") return await handleExpenses(req, res, parts);
    if (resource === "recurring") return await handleRecurring(req, res, parts);
    if (resource === "settlements") return await handleSettlements(req, res, parts);

    return send(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[server error]", err);
    return send(res, 500, { error: "Internal server error", detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`\n✅ Backend running at http://localhost:${PORT}`);
  console.log("   Routes:");
  console.log("   POST   /auth/signup");
  console.log("   POST   /auth/signin");
  console.log("   GET    /auth/me");
  console.log("   GET    /groups");
  console.log("   POST   /groups");
  console.log("   PATCH  /groups/:id");
  console.log("   DELETE /groups/:id");
  console.log("   POST   /groups/join");
  console.log("   GET    /groups/:id/members");
  console.log("   POST   /groups/:id/members");
  console.log("   GET    /expenses?group_id=...");
  console.log("   POST   /expenses");
  console.log("   DELETE /expenses/:id");
  console.log("   GET    /recurring?group_id=...");
  console.log("   POST   /recurring");
  console.log("   PATCH  /recurring/:id");
  console.log("   DELETE /recurring/:id");
  console.log("   POST   /recurring/process");
  console.log("   GET    /settlements?group_id=...");
  console.log("   POST   /settlements");
  console.log("   DELETE /settlements/:id\n");
});

// Process recurring expenses every hour
setInterval(() => {
  const count = processDueRecurring();
  if (count > 0) console.log(`[cron] Processed ${count} recurring expense(s)`);
}, 60 * 60 * 1000);

// Also run once on startup
setTimeout(() => {
  const count = processDueRecurring();
  if (count > 0) console.log(`[startup] Processed ${count} recurring expense(s)`);
}, 2000);
