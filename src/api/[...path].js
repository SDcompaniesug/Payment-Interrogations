"use strict";

const { neon } = require("@neondatabase/serverless");
const crypto = require("node:crypto");

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

const getDb = () => {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error("Database is not configured"), { status: 503 });
  return neon(process.env.DATABASE_URL);
};
const query = async (statement, params = []) => {
  const result = await getDb().query(statement, params);
  return Array.isArray(result) ? result : (result.rows || []);
};

const normalizeUgPhone = (input) => {
  let value = String(input || "").replace(/[^\d+]/g, "");
  if (value.startsWith("+")) value = value.slice(1);
  if (value.startsWith("0")) value = "256" + value.slice(1);
  if (!/^256(7|3)\d{8}$/.test(value)) {
    throw Object.assign(new Error("Enter a valid Ugandan mobile-money number"), { status: 400 });
  }
  return value;
};

let tokenCache = { value: "", expiresAt: 0 };
async function shashuraToken() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const base = (process.env.SHASHURA_BASE_URL || "https://shashura.com/api/v1").replace(/\/+$/, "");
  const clientId = process.env.SHASHURA_CLIENT_ID;
  const clientSecret = process.env.SHASHURA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error("Shashura credentials are not configured on the server"), { status: 503 });
  }
  const response = await fetch(base + "/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CLIENT-ID": clientId,
      "X-Target-Environment": process.env.SHASHURA_TARGET_ENV || "production",
      "X-COUNTRY": process.env.SHASHURA_COUNTRY || "UG"
    },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.data?.access_token) {
    const providerMessage = String(payload?.message || payload?.error_description || payload?.error || "").slice(0, 240);
    const providerCode = String(payload?.code || payload?.error_code || "").slice(0, 80);
    throw Object.assign(new Error("Shashura authentication failed"), {
      status: 502,
      providerStatus: response.status,
      providerMessage,
      providerCode
    });
  }
  tokenCache = {
    value: payload.data.access_token,
    expiresAt: Date.now() + Number(payload.data.expires_in || 3600) * 1000
  };
  return tokenCache.value;
}

async function shashuraRequest(path, method = "GET", body) {
  const base = (process.env.SHASHURA_BASE_URL || "https://shashura.com/api/v1").replace(/\/+$/, "");
  const token = await shashuraToken();
  const response = await fetch(base + path, {
    method,
    headers: {
      "Authorization": "Bearer " + token,
      "X-CLIENT-ID": process.env.SHASHURA_CLIENT_ID,
      "X-Target-Environment": process.env.SHASHURA_TARGET_ENV || "production",
      "X-COUNTRY": process.env.SHASHURA_COUNTRY || "UG",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("Shashura request failed");
    error.status = 502;
    error.providerStatus = response.status;
    throw error;
  }
  return payload;
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch {}
  }
  return {};
}

function getDeviceId(value) {
  const id = String(value || "");
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(id)) {
    throw Object.assign(new Error("A valid installation ID is required"), { status: 400 });
  }
  return id;
}

async function getPlan(planId) {
  const rows = await query(
    "SELECT id, name, amount, duration_days FROM subscription_plans WHERE id = $1 AND active = true LIMIT 1",
    [planId]
  );
  return rows[0] || null;
}

async function startCheckout(req, res) {
  const body = getBody(req);
  const deviceId = getDeviceId(body.device_id);
  const phone = normalizeUgPhone(body.msisdn);
  const planId = String(body.plan_id || "");
  const idempotencyKey = String(body.idempotency_key || "");
  if (!/^[a-zA-Z0-9_-]{12,128}$/.test(idempotencyKey)) {
    return json(res, 400, { error: "A valid idempotency_key is required" });
  }

  const plan = await getPlan(planId);
  if (!plan) return json(res, 404, { error: "Selected plan is unavailable" });

  const existing = await query(
    "SELECT reference, status, gateway_tid, amount, msisdn FROM payments WHERE user_id=$1 AND idempotency_key=$2 LIMIT 1",
    [deviceId, idempotencyKey]
  );
  if (existing[0]) {
    return json(res, 200, {
      ok: true, reference: existing[0].reference, status: existing[0].status,
      gateway_tid: existing[0].gateway_tid, amount: Number(existing[0].amount),
      msisdn: existing[0].msisdn, reused: true
    });
  }

  const reference = "SDP" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(5).toString("hex").toUpperCase();
  await query(
    "INSERT INTO payments (id,user_id,plan_id,msisdn,amount,reference,idempotency_key,status) VALUES ($1,$2,$3,$4,$5,$6,$7,'CREATED')",
    [crypto.randomUUID(), deviceId, plan.id, phone, plan.amount, reference, idempotencyKey]
  );

  try {
    const provider = await shashuraRequest("/requestToPay", "POST", {
      msisdn: phone, amount: Number(plan.amount), reference
    });
    const tid = provider?.data?.tid || provider?.tid || null;
    await query(
      "UPDATE payments SET gateway_tid=$1,status='PENDING',gateway_state=$2,gateway_response=$3::jsonb,updated_at=now() WHERE reference=$4",
      [tid, provider?.data?.status || provider?.status || "PENDING", JSON.stringify(provider), reference]
    );
    return json(res, 202, {
      ok: true, reference, gateway_tid: tid, status: "PENDING",
      amount: Number(plan.amount), currency: "UGX",
      message: "Payment request sent. Approve the prompt on your phone."
    });
  } catch (error) {
    await query(
      "UPDATE payments SET status='FAILED',gateway_state='REQUEST_FAILED',gateway_response=$1::jsonb,updated_at=now() WHERE reference=$2",
      [JSON.stringify({ message: error.message }), reference]
    );
    throw error;
  }
}

