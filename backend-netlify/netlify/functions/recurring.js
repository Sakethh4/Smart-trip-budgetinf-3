/**
 * /api/recurring
 * GET    /api/recurring?group_id=...
 * POST   /api/recurring
 * PATCH  /api/recurring?id=...
 * DELETE /api/recurring?id=...
 * POST   /api/recurring?action=process
 */
const { getTable, setTable } = require("./_db");
const { uuid, now, advanceDate, requireAuth, ok, err } = require("./_utils");

function checkBudgetAlert(groupId) {
  try {
    const group = getTable("groups").find((g) => g.id === groupId);
    if (!group || group.total_budget <= 0) return;
    const total = getTable("expenses").filter((e) => e.group_id === groupId).reduce((s, e) => s + Number(e.amount), 0);
    const pct = (total / Number(group.total_budget)) * 100;
    if (pct < group.alert_threshold_pct) return;
    const bucket = pct >= 100 ? 100 : pct >= 90 ? 90 : group.alert_threshold_pct;
    const alerts = getTable("budget_alerts_sent");
    if (alerts.find((a) => a.group_id === groupId && a.threshold_pct === bucket)) return;
    setTable("budget_alerts_sent", [...alerts, { id: uuid(), group_id: groupId, threshold_pct: bucket, sent_at: now() }]);
  } catch (e) { console.error("[budget-alert]", e.message); }
}

function processDue() {
  const today = now().slice(0, 10);
  const due = getTable("recurring_expenses").filter((r) => r.active && r.next_run_date <= today);
  let processed = 0;
  for (const r of due) {
    const members = getTable("group_members").filter((m) => m.group_id === r.group_id);
    if (!members.length) continue;
    let runDate = r.next_run_date;
    let safety = 0;
    while (runDate <= today && (!r.end_date || runDate <= r.end_date) && safety < 60) {
      const expense = { id: uuid(), group_id: r.group_id, created_by: r.created_by, payer_member_id: r.payer_member_id, amount: r.amount, currency: "USD", category: r.category, description: r.description, expense_date: runDate, split_type: r.split_type, is_auto: true, created_at: now() };
      setTable("expenses", [...getTable("expenses"), expense]);
      const each = Number((r.amount / members.length).toFixed(2));
      setTable("expense_splits", [...getTable("expense_splits"), ...members.map((m) => ({ id: uuid(), expense_id: expense.id, member_id: m.id, amount: each }))]);
      checkBudgetAlert(r.group_id);
      runDate = advanceDate(runDate, r.frequency);
      safety++; processed++;
    }
    setTable("recurring_expenses", getTable("recurring_expenses").map((rec) => rec.id === r.id ? { ...rec, next_run_date: runDate } : rec));
  }
  return processed;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});

  const reply = (status, data) => err(status, data);
  const { user, error } = requireAuth(event.headers, reply);
  if (error) return error;

  const q = event.queryStringParameters || {};
  const recurringId = q.id;
  const groupId = q.group_id;
  const action = q.action;
  const body = event.body ? JSON.parse(event.body) : {};
  const method = event.httpMethod;

  function assertMember(gid) {
    const group = getTable("groups").find((g) => g.id === gid);
    if (!group) return err(404, { error: "Group not found" });
    const isMember = getTable("group_members").find((m) => m.group_id === gid && m.user_id === user.id);
    if (!isMember && group.created_by !== user.id) return err(403, { error: "Not a member" });
    return null;
  }

  if (method === "POST" && action === "process") return ok({ ok: true, processed: processDue() });

  if (method === "GET") {
    if (!groupId) return err(400, { error: "group_id required" });
    const denied = assertMember(groupId);
    if (denied) return denied;
    return ok(getTable("recurring_expenses").filter((r) => r.group_id === groupId).sort((a, b) => b.created_at.localeCompare(a.created_at)));
  }

  if (method === "POST") {
    const { group_id, payer_member_id, amount, frequency } = body;
    if (!group_id) return err(400, { error: "group_id required" });
    if (!payer_member_id) return err(400, { error: "payer_member_id required" });
    if (!amount || amount <= 0) return err(400, { error: "amount must be > 0" });
    if (!["daily","weekly","monthly"].includes(frequency)) return err(400, { error: "frequency must be daily, weekly, or monthly" });
    const denied = assertMember(group_id);
    if (denied) return denied;
    const row = { id: uuid(), group_id, created_by: user.id, payer_member_id, amount: Number(amount), category: body.category || "other", description: body.description || null, frequency, next_run_date: body.next_run_date || now().slice(0, 10), end_date: body.end_date || null, active: true, split_type: body.split_type || "equal_all", created_at: now() };
    setTable("recurring_expenses", [...getTable("recurring_expenses"), row]);
    return ok(row, 201);
  }

  if ((method === "PATCH" || method === "PUT") && recurringId) {
    const rows = getTable("recurring_expenses");
    const row = rows.find((r) => r.id === recurringId);
    if (!row) return err(404, { error: "Not found" });
    const denied = assertMember(row.group_id);
    if (denied) return denied;
    const allowed = ["amount","category","description","frequency","next_run_date","end_date","active","split_type","payer_member_id"];
    const updates = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];
    const updated = { ...row, ...updates };
    setTable("recurring_expenses", rows.map((r) => r.id === recurringId ? updated : r));
    return ok(updated);
  }

  if (method === "DELETE" && recurringId) {
    const rows = getTable("recurring_expenses");
    const row = rows.find((r) => r.id === recurringId);
    if (!row) return err(404, { error: "Not found" });
    const denied = assertMember(row.group_id);
    if (denied) return denied;
    setTable("recurring_expenses", rows.filter((r) => r.id !== recurringId));
    return ok({ ok: true });
  }

  return err(405, { error: "Method not allowed" });
};
