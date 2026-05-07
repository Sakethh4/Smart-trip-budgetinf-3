/**
 * /api/settlements
 * GET    /api/settlements?group_id=...
 * POST   /api/settlements
 * DELETE /api/settlements?id=...
 */
const { getTable, setTable } = require("./_db");
const { uuid, now, requireAuth, ok, err } = require("./_utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});

  const reply = (status, data) => err(status, data);
  const { user, error } = requireAuth(event.headers, reply);
  if (error) return error;

  const q = event.queryStringParameters || {};
  const settlementId = q.id;
  const groupId = q.group_id;
  const body = event.body ? JSON.parse(event.body) : {};
  const method = event.httpMethod;

  function assertMember(gid) {
    const group = getTable("groups").find((g) => g.id === gid);
    if (!group) return err(404, { error: "Group not found" });
    const isMember = getTable("group_members").find((m) => m.group_id === gid && m.user_id === user.id);
    if (!isMember && group.created_by !== user.id) return err(403, { error: "Not a member" });
    return null;
  }

  if (method === "GET") {
    if (!groupId) return err(400, { error: "group_id required" });
    const denied = assertMember(groupId);
    if (denied) return denied;
    return ok(getTable("settlements").filter((s) => s.group_id === groupId).sort((a, b) => b.settled_at.localeCompare(a.settled_at)));
  }

  if (method === "POST") {
    const { group_id, from_member_id, to_member_id, amount } = body;
    if (!group_id) return err(400, { error: "group_id required" });
    if (!from_member_id) return err(400, { error: "from_member_id required" });
    if (!to_member_id) return err(400, { error: "to_member_id required" });
    if (!amount || amount <= 0) return err(400, { error: "amount must be > 0" });
    const denied = assertMember(group_id);
    if (denied) return denied;
    const settlement = { id: uuid(), group_id, from_member_id, to_member_id, amount: Number(amount), note: body.note || null, settled_at: now(), created_by: user.id };
    setTable("settlements", [...getTable("settlements"), settlement]);
    return ok(settlement, 201);
  }

  if (method === "DELETE" && settlementId) {
    const rows = getTable("settlements");
    const row = rows.find((s) => s.id === settlementId);
    if (!row) return err(404, { error: "Not found" });
    const denied = assertMember(row.group_id);
    if (denied) return denied;
    setTable("settlements", rows.filter((s) => s.id !== settlementId));
    return ok({ ok: true });
  }

  return err(405, { error: "Method not allowed" });
};
