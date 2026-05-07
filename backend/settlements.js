/**
 * settlements.js
 *
 * GET    /settlements?group_id=...
 * POST   /settlements   { group_id, from_member_id, to_member_id, amount, note? }
 * DELETE /settlements/:id
 */
const { getTable, setTable } = require("./db");
const { requireAuth } = require("./auth");
const { uuid, now, parseBody, send } = require("./utils");

function assertMember(groupId, userId, res) {
  const members = getTable("group_members");
  const groups = getTable("groups");
  const group = groups.find((g) => g.id === groupId);
  if (!group) { send(res, 404, { error: "Group not found" }); return false; }
  const isMember = members.find((m) => m.group_id === groupId && m.user_id === userId);
  if (!isMember && group.created_by !== userId) {
    send(res, 403, { error: "Not a member of this group" }); return false;
  }
  return true;
}

async function handleSettlements(req, res, parts) {
  const user = requireAuth(req, res);
  if (!user) return;

  const settlementId = parts[1];

  // GET /settlements?group_id=...
  if (req.method === "GET" && !settlementId) {
    const url = new URL(req.url, "http://localhost");
    const groupId = url.searchParams.get("group_id");
    if (!groupId) return send(res, 400, { error: "group_id query param required" });
    if (!assertMember(groupId, user.id, res)) return;
    const rows = getTable("settlements")
      .filter((s) => s.group_id === groupId)
      .sort((a, b) => b.settled_at.localeCompare(a.settled_at));
    return send(res, 200, rows);
  }

  // POST /settlements
  if (req.method === "POST" && !settlementId) {
    const body = await parseBody(req);
    const { group_id, from_member_id, to_member_id, amount } = body;
    if (!group_id) return send(res, 400, { error: "group_id required" });
    if (!from_member_id) return send(res, 400, { error: "from_member_id required" });
    if (!to_member_id) return send(res, 400, { error: "to_member_id required" });
    if (!amount || amount <= 0) return send(res, 400, { error: "amount must be > 0" });
    if (!assertMember(group_id, user.id, res)) return;

    const settlement = {
      id: uuid(),
      group_id,
      from_member_id,
      to_member_id,
      amount: Number(amount),
      note: body.note || null,
      settled_at: now(),
      created_by: user.id,
    };
    setTable("settlements", [...getTable("settlements"), settlement]);
    return send(res, 201, settlement);
  }

  // DELETE /settlements/:id
  if (req.method === "DELETE" && settlementId) {
    const rows = getTable("settlements");
    const row = rows.find((s) => s.id === settlementId);
    if (!row) return send(res, 404, { error: "Settlement not found" });
    if (!assertMember(row.group_id, user.id, res)) return;
    setTable("settlements", rows.filter((s) => s.id !== settlementId));
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "Method not allowed" });
}

module.exports = { handleSettlements };
