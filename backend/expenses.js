/**
 * expenses.js
 *
 * GET    /expenses?group_id=...          list expenses for a group
 * POST   /expenses                       create expense + splits
 *   body: { group_id, payer_member_id, amount, currency?, category?,
 *           description?, expense_date?, split_type?, splits? }
 *   splits: [{ member_id, amount }]  — required for split_type=custom or equal_selected
 * DELETE /expenses/:id                   delete expense + its splits
 *
 * GET    /expenses/:id/splits            list splits for an expense
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

async function handleExpenses(req, res, parts) {
  const user = requireAuth(req, res);
  if (!user) return;

  const expenseId = parts[1];
  const sub = parts[2]; // "splits"

  // GET /expenses/:id/splits
  if (req.method === "GET" && expenseId && sub === "splits") {
    const expense = getTable("expenses").find((e) => e.id === expenseId);
    if (!expense) return send(res, 404, { error: "Expense not found" });
    if (!assertMember(expense.group_id, user.id, res)) return;
    const splits = getTable("expense_splits").filter((s) => s.expense_id === expenseId);
    return send(res, 200, splits);
  }

  // GET /expenses?group_id=...
  if (req.method === "GET" && !expenseId) {
    const url = new URL(req.url, "http://localhost");
    const groupId = url.searchParams.get("group_id");
    if (!groupId) return send(res, 400, { error: "group_id query param required" });
    if (!assertMember(groupId, user.id, res)) return;
    const expenses = getTable("expenses")
      .filter((e) => e.group_id === groupId)
      .sort((a, b) => b.expense_date.localeCompare(a.expense_date));
    return send(res, 200, expenses);
  }

  // POST /expenses
  if (req.method === "POST" && !expenseId) {
    const body = await parseBody(req);
    const { group_id, payer_member_id, amount, splits } = body;
    if (!group_id) return send(res, 400, { error: "group_id required" });
    if (!payer_member_id) return send(res, 400, { error: "payer_member_id required" });
    if (!amount || amount <= 0) return send(res, 400, { error: "amount must be > 0" });
    if (!assertMember(group_id, user.id, res)) return;

    const expense = {
      id: uuid(),
      group_id,
      created_by: user.id,
      payer_member_id,
      amount: Number(amount),
      currency: body.currency || "USD",
      category: body.category || "other",
      description: body.description || null,
      expense_date: body.expense_date || now().slice(0, 10),
      split_type: body.split_type || "equal_all",
      is_auto: false,
      created_at: now(),
    };
    setTable("expenses", [...getTable("expenses"), expense]);

    // Build splits
    const members = getTable("group_members").filter((m) => m.group_id === group_id);
    let splitRows = [];

    if (expense.split_type === "equal_all") {
      const each = Number((expense.amount / members.length).toFixed(2));
      splitRows = members.map((m) => ({ id: uuid(), expense_id: expense.id, member_id: m.id, amount: each }));
    } else if (expense.split_type === "equal_selected" && splits && splits.length) {
      const each = Number((expense.amount / splits.length).toFixed(2));
      splitRows = splits.map((s) => ({ id: uuid(), expense_id: expense.id, member_id: s.member_id, amount: each }));
    } else if (expense.split_type === "custom" && splits && splits.length) {
      splitRows = splits.map((s) => ({ id: uuid(), expense_id: expense.id, member_id: s.member_id, amount: Number(s.amount) }));
    } else {
      // Fallback: equal_all
      const each = Number((expense.amount / members.length).toFixed(2));
      splitRows = members.map((m) => ({ id: uuid(), expense_id: expense.id, member_id: m.id, amount: each }));
    }

    setTable("expense_splits", [...getTable("expense_splits"), ...splitRows]);

    // Check budget alert (best effort)
    checkBudgetAlert(group_id);

    return send(res, 201, { expense, splits: splitRows });
  }

  // DELETE /expenses/:id
  if (req.method === "DELETE" && expenseId) {
    const expenses = getTable("expenses");
    const expense = expenses.find((e) => e.id === expenseId);
    if (!expense) return send(res, 404, { error: "Expense not found" });
    if (!assertMember(expense.group_id, user.id, res)) return;

    setTable("expense_splits", getTable("expense_splits").filter((s) => s.expense_id !== expenseId));
    setTable("expenses", expenses.filter((e) => e.id !== expenseId));
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "Method not allowed" });
}

// Inline budget alert check (no email — just marks the alert as triggered)
function checkBudgetAlert(groupId) {
  try {
    const groups = getTable("groups");
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.total_budget <= 0) return;

    const expenses = getTable("expenses").filter((e) => e.group_id === groupId);
    const total = expenses.reduce((s, e) => s + Number(e.amount), 0);
    const pct = (total / Number(group.total_budget)) * 100;

    if (pct < group.alert_threshold_pct) return;

    const bucket = pct >= 100 ? 100 : pct >= 90 ? 90 : group.alert_threshold_pct;
    const alerts = getTable("budget_alerts_sent");
    const already = alerts.find((a) => a.group_id === groupId && a.threshold_pct === bucket);
    if (already) return;

    setTable("budget_alerts_sent", [
      ...alerts,
      { id: require("./utils").uuid(), group_id: groupId, threshold_pct: bucket, sent_at: require("./utils").now() },
    ]);
    console.log(`[budget-alert] Group "${group.name}" reached ${Math.round(pct)}% of budget (bucket: ${bucket}%)`);
  } catch (e) {
    console.error("[budget-alert] error:", e.message);
  }
}

module.exports = { handleExpenses, checkBudgetAlert };
