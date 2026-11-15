const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;

/* ---------- Environment ---------- */
// Minimal .env loader so `node server.js` works without extra dependencies.
// Values already present in the real environment always win.
const loadEnvFile = (file) => {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || line.trimStart().startsWith("#")) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = value.replace(/^(['"])(.*)\1$/, "$2");
  }
};
loadEnvFile(path.join(root, ".env"));

const config = {
  port: Number(process.env.PORT || 8080),
  host: process.env.HOST || "0.0.0.0",
  apiKey: process.env.OPENAI_API_KEY || "",
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  baseUrl: (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
  mock: process.env.MOCK_AI === "true",
  supabaseUrl: (process.env.SUPABASE_URL || "").replace(/\/+$/, ""),
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeMonthlyPrice: process.env.STRIPE_PRICE_MONTHLY || "",
  stripeYearlyPrice: process.env.STRIPE_PRICE_YEARLY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 8080}`,
  freeChecks: Math.max(0, Number(process.env.FREE_CHECKS || 3)),
};

const MAX_BODY_BYTES = 1_500_000;
// ~15k tokens: comfortably inside small-model context windows and keeps cost predictable.
const MAX_AI_CHARS = 60_000;
const UPSTREAM_TIMEOUT_MS = 45_000;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

/* ---------- Static files ---------- */
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
// Server-side files that live next to the public assets but must never be served.
const privateFiles = new Set(["server.js", "package.json", "package-lock.json"]);

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const send = (response, status, body, type = "text/plain; charset=utf-8", extraHeaders = {}) => {
  response.writeHead(status, { ...securityHeaders, "Content-Type": type, ...extraHeaders });
  response.end(body);
};

const sendJson = (response, status, payload, extraHeaders = {}) =>
  send(response, status, JSON.stringify(payload), "application/json; charset=utf-8", { "Cache-Control": "no-store", ...extraHeaders });

const serveFile = (request, response, pathname) => {
  let requestedPath;
  try {
    requestedPath = decodeURIComponent(pathname);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
  const segments = relativePath.split(/[\\/]/);
  const extension = path.extname(relativePath).toLowerCase();
  const filePath = path.resolve(root, relativePath);

  // Block dotfiles (.env, .git, .idea), server code, unknown types and path traversal.
  if (
    segments.some((segment) => segment.startsWith(".")) ||
    privateFiles.has(segments[segments.length - 1]) ||
    !contentTypes[extension] ||
    !filePath.startsWith(root + path.sep)
  ) {
    send(response, 404, "Not found");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      const missing = error.code === "ENOENT" || error.code === "EISDIR";
      send(response, missing ? 404 : 500, missing ? "Not found" : "Unable to read file");
      return;
    }
    send(response, 200, request.method === "HEAD" ? undefined : content, contentTypes[extension], { "Cache-Control": "no-cache" });
  });
};

/* ---------- Request helpers ---------- */
const parseJsonBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error("Document text is too large. Try a shorter excerpt."), { status: 413 }));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => {
    try {
      // Concatenate buffers before decoding so multi-byte characters split across chunks survive.
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
    }
  });
  request.on("error", reject);
});

const readRawBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  let size = 0;
  request.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
      request.destroy();
      return;
    }
    chunks.push(chunk);
  });
  request.on("end", () => resolve(Buffer.concat(chunks)));
  request.on("error", reject);
});
const authConfigured = () => Boolean(config.supabaseUrl && config.supabaseAnonKey && config.supabaseServiceKey);
const billingConfigured = () => Boolean(config.stripeSecretKey && config.stripeMonthlyPrice && config.stripeYearlyPrice && config.stripeWebhookSecret);
const getUser = async (request) => {
  if (!authConfigured()) return null;
  const token = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const result = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` },
  });
  return result.ok ? result.json() : null;
};
const supabaseRequest = async (pathName, options = {}) => fetch(`${config.supabaseUrl}${pathName}`, {
  ...options,
  headers: { apikey: config.supabaseServiceKey, Authorization: `Bearer ${config.supabaseServiceKey}`, "Content-Type": "application/json", ...(options.headers || {}) },
});
const consumeCheck = async (userId) => {
  const result = await supabaseRequest("/rest/v1/rpc/use_check", { method: "POST", body: JSON.stringify({ uid: userId, free_limit: config.freeChecks }) });
  return result.ok && (await result.json()) === true;
};
const refundCheck = async (userId) => {
  await supabaseRequest("/rest/v1/rpc/refund_check", { method: "POST", body: JSON.stringify({ uid: userId }) });
};
const getProfile = async (userId) => {
  const result = await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=plan,checks_used,stripe_customer_id`, { headers: { Prefer: "return=representation" } });
  const rows = result.ok ? await result.json() : [];
  const profile = rows[0] || { plan: "free", checks_used: 0 };
  return { plan: profile.plan, checksUsed: Number(profile.checks_used) || 0, stripeCustomerId: profile.stripe_customer_id || "", remainingChecks: profile.plan === "personal" ? null : Math.max(0, config.freeChecks - (Number(profile.checks_used) || 0)) };
};

const rateBuckets = new Map();
const isRateLimited = (request) => {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const key = forwarded || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_LIMIT.windowMs) {
    rateBuckets.set(key, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT.max;
};
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (now - bucket.start > RATE_LIMIT.windowMs) rateBuckets.delete(key);
}, RATE_LIMIT.windowMs).unref();

/* ---------- Analysis ---------- */
const SEVERITIES = ["High", "Medium", "Low"];
const asText = (value, max = 600) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// Never trust model output shape: coerce every field to what the client renders.
const normalizeAnalysis = (raw) => {
  if (!raw || typeof raw !== "object") return null;
  const summary = (Array.isArray(raw.summary) ? raw.summary : []).map((item) => asText(item)).filter(Boolean).slice(0, 6);
  const redFlags = (Array.isArray(raw.redFlags) ? raw.redFlags : [])
    .filter((flag) => flag && typeof flag === "object")
    .map((flag, index) => ({
      id: asText(flag.id, 80) || "flag-" + index,
      severity: SEVERITIES.includes(flag.severity) ? flag.severity : "Low",
      title: asText(flag.title, 120) || "Review this clause",
      financialImpactDollars: Number.isFinite(Number(flag.financialImpactDollars)) && Number(flag.financialImpactDollars) >= 0 ? Math.round(Number(flag.financialImpactDollars) * 100) / 100 : 0,
      verbatimQuote: asText(flag.verbatimQuote, 700),
      whyItHurts: asText(flag.whyItHurts || flag.why) || "Ask a qualified professional to review this language.",
      proposedCounterClause: asText(flag.proposedCounterClause, 800) || "Please clarify or revise this clause in writing.",
    }))
    .slice(0, 12);
  const obligations = (Array.isArray(raw.obligations) ? raw.obligations : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ amount: asText(String(item.amount ?? ""), 40), description: asText(item.description, 240), note: asText(item.note, 240) }))
    .slice(0, 20);
  if (!summary.length && !redFlags.length) return null;
  const caught = Number(raw.potentialCaughtDollars);
  return {
    summary,
    redFlags,
    obligations,
    counterScript: asText(raw.counterScript, 4000),
    potentialCaughtDollars: Number.isFinite(caught) && caught >= 0 ? Math.round(caught * 100) / 100 : 0,
  };
};

const createMockAnalysis = (text) => {
  const amounts = [...text.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
  const rules = [
    [/auto[- ]?renew|automatically renew/i, "High", "Automatic renewal", "A missed notice deadline could lock you into another term."],
    [/late fee|late charge/i, "Medium", "Late fee", "A short payment delay can create an additional charge."],
    [/non-?refundable/i, "Medium", "Non-refundable payment", "This payment may not be returned if your plans change."],
  ];
  const redFlags = rules.filter(([pattern]) => pattern.test(text)).map(([, severity, title, why]) => ({ severity, title, why }));
  return {
    summary: [
      "This is a mock response for testing the FlowDoc AI result pipeline.",
      `The document contains ${amounts.length} dollar amount${amounts.length === 1 ? "" : "s"}.`,
      redFlags.length ? `${redFlags.length} common clause risk${redFlags.length === 1 ? "" : "s"} matched the sample rules.` : "No mock red-flag rules matched this text.",
    ],
    obligations: amounts.map((amount) => ({ amount: `$${amount.toFixed(2)}`, description: "Dollar amount found in the document", note: "Mock extraction; verify against the original." })),
    redFlags: redFlags.length ? redFlags : [{ severity: "Low", title: "No mock rule matched", why: "A real model or professional review may still identify context-specific issues." }],
    counterScript: "Subject: Questions about the agreement\n\nHi,\n\nI would like to clarify the fees, deadlines, and renewal terms before signing. Please send a revised copy with each obligation stated plainly.\n\nThank you,\n[Your name]",
    potentialCaughtDollars: 0,
  };
};

const SYSTEM_PROMPT = `You are FlowDoc AI, a careful US consumer-protection document reviewer. Analyze only the supplied document. Do not invent facts or claim an outcome is definitely illegal. Use natural American English and explain risks plainly.
Return ONLY valid JSON with exactly these keys:
For each red flag, verbatimQuote must be an exact contiguous substring copied from the supplied document. Omit an issue if an exact quote cannot support it, and use 0 when no dollar impact can be calculated.
- summary: array of 3-4 concise strings
- obligations: array of objects { amount, description, note }
- redFlags: array of objects { id, severity: "High" | "Medium" | "Low", title, financialImpactDollars, verbatimQuote, whyItHurts, proposedCounterClause }
- counterScript: a practical, copyable email string
- potentialCaughtDollars: number
Identify dollar amounts, late fees, deposits, auto-renewals, penalties, arbitration or class-action waivers, unilateral changes, and one-sided legal terms. potentialCaughtDollars must be the sum of clearly stated avoidable fees or penalties, not rent, deposits, insurance limits, or ordinary purchase prices. Mention when a professional in the relevant state should review the clause.`;

const requestUpstreamAnalysis = async (text) => {
  const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    // Log details server-side; don't forward provider internals to the browser.
    console.error(`Upstream AI error ${upstream.status}:`, body.error?.message || body);
    throw Object.assign(new Error(upstream.status === 429 ? "The AI provider is rate limiting requests. Try again shortly." : "The AI provider rejected the request."), { status: 502 });
  }
  let parsed = null;
  try {
    parsed = JSON.parse(body.choices?.[0]?.message?.content ?? "");
  } catch {
    // handled below
  }
  const analysis = normalizeAnalysis(parsed);
  if (!analysis) throw Object.assign(new Error("The AI returned an unexpected analysis shape."), { status: 502 });
  return analysis;
};

const verifyStripeSignature = (rawBody, signature, secret, now = Math.floor(Date.now() / 1000)) => {
  const parts = Object.fromEntries(String(signature || "").split(",").map((part) => part.split("=", 2)));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300 || !parts.v1) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
};
const stripeRequest = async (endpoint, params) => fetch(`https://api.stripe.com/v1/${endpoint}`, {
  method: "POST",
  headers: { Authorization: `Bearer ${config.stripeSecretKey}`, "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(params),
});
const requireConfiguredUser = async (request, response) => {
  if (!authConfigured()) return { id: "demo-user", email: "demo@flowdoc.local" };
  const user = await getUser(request);
  if (!user) sendJson(response, 401, { error: "Sign in to use this feature." });
  return user;
};
const handleCheckout = async (request, response) => {
  if (!billingConfigured()) {
    sendJson(response, 503, { error: "Billing is not configured on this server. Demo mode is active." });
    return;
  }
  const user = await requireConfiguredUser(request, response);
  if (!user) return;
  try {
    const body = await parseJsonBody(request);
    const price = body?.interval === "year" ? config.stripeYearlyPrice : config.stripeMonthlyPrice;
    const result = await stripeRequest("checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      client_reference_id: user.id,
      customer_email: user.email || "",
      success_url: `${config.appUrl}/tools.html?paid=1`,
      cancel_url: `${config.appUrl}/pricing.html`,
    });
    const payload = await result.json().catch(() => ({}));
    sendJson(response, result.ok ? 200 : 502, result.ok ? { url: payload.url } : { error: "Payment service error." });
  } catch (error) {
    sendJson(response, error.status || 500, { error: error.message || "Checkout failed." });
  }
};
const handleBillingPortal = async (request, response) => {
  if (!billingConfigured()) return sendJson(response, 503, { error: "Billing is not configured on this server." });
  const user = await requireConfiguredUser(request, response);
  if (!user) return;
  const profile = await getProfile(user.id);
  if (!profile.stripeCustomerId) return sendJson(response, 400, { error: "No billing customer is linked to this account." });
  const result = await stripeRequest("billing_portal/sessions", { customer: profile.stripeCustomerId, return_url: `${config.appUrl}/tools.html` });
  const payload = await result.json().catch(() => ({}));
  sendJson(response, result.ok ? 200 : 502, result.ok ? { url: payload.url } : { error: "Billing portal error." });
};
const handleStripeWebhook = async (request, response) => {
  if (!config.stripeWebhookSecret) return sendJson(response, 503, { error: "Stripe webhooks are not configured." });
  try {
    const raw = await readRawBody(request);
    if (!verifyStripeSignature(raw.toString("utf8"), request.headers["stripe-signature"], config.stripeWebhookSecret)) return sendJson(response, 400, { error: "Invalid Stripe signature." });
    const event = JSON.parse(raw.toString("utf8"));
    const object = event.data?.object || {};
    if (event.type === "checkout.session.completed" && object.client_reference_id) {
      await supabaseRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(object.client_reference_id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ plan: "personal", stripe_customer_id: object.customer }) });
    } else if (["customer.subscription.deleted", "customer.subscription.updated"].includes(event.type) && object.customer) {
      const active = ["active", "trialing"].includes(object.status);
      await supabaseRequest(`/rest/v1/profiles?stripe_customer_id=eq.${encodeURIComponent(object.customer)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ plan: active ? "personal" : "free" }) });
    }
    sendJson(response, 200, { received: true });
  } catch (error) {
    sendJson(response, error.status || 400, { error: error.message || "Webhook processing failed." });
  }
};

const analyzeContract = async (request, response) => {
  if (isRateLimited(request)) {
    sendJson(response, 429, { error: "Too many reviews in a short time. Please wait a minute." }, { "Retry-After": "60" });
    return;
  }
  try {
    const user = await requireConfiguredUser(request, response);
    if (!user) return;
    const body = await parseJsonBody(request);
    const fullText = typeof body?.text === "string" ? body.text.trim() : "";
    if (!fullText) {
      sendJson(response, 400, { error: "Document text is required." });
      return;
    }
    const text = fullText.slice(0, MAX_AI_CHARS);
    const truncated = fullText.length > MAX_AI_CHARS;
    const charged = authConfigured() ? await consumeCheck(user.id) : false;
    if (authConfigured() && !charged) {
      sendJson(response, 402, { error: "Your free checks are used. Choose a paid plan to continue." });
      return;
    }

    if (config.mock) {
      sendJson(response, 200, { mode: "mock", truncated, analysis: normalizeAnalysis(createMockAnalysis(text)) });
      return;
    }
    if (!config.apiKey) {
      sendJson(response, 503, { error: "AI is not configured on this server." });
      return;
    }
    const analysis = await requestUpstreamAnalysis(text);
    sendJson(response, 200, { mode: "live", truncated, analysis });
  } catch (error) {
    if (authConfigured() && error.status !== 402) {
      const tokenUser = await getUser(request).catch(() => null);
      if (tokenUser) await refundCheck(tokenUser.id).catch(() => {});
    }
    const timedOut = error.name === "TimeoutError" || error.name === "AbortError";
    if (!error.status && !timedOut) console.error("Analysis failed:", error);
    sendJson(response, timedOut ? 504 : error.status || 500, {
      error: timedOut ? "The AI review took too long. Try a shorter excerpt." : error.status ? error.message : "AI analysis failed.",
    });
  }
};

/* ---------- Router ---------- */
const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  if (pathname === "/api/analyze-contract") {
    if (request.method === "POST") analyzeContract(request, response);
    else sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
  } else if (pathname === "/api/config") {
    if (request.method === "GET") sendJson(response, 200, { auth: authConfigured(), billing: billingConfigured(), freeChecks: config.freeChecks });
    else sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
  } else if (pathname === "/api/me") {
    if (request.method !== "GET") sendJson(response, 405, { error: "Method not allowed" }, { Allow: "GET" });
    else getUser(request).then(async (user) => {
      if (!user) return sendJson(response, authConfigured() ? 401 : 200, authConfigured() ? { error: "Sign in required." } : { demo: true, plan: "free", remainingChecks: null });
      const profile = await getProfile(user.id);
      sendJson(response, 200, { user: { id: user.id, email: user.email }, ...profile });
    }).catch(() => sendJson(response, 502, { error: "Account service unavailable." }));
  } else if (pathname === "/api/checkout") {
    if (request.method === "POST") handleCheckout(request, response);
    else sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
  } else if (pathname === "/api/billing-portal") {
    if (request.method === "POST") handleBillingPortal(request, response);
    else sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
  } else if (pathname === "/api/stripe-webhook") {
    if (request.method === "POST") handleStripeWebhook(request, response);
    else sendJson(response, 405, { error: "Method not allowed" }, { Allow: "POST" });
  } else if (pathname === "/api/health") {
    sendJson(response, 200, { ok: true, ai: config.mock ? "mock" : config.apiKey ? "live" : "unconfigured", auth: authConfigured(), billing: billingConfigured() });
  } else if (request.method === "GET" || request.method === "HEAD") {
    serveFile(request, response, pathname);
  } else {
    send(response, 405, "Method not allowed", undefined, { Allow: "GET, HEAD" });
  }
});

server.listen(config.port, config.host, () => {
  const mode = config.mock ? "mock AI" : config.apiKey ? `live AI (${config.model})` : "AI not configured";
  console.log(`FlowDoc server listening on http://localhost:${config.port} · ${mode}`);
});
