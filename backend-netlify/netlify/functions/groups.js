/**
 * /api/groups
 * GET    /api/groups
 * POST   /api/groups
 * GET    /api/groups?id=:id
 * PATCH  /api/groups?id=:id
 * DELETE /api/groups?id=:id
 * POST   /api/groups?action=join   { code }
 * GET    /api/groups?id=:id&sub=members
 * POST   /api/groups?id=:id&sub=members
 * DELETE /api/groups?id=:id&sub=members&mid=:mid
 */
const { getTable, setTable } = require("./_db");
const { uuid, now, uniqueJoinCode, requireAuth, ok, err } = require("./_utils");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});

  const reply = (status, data) => err(status, data);
  const { user, error } = requireAuth(event.headers, reply);
  if (error) return error;

  const q = event.queryStringParameters || {};
  const groupId = q.id;
  const sub = q.sub;       // "members"
  const subId = q.mid;
  const action = q.action; // "join"
  const body = event.body ? JSON.parse(event.body) : {};
  const method = event.httpMethod;

  // ── JOIN ──────────────────────────────────────────────────────────────────
  if (method === "POST" && action === "join") {
    const code = (body.code || "").trim().toUpperCase();
    if (!code) return err(400, { error: "code required" });
    const groups = getTable("groups");
    const group = groups.find((g) => g.join_code === code);
    if (!group) return err(404, { error: "Invalid code — no trip found" });
    const members = getTable("group_members");
    const already = members.find((m) => m.group_id === group.id && m.user_id === user.id);
    if (already) return ok({ group_id: group.id, already_member: true });
    let displayName = user.display_name;
    if (members.find((m) => m.group_id === group.id && m.display_name === displayName))
      displayName = displayName + " " + user.id.slice(0, 4);
    const member = { id: uuid(), group_id: group.id, user_id: user.id, display_name: displayName, email: user.email, joined_at: now() };
    setTable("group_members", [...members, member]);
    return ok({ group_id: group.id, member });
  }

  // ── MEMBERS sub-resource ──────────────────────────────────────────────────
  if (sub === "members" && groupId) {
    const groups = getTable("groups");
    const group = groups.find((g) => g.id === groupId);
    if (!group) return err(404, { error: "Group not found" });
    const members = getTable("group_members");
    const isMember = members.find((m) => m.group_id === groupId && m.user_id === user.id);
    if (!isMember && group.created_by !== user.id) return err(403, { error: "Not a member" });

    if (method === "GET") return ok(members.filter((m) => m.group_id === groupId));

    if (method === "POST") {
      if (!body.display_name) return err(400, { error: "display_name required" });
      if (members.find((m) => m.group_id === groupId && m.display_name === body.display_name))
        return err(409, { error: "Name already taken in this group" });
      const member = { id: uuid(), group_id: groupId, user_id: body.user_id || null, display_name: body.display_name, email: body.email || null, joined_at: now() };
      setTable("group_members", [...members, member]);
      return ok(member, 201);
    }

    if (method === "DELETE" && subId) {
      const target = members.find((m) => m.id === subId && m.group_id === groupId);
      if (!target) return err(404, { error: "Member not found" });
      setTable("group_members", members.filter((m) => m.id !== subId));
      return ok({ ok: true });
    }
    return err(405, { error: "Method not allowed" });
  }

  // ── GROUPS CRUD ───────────────────────────────────────────────────────────
  const groups = getTable("groups");

  if (method === "GET" && !groupId) {
    const members = getTable("group_members");
    const myIds = new Set(members.filter((m) => m.user_id === user.id).map((m) => m.group_id));
    return ok(groups.filter((g) => g.created_by === user.id || myIds.has(g.id)).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  if (method === "GET" && groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return err(404, { error: "Group not found" });
    const members = getTable("group_members");
    if (!members.find((m) => m.group_id === groupId && m.user_id === user.id) && group.created_by !== user.id)
      return err(403, { error: "Not a member" });
    return ok(group);
  }

  if (method === "POST" && !action) {
    if (!body.name?.trim()) return err(400, { error: "name required" });
    const group = {
      id: uuid(), created_by: user.id, name: body.name.trim(),
      description: body.description || null, destination: body.destination || null,
      currency: body.currency || "USD", total_budget: body.total_budget || 0,
      alert_threshold_pct: body.alert_threshold_pct || 80,
      cover_emoji: body.cover_emoji || "✈️",
      start_date: body.start_date || null, end_date: body.end_date || null,
      status: body.status || "planning",
      join_code: uniqueJoinCode(groups), created_at: now(), updated_at: now(),
    };
    setTable("groups", [...groups, group]);
    const members = getTable("group_members");
    setTable("group_members", [...members, { id: uuid(), group_id: group.id, user_id: user.id, display_name: user.display_name, email: user.email, joined_at: now() }]);
    return ok(group, 201);
  }

  if ((method === "PATCH" || method === "PUT") && groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return err(404, { error: "Group not found" });
    if (group.created_by !== user.id) return err(403, { error: "Only creator can update" });
    const allowed = ["name","description","destination","currency","total_budget","alert_threshold_pct","cover_emoji","start_date","end_date","status"];
    const updates = { updated_at: now() };
    for (const k of allowed) if (k in body) updates[k] = body[k];
    const updated = { ...group, ...updates };
    setTable("groups", groups.map((g) => g.id === groupId ? updated : g));
    return ok(updated);
  }

  if (method === "DELETE" && groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return err(404, { error: "Group not found" });
    if (group.created_by !== user.id) return err(403, { error: "Only creator can delete" });
    const expIds = new Set(getTable("expenses").filter((e) => e.group_id === groupId).map((e) => e.id));
    setTable("expense_splits", getTable("expense_splits").filter((s) => !expIds.has(s.expense_id)));
    setTable("expenses", getTable("expenses").filter((e) => e.group_id !== groupId));
    setTable("group_members", getTable("group_members").filter((m) => m.group_id !== groupId));
    setTable("recurring_expenses", getTable("recurring_expenses").filter((r) => r.group_id !== groupId));
    setTable("settlements", getTable("settlements").filter((s) => s.group_id !== groupId));
    setTable("budget_alerts_sent", getTable("budget_alerts_sent").filter((a) => a.group_id !== groupId));
    setTable("groups", groups.filter((g) => g.id !== groupId));
    return ok({ ok: true });
  }

  return err(405, { error: "Method not allowed" });
};