async function checkCheckout(req, res, url) {
  const deviceId = getDeviceId(url.searchParams.get("device_id"));
  const reference = String(url.searchParams.get("reference") || "");
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(reference)) return json(res, 400, { error: "Invalid payment reference" });

  const rows = await query(
    "SELECT p.reference,p.status,p.gateway_tid,p.gateway_state,p.amount,p.msisdn,p.plan_id,sp.name AS plan_name,sp.duration_days FROM payments p JOIN subscription_plans sp ON sp.id=p.plan_id WHERE p.reference=$1 AND p.user_id=$2 LIMIT 1",
    [reference, deviceId]
  );
  const payment = rows[0];
  if (!payment) return json(res, 404, { error: "Payment not found for this installation" });

  if (payment.status === "PENDING" || payment.status === "CREATED") {
    const result = await shashuraRequest("/enquiry/" + encodeURIComponent(reference));
    const state = String(result?.data?.status || result?.data?.state || result?.status || result?.state || "").toUpperCase();
    const providerTid = result?.data?.tid || payment.gateway_tid || null;

    if (["TS", "SUCCESS", "SUCCESSFUL"].includes(state)) {
      await query(
        "UPDATE payments SET status='SUCCESSFUL',gateway_state=$1,gateway_tid=$2,gateway_response=$3::jsonb,paid_at=COALESCE(paid_at,now()),updated_at=now() WHERE reference=$4",
        [state, providerTid, JSON.stringify(result), reference]
      );
      await query(
        "INSERT INTO subscriptions (user_id,plan_id,payment_reference,starts_at,expires_at) SELECT $1,$2,$3,base_time,base_time + ($4 || ' days')::interval FROM (SELECT GREATEST(now(),COALESCE(MAX(expires_at),now())) AS base_time FROM subscriptions WHERE user_id=$1) s ON CONFLICT (payment_reference) DO NOTHING",
        [deviceId, payment.plan_id, reference, Number(payment.duration_days)]
      );
      payment.status = "SUCCESSFUL";
    } else if (["TF", "FAILED", "FAILURE", "CANCELLED", "EXPIRED"].includes(state)) {
      await query(
        "UPDATE payments SET status='FAILED',gateway_state=$1,gateway_response=$2::jsonb,updated_at=now() WHERE reference=$3",
        [state, JSON.stringify(result), reference]
      );
      payment.status = "FAILED";
    }
    payment.gateway_state = state || payment.gateway_state;
  }

  return json(res, 200, {
    ok: true, reference, status: payment.status,
    gateway_state: payment.gateway_state || null,
    amount: Number(payment.amount), currency: "UGX",
    msisdn: payment.msisdn, plan: payment.plan_name
  });
}

async function accountSubscription(req, res, url) {
  const deviceId = getDeviceId(url.searchParams.get("device_id"));
  const rows = await query(
    "SELECT s.plan_id,sp.name AS plan_name,s.payment_reference,s.starts_at,s.expires_at,p.msisdn FROM subscriptions s JOIN subscription_plans sp ON sp.id=s.plan_id JOIN payments p ON p.reference=s.payment_reference WHERE s.user_id=$1 ORDER BY s.expires_at DESC LIMIT 1",
    [deviceId]
  );
  return json(res, 200, { ok: true, subscription: rows[0] || null });
}

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, "https://internal.local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGINS || "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      return res.end();
    }
    res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGINS || "*");
    res.setHeader("Vary", "Origin");

    if (req.method === "GET" && path === "/api/health") {
      const rows = await query("SELECT 1 AS connected");
      return json(res, 200, { ok: true, service: "Shashura SD Pay API", version: "3.0.0", database: rows.length ? "connected" : "unknown" });
    }
    if (req.method === "GET" && path === "/api/plans") {
      const plans = await query("SELECT id,name,amount,duration_days FROM subscription_plans WHERE active=true ORDER BY amount ASC");
      return json(res, 200, { currency: "UGX", plans: plans.map(p => ({ ...p, amount: Number(p.amount), duration_days: Number(p.duration_days) })) });
    }
    if (req.method === "GET" && path === "/api/gateway/connection-test") {
      try {
        await shashuraToken();
        return json(res, 200, { ok: true, provider: "Shashura", authenticated: true });
      } catch (error) {
        return json(res, 502, {
          ok: false,
          provider: "Shashura",
          authenticated: false,
          provider_status: error.providerStatus || null,
          provider_code: error.providerCode || null,
          provider_message: error.providerMessage || null,
          error: "Shashura authentication failed"
        });
      }
    }
    if (req.method === "POST" && path === "/api/checkout") return await startCheckout(req, res);
    if (req.method === "GET" && path === "/api/checkout/status") return await checkCheckout(req, res, url);
    if (req.method === "GET" && path === "/api/account/subscription") return await accountSubscription(req, res, url);
    if (req.method === "GET" && path === "/api/kyc") {
      const phone = normalizeUgPhone(url.searchParams.get("msisdn"));
      return json(res, 200, await shashuraRequest("/kyc/" + encodeURIComponent(phone)));
    }
    return json(res, 404, { error: "Route not found" });
  } catch (error) {
    console.error("Shashura SD Pay API error:", JSON.stringify({
      message: error.message,
      providerStatus: error.providerStatus || null,
      providerCode: error.providerCode || null,
      providerMessage: error.providerMessage || null
    }));
    return json(res, error.status || 500, { error: error.status ? error.message : "Internal server error" });
  }
};
