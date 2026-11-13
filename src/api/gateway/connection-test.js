"use strict";

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
  }

  try {
    const base = (process.env.SHASHURA_BASE_URL || "https://shashura.com/api/v1").replace(/\/+$/, "");
    const clientId = process.env.SHASHURA_CLIENT_ID;
    const clientSecret = process.env.SHASHURA_CLIENT_SECRET;
    const targetEnvironment = process.env.SHASHURA_TARGET_ENV || "production";
    const country = process.env.SHASHURA_COUNTRY || "UG";

    if (!clientId || !clientSecret) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ ok: false, authenticated: false, error: "Server credentials are not configured" }));
    }

    const response = await fetch(base + "/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CLIENT-ID": clientId,
        "X-Target-Environment": targetEnvironment,
        "X-COUNTRY": country
      },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret })
    });

    const payload = await response.json().catch(() => ({}));
    const accessToken = payload?.data?.access_token;
    if (!response.ok || !accessToken) {
      const message = String(payload?.message || payload?.error_description || payload?.error || "").slice(0, 240);
      const code = String(payload?.code || payload?.error_code || "").slice(0, 80);
      console.error("Shashura auth diagnostic:", JSON.stringify({ status: response.status, code, message, targetEnvironment, country }));
      res.statusCode = 502;
      return res.end(JSON.stringify({
        ok: false,
        provider: "Shashura",
        authenticated: false,
        provider_status: response.status,
        provider_code: code || null,
        provider_message: message || null,
        target_environment: targetEnvironment,
        country
      }));
    }

    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, provider: "Shashura", authenticated: true, target_environment: targetEnvironment }));
  } catch (error) {
    console.error("Shashura connection test error:", error.message);
    res.statusCode = 502;
    return res.end(JSON.stringify({ ok: false, authenticated: false, error: "Could not reach Shashura authentication service" }));
  }
};
