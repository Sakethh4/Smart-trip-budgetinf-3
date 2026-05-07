/**
 * groups.js — trip/group CRUD + join by code
 *
 * GET    /groups                  list groups for current user
 * POST   /groups                  create group
 * GET    /groups/:id              get single group
 * PATCH  /groups/:id              update group
 * DELETE /groups/:id              delete group
 * POST   /groups/join             { code } — join by join code
 *
 * GET    /groups/:id/members      list members
 * POST   /groups/:id/members      add member  { display_name, email? }
 * DELETE /groups/:id/members/:mid remove member
 */
const { getTable, setTable } = require("./db");
const { requireAuth } = require("./auth");
const { uuid, now, uniqueJoinCode, parseBody, send } = require("./utils");

async function handleGroups(req, res, parts) {
  // parts: ["groups", id?, "members"?, memberId?]
  const user = requireAuth(req, res);
  if (!user) return;

  const groupId = parts[1];
  const sub = parts[2]; // "members" | undefined
  const subId = parts[3];

  // ── POST /groups/join ──────────────────────────────────────────────────────
  if (req.method === "POST" && groupId === "join") {
    const body = await parseBody(req);
    const code = (body.code || "").trim().toUpperCase();
    if (!code) return send(res, 400, { error: "code required" });

    const groups = getTable("groups");
    const group = groups.find((g) => g.join_code === code);
    if (!group) return send(res, 404, { error: "Invalid code — no trip found" });

    const members = getTable("group_members");
    const already = members.find((m) => m.group_id === group.id && m.user_id === user.id);
    if (already) return send(res, 200, { group_id: group.id, already_member: true });

    // Resolve display name collision
    let displayName = user.display_name;
    if (members.find((m) => m.group_id === group.id && m.display_name === displayName)) {
      displayName = displayName + " " + user.id.slice(0, 4);
    }

    const member = {
      id: uuid(), group_id: group.id, user_id: user.id,
      display_name: displayName, email: user.email, joined_at: now(),
    };
    setTable("group_members", [...members, member]);
    return send(res, 200, { group_id: group.id, member });
  }

  // ── Members sub-resource ───────────────────────────────────────────────────
  if (sub === "members") {
    const members = getTable("group_members");

    // Verify user is member or creator of this group
    const groups = getTable("groups");
    const group = groups.find((g) => g.id === groupId);
    if (!group) return send(res, 404, { error: "Group not found" });
    const isMember = members.find((m) => m.group_id === groupId && m.user_id === user.id);
    if (!isMember && group.created_by !== user.id)
      return send(res, 403, { error: "Not a member of this group" });

    if (req.method === "GET") {
      return send(res, 200, members.filter((m) => m.group_id === groupId));
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      if (!body.display_name) return send(res, 400, { error: "display_name required" });
      // Check name collision
      if (members.find((m) => m.group_id === groupId && m.display_name === body.display_name))
        return send(res, 409, { error: "A member with that name already exists in this group" });

      const member = {
        id: uuid(), group_id: groupId, user_id: body.user_id || null,
        display_name: body.display_name, email: body.email || null, joined_at: now(),
      };
      setTable("group_members", [...members, member]);
      return send(res, 201, member);
    }

    if (req.method === "DELETE" && subId) {
      const target = members.find((m) => m.id === subId && m.group_id === groupId);
      if (!target) return send(res, 404, { error: "Member not found" });
      setTable("group_members", members.filter((m) => m.id !== subId));
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { error: "Method not allowed" });
  }

  // ── Groups CRUD ────────────────────────────────────────────────────────────
  const groups = getTable("groups");

  if (req.method === "GET" && !groupId) {
    // Return groups where user is creator or member
    const members = getTable("group_members");
    const myGroupIds = new Set(
      members.filter((m) => m.user_id === user.id).map((m) => m.group_id)
    );
    const result = groups
      .filter((g) => g.created_by === user.id || myGroupIds.has(g.id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return send(res, 200, result);
  }

  if (req.method === "GET" && groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return send(res, 404, { error: "Group not found" });
    // Check access
    const members = getTable("group_members");
    const isMember = members.find((m) => m.group_id === groupId && m.user_id === user.id);
    if (!isMember && group.created_by !== user.id)
      return send(res, 403, { error: "Not a member of this group" });
    return send(res, 200, group);
  }

  if (req.method === "POST" && !groupId) {
    const body = await parseBody(req);
    if (!body.name || !body.name.trim()) return send(res, 400, { error: "name required" });

    const group = {
      id: uuid(),
      created_by: user.id,
      name: body.name.trim(),
      description: body.description || null,
      destination: body.destination || null,
      currency: body.currency || "USD",
      total_budget: body.total_budget || 0,
      alert_threshold_pct: body.alert_threshold_pct || 80,
      cover_emoji: body.cover_emoji || "✈️",
      start_date: body.start_date || null,
      end_date: body.end_date || null,
      status: body.status || "planning",
      join_code: uniqueJoinCode(groups),
      created_at: now(),
      updated_at: now(),
    };
    setTable("groups", [...groups, group]);

    // Auto-add creator as member
    const members = getTable("group_members");
    setTable("group_members", [
      ...members,
      {
        id: uuid(), group_id: group.id, user_id: user.id,
        display_name: user.display_name, email: user.email, joined_at: now(),
      },
    ]);

    return send(res, 201, group);
  }

  if ((req.method === "PATCH" || req.method === "PUT") && groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return send(res, 404, { error: "Group not found" });
    if (group.created_by !== user.id) return send(res, 403, { error: "Only the creator can update this group" });

    const body = await parseBody(req);
    const allowed = ["name","description","destination","currency","total_budget",
                     "alert_threshold_pct","cover_emoji","start_date","end_date","status"];
    const updates = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    updates.updated_at = now();

    const updated = { ...group, ...updates };
    setTable("groups", groups.map((g) => (g.id === groupId ? updated : g)));
    return send(res, 200, updated);
  }

  if (req.method === "DELETE" && groupId) {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return send(res, 404, { error: "Group not found" });
    if (group.created_by !== user.id) return send(res, 403, { error: "Only the creator can delete this group" });

    // Cascade delete
    const expIds = new Set(getTable("expenses").filter((e) => e.group_id === groupId).map((e) => e.id));
    setTable("expense_splits", getTable("expense_splits").filter((s) => !expIds.has(s.expense_id)));
    setTable("expenses", getTable("expenses").filter((e) => e.group_id !== groupId));
    setTable("group_members", getTable("group_members").filter((m) => m.group_id !== groupId));
    setTable("recurring_expenses", getTable("recurring_expenses").filter((r) => r.group_id !== groupId));
    setTable("settlements", getTable("settlements").filter((s) => s.group_id !== groupId));
    setTable("budget_alerts_sent", getTable("budget_alerts_sent").filter((a) => a.group_id !== groupId));
    setTable("groups", groups.filter((g) => g.id !== groupId));

    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "Method not allowed" });
}

module.exports = { handleGroups };
