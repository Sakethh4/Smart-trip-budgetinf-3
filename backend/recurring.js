/**
 * recurring.js — recurring expenses
 *
 * GET    /recurring?group_id=...
 * POST   /recurring
 *   body: { group_id, payer_member_id, amount, category?, description?,
 *           frequency, next_run_date?, end_date?, split_type? }
 * PATCH  /recurring/:id   { active?, amount?, ... }
 * DELETE /recurring/:id
 * POST   /recurring/process   process all due recurring expenses (cron-like)
 */
const { getTable, setTable } = require("./db");
const { requireAuth } = require("./auth");
const { uuid, now, advanceDate, parseBody, send } = require("./utils");
const { checkBudgetAlert } = require("./expenses");

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

async function handleRecurring(req, res, parts) {
  const user = requireAuth(req, res);
  if (!user) return;

  const recurringId = parts[1];

  // POST /recurring/process — process all due recurring expenses
  if (req.method === "POST" && recurringId === "process") {
    const processed = processDueRecurring();
    return send(res, 200, { ok: true, processed });
  }

  // GET /recurring?group_id=...
  if (req.method === "GET" && !recurringId) {
    const url = new URL(req.url, "http://localhost");
    const groupId = url.searchParams.get("group_id");
    if (!groupId) return send(res, 400, { error: "group_id query param required" });
    if (!assertMember(groupId, user.id, res)) return;
    const rows = getTable("recurring_expenses")
      .filter((r) => r.group_id === groupId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    return send(res, 200, rows);
  }

  // POST /recurring
  if (req.method === "POST" && !recurringId) {
    const body = await parseBody(req);
    const { group_id, payer_member_id, amount, frequency } = body;
    if (!group_id) return send(res, 400, { error: "group_id required" });
    if (!payer_member_id) return send(res, 400, { error: "payer_member_id required" });
    if (!amount || amount <= 0) return send(res, 400, { error: "amount must be > 0" });
    if (!["daily", "weekly", "monthly"].includes(frequency))
      return send(res, 400, { error: "frequency must be daily, weekly, or monthly" });
    if (!assertMember(group_id, user.id, res)) return;

    const row = {
      id: uuid(),
      group_id,
      created_by: user.id,
      payer_member_id,
      amount: Number(amount),
      category: body.category || "other",
      description: body.description || null,
      frequency,
      next_run_date: body.next_run_date || now().slice(0, 10),
      end_date: body.end_date || null,
      active: true,
      split_type: body.split_type || "equal_all",
      created_at: now(),
    };
    setTable("recurring_expenses", [...getTable("recurring_expenses"), row]);
    return send(res, 201, row);
  }

  // PATCH /recurring/:id
  if ((req.method === "PATCH" || req.method === "PUT") && recurringId) {
    const rows = getTable("recurring_expenses");
    const row = rows.find((r) => r.id === recurringId);
    if (!row) return send(res, 404, { error: "Recurring expense not found" });
    if (!assertMember(row.group_id, user.id, res)) return;

    const body = await parseBody(req);
    const allowed = ["amount","category","description","frequency","next_run_date","end_date","active","split_type","payer_member_id"];
    const updates = {};
    for (const k of allowed) if (k in body) updates[k] = body[k];

    const updated = { ...row, ...updates };
    setTable("recurring_expenses", rows.map((r) => (r.id === recurringId ? updated : r)));
    return send(res, 200, updated);
  }

  // DELETE /recurring/:id
  if (req.method === "DELETE" && recurringId) {
    const rows = getTable("recurring_expenses");
    const row = rows.find((r) => r.id === recurringId);
    if (!row) return send(res, 404, { error: "Recurring expense not found" });
    if (!assertMember(row.group_id, user.id, res)) return;
    setTable("recurring_expenses", rows.filter((r) => r.id !== recurringId));
    return send(res, 200, { ok: true });
  }

  return send(res, 405, { error: "Method not allowed" });
}

// Process all due recurring expenses — can be called on a timer or via POST /recurring/process
function processDueRecurring() {
  const today = now().slice(0, 10);
  const due = getTable("recurring_expenses").filter(
    (r) => r.active && r.next_run_date <= today
  );

  let processed = 0;
  for (const r of due) {
    const members = getTable("group_members").filter((m) => m.group_id === r.group_id);
    if (!members.length) continue;

    let runDate = r.next_run_date;
    let safety = 0;

    while (runDate <= today && (!r.end_date || runDate <= r.end_date) && safety < 60) {
      const expense = {
        id: uuid(),
        group_id: r.group_id,
        created_by: r.created_by,
        payer_member_id: r.payer_member_id,
        amount: r.amount,
        currency: "USD",
        category: r.category,
        description: r.description,
        expense_date: runDate,
        split_type: r.split_type,
        is_auto: true,
        created_at: now(),
      };
      setTable("expenses", [...getTable("expenses"), expense]);

      const each = Number((r.amount / members.length).toFixed(2));
      const splits = members.map((m) => ({
        id: uuid(), expense_id: expense.id, member_id: m.id, amount: each,
      }));
      setTable("expense_splits", [...getTable("expense_splits"), ...splits]);

      checkBudgetAlert(r.group_id);

      runDate = advanceDate(runDate, r.frequency);
      safety++;
      processed++;
    }

    // Advance next_run_date
    const allRecurring = getTable("recurring_expenses");
    setTable("recurring_expenses", allRecurring.map((rec) =>
      rec.id === r.id ? { ...rec, next_run_date: runDate } : rec
    ));
  }

  return processed;
}

module.exports = { handleRecurring, processDueRecurring };
