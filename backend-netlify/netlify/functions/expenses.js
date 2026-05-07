/**
 * /api/expenses
 * GET    /api/expenses?group_id=...
 * POST   /api/expenses
 * DELETE /api/expenses?id=...
 * GET    /api/expenses?id=...&sub=splits
 */
const { getTable, setTable } = require("./_db");
const { uuid, now, requireAuth, ok, err } = require("./_utils");

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
    console.log(`[budget-alert] ${group.name} reached ${Math.round(pct)}% (bucket ${bucket}%)`);
  } catch (e) { console.error("[budget-alert]", e.message); }
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return ok({});

  const reply = (status, data) => err(status, data);
  const { user, error } = requireAuth(event.headers, reply);
  if (error) return error;

  const q = event.queryStringParameters || {};
  const expenseId = q.id;
  const groupId = q.group_id;
  const sub = q.sub;
  const body = event.body ? JSON.parse(event.body) : {};
  const method = event.httpMethod;

  function assertMember(gid) {
    const group = getTable("groups").find((g) => g.id === gid);
    if (!group) return err(404, { error: "Group not found" });
    const isMember = getTable("group_members").find((m) => m.group_id === gid && m.user_id === user.id);
    if (!isMember && group.created_by !== user.id) return err(403, { error: "Not a member" });
    return null;
  }

  // GET splits
  if (method === "GET" && expenseId && sub === "splits") {
    const expense = getTable("expenses").find((e) => e.id === expenseId);
    if (!expense) return err(404, { error: "Expense not found" });
    const denied = assertMember(expense.group_id);
    if (denied) return denied;
    return ok(getTable("expense_splits").filter((s) => s.expense_id === expenseId));
  }

  // GET list
  if (method === "GET" && !expenseId) {
    if (!groupId) return err(400, { error: "group_id required" });
    const denied = assertMember(groupId);
    if (denied) return denied;
    return ok(getTable("expenses").filter((e) => e.group_id === groupId).sort((a, b) => b.expense_date.localeCompare(a.expense_date)));
  }

  // POST create
  if (method === "POST") {
    const { group_id, payer_member_id, amount, splits } = body;
    if (!group_id) return err(400, { error: "group_id required" });
    if (!payer_member_id) return err(400, { error: "payer_member_id required" });
    if (!amount || amount <= 0) return err(400, { error: "amount must be > 0" });
    const denied = assertMember(group_id);
    if (denied) return denied;

    const expense = {
      id: uuid(), group_id, created_by: user.id, payer_member_id,
      amount: Number(amount), currency: body.currency || "USD",
      category: body.category || "other", description: body.description || null,
      expense_date: body.expense_date || now().slice(0, 10),
      split_type: body.split_type || "equal_all", is_auto: false, created_at: now(),
    };
    setTable("expenses", [...getTable("expenses"), expense]);

    const members = getTable("group_members").filter((m) => m.group_id === group_id);
    let splitRows = [];
    if (expense.split_type === "equal_all") {
      const each = Number((expense.amount / members.length).toFixed(2));
      splitRows = members.map((m) => ({ id: uuid(), expense_id: expense.id, member_id: m.id, amount: each }));
    } else if (expense.split_type === "equal_selected" && splits?.length) {
      const each = Number((expense.amount / splits.length).toFixed(2));
      splitRows = splits.map((s) => ({ id: uuid(), expense_id: expense.id, member_id: s.member_id, amount: each }));
    } else if (expense.split_type === "custom" && splits?.length) {
      splitRows = splits.map((s) => ({ id: uuid(), expense_id: expense.id, member_id: s.member_id, amount: Number(s.amount) }));
    } else {
      const each = Number((expense.amount / members.length).toFixed(2));
      splitRows = members.map((m) => ({ id: uuid(), expense_id: expense.id, member_id: m.id, amount: each }));
    }
    setTable("expense_splits", [...getTable("expense_splits"), ...splitRows]);
    checkBudgetAlert(group_id);
    return ok({ expense, splits: splitRows }, 201);
  }

  // DELETE
  if (method === "DELETE" && expenseId) {
    const expenses = getTable("expenses");
    const expense = expenses.find((e) => e.id === expenseId);
    if (!expense) return err(404, { error: "Expense not found" });
    const denied = assertMember(expense.group_id);
    if (denied) return denied;
    setTable("expense_splits", getTable("expense_splits").filter((s) => s.expense_id !== expenseId));
    setTable("expenses", expenses.filter((e) => e.id !== expenseId));
    return ok({ ok: true });
  }

  return err(405, { error: "Method not allowed" });
};
