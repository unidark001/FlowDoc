export const requestStructuredAudit = async (text, signal) => {
  const token = localStorage.getItem("flowdoc_access_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch("/api/analyze-contract", { method: "POST", headers, body: JSON.stringify({ text }), signal });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error("Sign in to use AI deep review.");
  if (response.status === 402) throw new Error("Free AI checks used. Upgrade at pricing.html for unlimited AI reviews.");
  if (!response.ok || !payload.analysis) throw new Error(payload.error || `AI service returned HTTP ${response.status}.`);
  return payload;
};
