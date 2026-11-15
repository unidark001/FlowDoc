const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const maxBodyBytes = 1_500_000;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const send = (response, status, body, type = "text/plain; charset=utf-8") => {
  response.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  response.end(body);
};

const parseBody = (request) => new Promise((resolve, reject) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) {
      reject(new Error("Document text is too large for this preview endpoint."));
      request.destroy();
    }
  });
  request.on("end", () => {
    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error("Request body must be valid JSON."));
    }
  });
  request.on("error", reject);
});

const createMockAnalysis = (text) => {
  const amounts = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
  const redFlags = [];
  if (/auto[- ]?renew|automatically renew/i.test(text)) redFlags.push({ severity: "High", title: "Automatic renewal", why: "A missed notice deadline could lock you into another term." });
  if (/late fee|late charge/i.test(text)) redFlags.push({ severity: "Medium", title: "Late fee", why: "A short payment delay can create an additional charge." });
  if (/non-refundable|nonrefundable/i.test(text)) redFlags.push({ severity: "Medium", title: "Non-refundable payment", why: "This payment may not be returned if your plans change." });
  return {
    summary: [
      "This is a mock response for testing the FlowDoc AI result pipeline.",
      `The document contains ${amounts.length} dollar amount${amounts.length === 1 ? "" : "s"}.`,
      redFlags.length ? `${redFlags.length} common clause risk${redFlags.length === 1 ? "" : "s"} matched the sample rules.` : "No mock red-flag rules matched this text.",
    ],
    obligations: amounts.map((amount) => ({ amount: `$${amount.toFixed(2)}`, description: "Dollar amount found in the document", note: "Mock extraction; verify against the original." })),
    redFlags: redFlags.length ? redFlags : [{ severity: "Low", title: "No mock rule matched", why: "A real model or professional review may still identify context-specific issues." }],
    counterScript: "Subject: Questions about the agreement\n\nHi,\n\nI would like to clarify the fees, deadlines, and renewal terms before signing. Please send a revised copy with each obligation stated plainly.\n\nThank you,\n[Your name]",
    potentialCaughtDollars: amounts.filter((amount) => amount > 0 && amount <= 500).reduce((total, amount) => total + amount, 0),
  };
};

const analyzeContract = async (request, response) => {
  if (process.env.MOCK_AI === "true") {
    try {
      const body = await parseBody(request);
      if (typeof body.text !== "string" || !body.text.trim()) {
        send(response, 400, JSON.stringify({ error: "Document text is required." }), "application/json; charset=utf-8");
        return;
      }
      send(response, 200, JSON.stringify({ mode: "mock", analysis: createMockAnalysis(body.text) }), "application/json; charset=utf-8");
    } catch (error) {
      send(response, 400, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    send(response, 503, JSON.stringify({ error: "AI is not configured. Set OPENAI_API_KEY before starting the server." }), "application/json; charset=utf-8");
    return;
  }
  try {
    const body = await parseBody(request);
    if (typeof body.text !== "string" || !body.text.trim()) {
      send(response, 400, JSON.stringify({ error: "Document text is required." }), "application/json; charset=utf-8");
      return;
    }
    const endpoint = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const upstream = await fetch(`${endpoint.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are FlowDoc AI, a careful US consumer-protection document reviewer. Analyze only the supplied document. Do not invent facts or claim an outcome is definitely illegal. Use natural American English and explain risks plainly. Return ONLY valid JSON with exactly these keys: summary (array of 3-4 concise strings), obligations (array of objects with amount, description, note), redFlags (array of objects with severity limited to High, Medium, or Low, title, why), counterScript (a practical copyable email string), potentialCaughtDollars (number). Identify dollar amounts, late fees, deposits, auto-renewals, penalties, arbitration or class-action waivers, unilateral changes, and one-sided legal terms. potentialCaughtDollars must be the sum of clearly stated avoidable fees or penalties, not rent, deposits, insurance limits, or ordinary purchase prices. Mention when a professional in the relevant state should review the clause.`,
          },
          { role: "user", content: body.text.slice(0, 1_200_000) },
        ],
      }),
    });
    const upstreamBody = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      send(response, 502, JSON.stringify({ error: upstreamBody.error?.message || `Upstream AI returned HTTP ${upstream.status}.` }), "application/json; charset=utf-8");
      return;
    }
    const content = upstreamBody.choices?.[0]?.message?.content;
    const analysis = typeof content === "string" ? JSON.parse(content) : null;
    if (!analysis || !Array.isArray(analysis.summary) || !Array.isArray(analysis.redFlags)) {
      send(response, 502, JSON.stringify({ error: "The AI returned an unexpected analysis shape." }), "application/json; charset=utf-8");
      return;
    }
    send(response, 200, JSON.stringify({ analysis }), "application/json; charset=utf-8");
  } catch (error) {
    send(response, 500, JSON.stringify({ error: error.message || "AI analysis failed." }), "application/json; charset=utf-8");
  }
};

const serveFile = (request, response) => {
  const requestedPath = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root + path.sep)) {
    send(response, 403, "Forbidden");
    return;
  }
  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(response, error.code === "ENOENT" ? 404 : 500, error.code === "ENOENT" ? "Not found" : "Unable to read file");
      return;
    }
    send(response, 200, content, contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
};

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/analyze-contract") {
    analyzeContract(request, response);
  } else if (request.method === "GET") {
    serveFile(request, response);
  } else {
    send(response, 405, "Method not allowed");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`FlowDoc server listening on http://0.0.0.0:${port}`);
});
