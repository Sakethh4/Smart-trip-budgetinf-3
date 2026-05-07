// Sends budget-limit alerts to all members of a group when threshold is reached.
// Idempotent: uses budget_alerts_sent table to avoid duplicate alerts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { group_id } = await req.json();
    if (!group_id) throw new Error("group_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Get group + spending
    const { data: group } = await supabase.from("groups").select("*").eq("id", group_id).single();
    if (!group) throw new Error("group not found");

    const { data: expenses } = await supabase.from("expenses").select("amount").eq("group_id", group_id);
    const total = (expenses || []).reduce((s, e: any) => s + Number(e.amount), 0);
    const pct = group.total_budget > 0 ? (total / Number(group.total_budget)) * 100 : 0;

    if (pct < group.alert_threshold_pct) {
      return new Response(JSON.stringify({ skipped: true, pct }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Threshold bucket: 80, 90, 100 — only send each bucket once
    const bucket = pct >= 100 ? 100 : pct >= 90 ? 90 : group.alert_threshold_pct;
    const { data: existing } = await supabase
      .from("budget_alerts_sent").select("id").eq("group_id", group_id).eq("threshold_pct", bucket).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ already_sent: true, bucket }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Mark sent first (avoid race)
    await supabase.from("budget_alerts_sent").insert({ group_id, threshold_pct: bucket });

    // Get members with emails
    const { data: members } = await supabase
      .from("group_members").select("display_name, email").eq("group_id", group_id);
    const recipients = (members || []).filter((m: any) => m.email);

    let sent = 0;
    const errors: string[] = [];
    for (const r of recipients) {
      try {
        const { error } = await supabase.functions.invoke("send-transactional-email", {
          body: {
            templateName: "budget-alert",
            recipientEmail: r.email,
            idempotencyKey: `budget-${group_id}-${bucket}-${r.email}`,
            templateData: {
              memberName: r.display_name,
              tripName: group.name,
              percentage: Math.round(pct),
              spent: total.toFixed(2),
              budget: Number(group.total_budget).toFixed(2),
              currency: group.currency,
            },
          },
        });
        if (error) errors.push(`${r.email}: ${error.message}`);
        else sent++;
      } catch (e: any) {
        errors.push(`${r.email}: ${e.message}`);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, bucket, pct, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("check-budget-alert error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
