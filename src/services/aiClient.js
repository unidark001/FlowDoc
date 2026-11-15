export const requestStructuredAudit = async (text, signal) => {
  const token = localStorage.getItem("flowdoc_access_token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch("/api/analyze-contract", { method: "POST", headers, body: JSON.stringify({ text }), signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.analysis) throw new Error(payload.error || `AI service returned HTTP ${response.status}.`);
  return payload;
};
