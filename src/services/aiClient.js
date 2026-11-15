export const requestStructuredAudit = async (text, signal) => {
  const response = await fetch("/api/analyze-contract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.analysis) throw new Error(payload.error || `AI service returned HTTP ${response.status}.`);
  return payload;
};
