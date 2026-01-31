// Supabase Edge Function: send-outbox-emails
// Reads queued rows from public.notification_outbox and sends emails (DRY_RUN by default).
// Configure verifyJwt=false in supabase/config.toml (or use --no-verify-jwt).
//
// Env (local): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional: RESEND_API_KEY, FROM_EMAIL, DRY_RUN, MAX_BATCH, MAX_ATTEMPTS

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export const config = {
  verifyJwt: false,
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
}

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const FROM_EMAIL = Deno.env.get("FROM_EMAIL") ?? "no-reply@local.test";
const DRY_RUN = (Deno.env.get("DRY_RUN") ?? "true").toLowerCase() === "true";
const MAX_BATCH = Number(Deno.env.get("MAX_BATCH") ?? "25");
const MAX_ATTEMPTS = Number(Deno.env.get("MAX_ATTEMPTS") ?? "5");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
    },
  });
}

async function sendViaResend(toEmail: string, subject: string, bodyText: string) {
  const payload = {
    from: FROM_EMAIL,
    to: [toEmail],
    subject,
    text: bodyText,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error (${res.status}): ${errText}`);
  }
}

async function markSent(id: number) {
  await supabase
    .from("notification_outbox")
    .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
    .eq("id", id);
}

async function markFailed(id: number, attempts: number, error: string) {
  const next = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // +10m
  const nextStatus = attempts + 1 >= MAX_ATTEMPTS ? "failed" : "queued";

  await supabase
    .from("notification_outbox")
    .update({
      status: nextStatus,
      attempts: attempts + 1,
      next_attempt_at: next,
      error,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", id);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers":
          "authorization, x-client-info, apikey, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Use POST" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse(
      { ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      500,
    );
  }

  // Fetch queued emails
  const { data: rows, error } = await supabase
    .from("notification_outbox")
    .select("*")
    .eq("channel", "email")
    .eq("status", "queued")
    .lte("next_attempt_at", new Date().toISOString())
    .order("id", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    return jsonResponse({ ok: false, error: error.message }, 500);
  }

  let processed = 0;
  let sent = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    // Lock row (best-effort)
    const { data: locked } = await supabase
      .from("notification_outbox")
      .update({
        status: "processing",
        locked_at: new Date().toISOString(),
        locked_by: "send-outbox-emails",
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select()
      .maybeSingle();

    if (!locked) continue;

    processed += 1;

    try {
      const toEmail = String(row.to_email ?? "");
      const subject = String(row.subject ?? "");
      const body = String(row.body ?? "");

      if (!toEmail) throw new Error("Missing to_email");
      if (!subject) throw new Error("Missing subject");

      if (DRY_RUN || !RESEND_API_KEY) {
        console.log(`EMAIL → to=${toEmail} subject="${subject}"`);
        console.log(body);
      } else {
        await sendViaResend(toEmail, subject, body);
        console.log(`EMAIL SENT → to=${toEmail} subject="${subject}"`);
      }

      await markSent(row.id);
      sent += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("EMAIL FAILED", row.id, msg);
      await markFailed(row.id, Number(row.attempts ?? 0), msg);
      failed += 1;
    }
  }

  return jsonResponse({
    ok: true,
    dry_run: DRY_RUN || !RESEND_API_KEY,
    batch_limit: MAX_BATCH,
    processed,
    sent,
    failed,
  });
});
