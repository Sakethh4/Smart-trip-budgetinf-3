// Cron-driven function that materializes due recurring expenses into actual expenses.
// Runs every hour via pg_cron. Idempotent on next_run_date advancement.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const advance = (date: string, freq: string): string => {
  const d = new Date(date + "T00:00:00Z");
  if (freq === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (freq === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (freq === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const today = new Date().toISOString().slice(0, 10);

    const { data: due, error } = await supabase
      .from("recurring_expenses")
      .select("*")
      .eq("active", true)
      .lte("next_run_date", today);
    if (error) throw error;

    let processed = 0;
    for (const r of due || []) {
      // Walk forward, creating one expense per missed period (cap to 60 to stay safe)
      let runDate = r.next_run_date;
      let safety = 0;
      while (runDate <= today && (!r.end_date || runDate <= r.end_date) && safety < 60) {
        // Get all members of the group for split
        const { data: members } = await supabase
          .from("group_members").select("id").eq("group_id", r.group_id);
        if (!members || members.length === 0) break;

        const { data: exp, error: eErr } = await supabase.from("expenses").insert({
          group_id: r.group_id, created_by: r.created_by, payer_member_id: r.payer_member_id,
          amount: r.amount, category: r.category, description: r.description,
          expense_date: runDate, split_type: r.split_type, is_auto: true,
        }).select().single();
        if (eErr || !exp) { console.error("insert exp err", eErr); break; }

        const each = Number(r.amount) / members.length;
        await supabase.from("expense_splits").insert(
          members.map((m: any) => ({ expense_id: exp.id, member_id: m.id, amount: Number(each.toFixed(2)) })),
        );

        // Trigger budget alert check (best effort)
        supabase.functions.invoke("check-budget-alert", { body: { group_id: r.group_id } }).catch(() => {});

        runDate = advance(runDate, r.frequency);
        safety++;
        processed++;
      }

      await supabase.from("recurring_expenses").update({ next_run_date: runDate }).eq("id", r.id);
    }

    return new Response(JSON.stringify({ ok: true, processed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
