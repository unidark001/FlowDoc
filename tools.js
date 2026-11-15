import { analyzeContract, makeCounterScript, normalizeDocumentText, preprocessOcrCanvas, stripRepeatedPageChrome } from "./src/utils/contractAnalyzer.js";
import { normalizeBankCsv } from "./src/utils/csvNormalizer.js";
import { classifyTransactions, calculateScheduleC, detectRecurringSaas } from "./src/utils/scheduleCEngine.js";
import { requestStructuredAudit } from "./src/services/aiClient.js";

const SAMPLE_LEASE = "RESIDENTIAL LEASE AGREEMENT\nMonthly rent is $2,150. A late fee of $125 applies after the third day. Tenant will pay a $2,150 security deposit and a non-refundable $350 move-in fee. Tenant pays a $65 monthly amenity fee. Unless Tenant provides written notice 60 days before the end date, this lease automatically renews for another 12-month term. Tenant is responsible for the first $200 of every repair call, including repairs not caused by Tenant. Tenant waives class-action rights, agrees to binding arbitration, and agrees to pay Landlord's attorney fees.";
const SAMPLE_CSV = "Transaction Date,Description,Amount\n2025-10-01,POS COMCAST INTERNET KANSAS CITY MO,-119.99\n2025-10-02,Client payment Studio North,2400.00\n2025-10-03,ADOBE*294810 SAN JOSE CA,-59.99\n2025-10-05,Trader Joe's,-86.42\n2025-10-07,UBER TRIP,-42.80\n2025-10-10,APPLE.COM/BILL,-249.00\n2025-10-12,STARBUCKS STORE #0419,-18.75\n2025-10-15,DELTA AIR LINES,-386.40\n2025-10-18,AT&T WIRELESS,-92.00\n2025-10-22,UBER EATS,-31.40\n2025-10-25,CANVA PRO,-15.00\n2025-11-03,ADOBE*294811 SAN JOSE CA,-59.99\n2025-11-25,CANVA PRO,-15.00";
const $ = (selector, scope = document) => scope.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[c]);
const plural = (count, word) => String(count) + " " + word + (count === 1 ? "" : "s");
const setStatus = (selector, value, tone = "") => { const node = $(selector); if (node) { node.textContent = value; node.dataset.tone = tone; } };
const reveal = (panel) => { panel?.focus({ preventScroll: true }); if (matchMedia("(max-width: 900px)").matches) panel?.scrollIntoView({ behavior: "smooth", block: "start" }); };

const STORAGE_KEY = "flowdoc-vault";
const emptyVault = () => ({ contractSavings: 0, taxSavings: 0, reports: [], checkins: {} });
let vault; try { vault = { ...emptyVault(), ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") }; } catch { vault = emptyVault(); }
const saveReport = (type, label, savings) => { vault.reports = [...vault.reports.filter((item) => item.type !== type), { type, label, savings, date: new Date().toISOString() }]; };
const renderVault = () => {
  const total = money(vault.contractSavings + vault.taxSavings);
  document.querySelectorAll("[data-vault-total]").forEach((node) => { node.textContent = total; });
  $("#saved-report-count").textContent = String(vault.reports.length);
  $("#saved-report-list").innerHTML = vault.reports.map((item) => "<li><span>" + escapeHtml(item.label) + "</span><small>" + money(item.savings) + "</small></li>").join("");
  document.querySelectorAll("[data-checkin]").forEach((input) => { input.checked = Boolean(vault.checkins[input.dataset.checkin]); });
};
const saveVault = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(vault)); } catch {} renderVault(); };

const loadedScripts = new Map();
const loadScript = (src) => {
  if (!loadedScripts.has(src)) loadedScripts.set(src, new Promise((resolve, reject) => {
    const tag = document.createElement("script"); tag.src = src; tag.async = true; tag.onload = resolve; tag.onerror = () => reject(new Error("The document reader could not be downloaded."));
    document.head.append(tag);
  }));
  return loadedScripts.get(src);
};
const readPdf = async (file) => {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    setStatus("#contract-status", "Reading page " + i + " of " + pdf.numPages + "…", "busy");
    const content = await (await pdf.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => item.str).join("\n"));
  }
  return normalizeDocumentText(stripRepeatedPageChrome(pages));
};
const readImage = async (file) => {
  setStatus("#contract-status", "Enhancing image for OCR…", "busy");
  const image = await preprocessOcrCanvas(file);
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js");
  const result = await window.Tesseract.recognize(image, "eng", { logger: (event) => { if (event.status === "recognizing text") setStatus("#contract-status", "Reading image… " + Math.round(event.progress * 100) + "%", "busy"); } });
  return normalizeDocumentText(result.data.text);
};

const contractText = $("#contract-text");
const contractResults = $("#contract-results");
const updateCount = () => { $("#contract-count").textContent = contractText.value.length.toLocaleString("en-US") + " characters"; };
const mergedAudit = (deterministic, ai) => {
  if (!ai?.redFlags?.length) return deterministic;
  const flags = ai.redFlags.map((item, index) => ({
    ...item, id: item.id || "ai-" + index,
    verbatimQuote: item.verbatimQuote && deterministic.terms.text.includes(item.verbatimQuote) ? item.verbatimQuote : deterministic.redFlags[index]?.verbatimQuote || "Verify this clause in the original document.",
    whyItHurts: item.whyItHurts || item.why || "Review the financial and legal impact before agreeing.",
    proposedCounterClause: item.proposedCounterClause || deterministic.redFlags[index]?.proposedCounterClause || "Please clarify this term in writing.",
    financialImpactDollars: Number(item.financialImpactDollars) || 0,
  }));
  return { ...deterministic, redFlags: flags, summary: ai.summary?.length ? ai.summary : deterministic.summary, potentialCaughtDollars: flags.reduce((total, item) => total + item.financialImpactDollars, 0) || deterministic.potentialCaughtDollars };
};
const renderContract = (analysis, mode, notice = "") => {
  const flags = analysis.redFlags || [];
  const flagHtml = flags.map((item) => "<article class=\"flag-card\"><label class=\"flag-select\"><input type=\"checkbox\" data-flag=\"" + escapeHtml(item.id) + "\" checked><span></span></label><div><button class=\"evidence-button\" type=\"button\" data-evidence=\"" + escapeHtml(item.id) + "\"><span class=\"severity severity-" + item.severity.toLowerCase() + "\">" + escapeHtml(item.severity) + "</span> " + escapeHtml(item.title) + "</button><p>" + escapeHtml(item.whyItHurts) + "</p><blockquote>" + escapeHtml(item.verbatimQuote) + "</blockquote></div></article>").join("");
  const amounts = analysis.terms.amounts.map((item) => "<li><strong>" + money(item.value) + "</strong><span>" + escapeHtml(item.quote) + "</span></li>").join("") || "<li>No amounts extracted.</li>";
  contractResults.innerHTML = "<div class=\"result-header\"><div><p class=\"eyebrow\">Hybrid evidence audit</p><h3>Here’s what deserves a second look.</h3></div><span class=\"result-count\">" + analysis.riskScore + "/100 risk</span></div>" +
    "<p class=\"ai-status " + (mode === "local" ? "ai-local" : "") + "\">" + (mode === "local" ? "◇ Deterministic on-device audit" : "✦ Structured AI deep audit + deterministic metrics") + "</p>" +
    (notice ? "<p class=\"ai-status ai-error\">" + escapeHtml(notice) + "</p>" : "") +
    "<div class=\"metric-grid\"><div><span>True annualized cost</span><strong>" + money(analysis.trueAnnualizedCost) + "</strong><small>" + money(analysis.hiddenAnnualCost) + " above headline</small></div><div><span>Headline annual rent</span><strong>" + money(analysis.headlineAnnualCost) + "</strong><small>Base rent × 12</small></div><div><span>Identified exposure</span><strong>" + money(analysis.potentialCaughtDollars) + "</strong><small>Selected terms below</small></div></div>" +
    "<div class=\"result-card\"><h4>Plain-English TL;DR</h4><ul>" + analysis.summary.map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul></div>" +
    "<div class=\"result-card\"><h4>Red flags — select what to negotiate</h4><div class=\"flag-list\">" + flagHtml + "</div></div><details class=\"result-card result-details\"><summary><h4>Financial figures extracted</h4><span>" + plural(analysis.terms.amounts.length, "figure") + "</span></summary><ul class=\"amount-list\">" + amounts + "</ul></details>" +
    "<div class=\"result-card script-card\"><div class=\"card-title-row\"><h4>Tailored negotiation counter-script</h4><button class=\"copy-button\" type=\"button\" data-copy-script>Copy</button></div><pre data-counter-script></pre></div><p class=\"disclaimer\">Educational screening, not legal advice. State rules and facts matter.</p>";
  const updateScript = () => { const selected = [...contractResults.querySelectorAll("[data-flag]:checked")].map((input) => input.dataset.flag); $("[data-counter-script]", contractResults).textContent = makeCounterScript(analysis, selected); };
  updateScript();
  contractResults.addEventListener("change", (event) => { if (event.target.matches("[data-flag]")) updateScript(); });
  contractResults.querySelectorAll("[data-evidence]").forEach((button) => button.addEventListener("click", () => {
    const quote = flags.find((item) => item.id === button.dataset.evidence)?.verbatimQuote; const index = contractText.value.indexOf(quote?.slice(0, 70));
    if (index >= 0) { contractText.focus(); contractText.setSelectionRange(index, index + quote.length); }
  }));
  $("[data-copy-script]", contractResults).addEventListener("click", async (event) => { const button = event.currentTarget; try { await navigator.clipboard.writeText($("[data-counter-script]", contractResults).textContent); button.textContent = "Copied ✓"; } catch { button.textContent = "Select and copy"; } setTimeout(() => { button.textContent = "Copy"; }, 1800); });
  vault.contractSavings = analysis.potentialCaughtDollars; saveReport("contract", "Contract audit", vault.contractSavings); saveVault();
};
let auditController;
$("#audit-contract").addEventListener("click", async () => {
  const text = contractText.value.trim();
  if (!text) { setStatus("#contract-status", "Add a document, paste text, or load the sample lease first.", "error"); return; }
  const deterministic = analyzeContract(text);
  if (!$("#use-ai").checked) { renderContract(deterministic, "local"); setStatus("#contract-status", "Deterministic audit complete.", "success"); reveal(contractResults); return; }
  auditController?.abort(); auditController = new AbortController(); const button = $("#audit-contract"); button.disabled = true; button.querySelector("span").textContent = "Reviewing…";
  try { const payload = await requestStructuredAudit(text, auditController.signal); renderContract(mergedAudit(deterministic, payload.analysis), "ai", payload.truncated ? "AI reviewed the first portion; deterministic metrics use the complete text." : ""); setStatus("#contract-status", "Deep audit complete.", "success"); }
  catch (error) { if (error.name !== "AbortError") { renderContract(deterministic, "local", "AI review unavailable: " + error.message + ". The full on-device audit is shown."); setStatus("#contract-status", "On-device audit complete; AI was unavailable.", "error"); } }
  finally { button.disabled = false; button.querySelector("span").textContent = "Audit document"; } reveal(contractResults);
});
const processContractFile = async (file) => {
  if (!file) return;
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name); const isImage = /^image\/(png|jpe?g)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);
  if (!isPdf && !isImage) return setStatus("#contract-status", "Use a PDF, PNG or JPG document.", "error");
  if (file.size > 25 * 1024 * 1024) return setStatus("#contract-status", "That file is over 25 MB. Try a smaller file.", "error");
  try { contractText.value = isPdf ? await readPdf(file) : await readImage(file); updateCount(); setStatus("#contract-status", file.name + " is ready; page markers and OCR cleanup were applied.", "success"); } catch (error) { setStatus("#contract-status", error.message || "We couldn't read that file.", "error"); }
};
$("#contract-file").addEventListener("change", (event) => { processContractFile(event.target.files[0]); event.target.value = ""; });
$("#sample-lease").addEventListener("click", () => { contractText.value = SAMPLE_LEASE; updateCount(); setStatus("#contract-status", "Sample lease loaded.", "success"); });
$("#clear-contract").addEventListener("click", () => { contractText.value = ""; updateCount(); contractText.focus(); }); contractText.addEventListener("input", updateCount);

/* Schedule C */
let transactions = []; let normalization;
const taxResults = $("#tax-results");
const taxOptions = () => ({ bracket: Number($("#tax-rate").value), qbi: $("#qbi-toggle").checked, homeOffice: $("#home-office-toggle").checked, squareFeet: $("#home-office-sqft").value });
const computeTax = () => calculateScheduleC(transactions, taxOptions());
const updateTaxSummary = () => {
  const result = computeTax(); $("[data-tax-deductible]", taxResults).textContent = money(result.deductible); $("[data-tax-savings]", taxResults).textContent = money(result.totalSavings);
  $("[data-tax-rate-note]", taxResults).textContent = money(result.seSavings) + " SE + " + money(result.federalSavings) + " federal" + (taxOptions().qbi ? " + " + money(result.qbiSavings) + " QBI" : "");
  $("[data-tax-count]", taxResults).textContent = result.eligible.length + " eligible expenses · audit risk: " + result.auditRisk;
  $(".bucket-list", taxResults).innerHTML = Object.values(result.byLine).map((item) => "<span>" + escapeHtml(item.line) + " · " + escapeHtml(item.label) + "<strong>" + money(item.deductible) + "</strong></span>").join("") || "<span>Choose qualifying business expenses to create a Schedule C grouping.</span>";
  $("[data-audit-risk]", taxResults).innerHTML = result.warnings.length ? "<strong>" + result.auditRisk + " audit-risk review</strong><ul>" + result.warnings.map((item) => "<li>" + escapeHtml(item) + "</li>").join("") + "</ul>" : "<strong>Healthy audit-risk range</strong><p>No high ratio was detected from the income deposits available in this CSV.</p>";
  vault.taxSavings = result.totalSavings; saveReport("tax", "Schedule C estimate", result.totalSavings); saveVault();
};
const renderTax = () => {
  const recurring = detectRecurringSaas(transactions);
  const rows = transactions.map((item, index) => "<tr class=\"" + (item.business ? "" : "is-personal") + "\"><td>" + escapeHtml(item.date) + "</td><td><strong>" + escapeHtml(item.description) + "</strong><small>" + escapeHtml(item.lineNumber ? item.lineNumber + " · " + item.category : item.confidence) + (item.recurring ? " · recurring SaaS" : "") + "</small></td><td class=\"num\">" + money(item.amount) + "</td><td><span class=\"confidence\">" + escapeHtml(item.confidence) + "</span></td><td><label class=\"switch\"><input type=\"checkbox\" data-business=\"" + index + "\"" + (item.business ? " checked" : "") + "><span></span></label></td><td><span class=\"percent-field\"><input class=\"percent-input\" data-percent=\"" + index + "\" type=\"number\" min=\"0\" max=\"100\" step=\"5\" value=\"" + item.percentage + "\"" + (item.business ? "" : " disabled") + ">%</span></td></tr>").join("");
  taxResults.innerHTML = "<div class=\"tax-summary\"><div><span>Schedule C deductible</span><strong data-tax-deductible>$0.00</strong><small data-tax-count></small></div><div class=\"savings-highlight\"><span>Estimated tax savings</span><strong data-tax-savings>$0.00</strong><small data-tax-rate-note></small></div></div><div class=\"bucket-list\"></div>" + (recurring.length ? "<p class=\"recurring-note\">Recurring SaaS detected: " + escapeHtml(recurring.join(", ")) + "</p>" : "") + "<div class=\"audit-meter\" data-audit-risk></div><div class=\"table-wrap\"><table><thead><tr><th>Date</th><th>Clean merchant / IRS mapping</th><th class=\"num\">Amount</th><th>Confidence</th><th>Business</th><th>Use %</th></tr></thead><tbody>" + rows + "</tbody></table></div><div class=\"export-row\"><button class=\"specular-button tool-action\" id=\"export-csv\" type=\"button\"><span>Download CPA-ready Schedule C CSV</span></button><span>Detected format: " + escapeHtml(normalization.detected.description) + " / " + escapeHtml(normalization.detected.amount) + "</span></div><p class=\"disclaimer\">Estimate only. Keep receipts and discuss filing treatment with a CPA.</p>";
  updateTaxSummary();
};
taxResults.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-business]")) { const item = transactions[Number(target.dataset.business)]; item.business = target.checked; item.confidence = target.checked && item.lineKey ? "High Confidence" : "Needs Review"; const row = target.closest("tr"); row.classList.toggle("is-personal", !item.business); $("[data-percent]", row).disabled = !item.business; }
  if (target.matches("[data-percent]")) { const value = Math.max(0, Math.min(100, Number(target.value) || 0)); transactions[Number(target.dataset.percent)].percentage = value; target.value = value; }
  updateTaxSummary();
});
const processCsvText = (text, label) => {
  try { normalization = normalizeBankCsv(text); transactions = classifyTransactions(normalization.transactions); setStatus("#csv-status", label + ": " + plural(transactions.length, "transaction") + " normalized; " + transactions.filter((item) => item.business).length + " high-confidence business matches.", "success"); renderTax(); reveal(taxResults); } catch (error) { setStatus("#csv-status", error.message, "error"); }
};
const processCsvFile = async (file) => { if (!file) return; if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) return setStatus("#csv-status", file.name + " isn't a CSV file.", "error"); processCsvText(await file.text(), file.name); };
$("#csv-file").addEventListener("change", (event) => { processCsvFile(event.target.files[0]); event.target.value = ""; }); $("#sample-csv").addEventListener("click", () => processCsvText(SAMPLE_CSV, "Sample US bank CSV"));
[$("#tax-rate"), $("#qbi-toggle"), $("#home-office-toggle"), $("#home-office-sqft")].forEach((input) => input.addEventListener("change", () => { $("#home-office-sqft").disabled = !$("#home-office-toggle").checked; if (transactions.length) updateTaxSummary(); }));
const csvCell = (value) => { let text = String(value ?? ""); if (/^[=+\-@\t\r]/.test(text)) text = "'" + text; return '"' + text.replace(/"/g, '""') + '"'; };
const exportTaxCsv = () => {
  const result = computeTax(); const lines = [["IRS Line Number", "Schedule C category", "Gross amount", "Business-use %", "Deductible amount", "Confidence notes"]];
  Object.values(result.byLine).forEach((item) => lines.push([item.line, item.label, item.gross.toFixed(2), item.line === "Line 30" ? "100" : "See transaction detail", item.deductible.toFixed(2), [...item.notes].join("; ")]));
  lines.push([], ["Summary", "Detected 1099 income deposits", result.incomeTotal.toFixed(2)], ["Summary", "Tax deduction", result.deductible.toFixed(2)], ["Summary", "Self-employment tax savings", result.seSavings.toFixed(2)], ["Summary", "Federal income tax savings", result.federalSavings.toFixed(2)]);
  const url = URL.createObjectURL(new Blob([lines.map((row) => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "flowdoc-schedule-c-" + new Date().toISOString().slice(0, 10) + ".csv"; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); vault.checkins["export-expenses"] = true; saveVault();
};
taxResults.addEventListener("click", (event) => { if (event.target.closest("#export-csv")) exportTaxCsv(); });

document.querySelectorAll("[data-drop-target]").forEach((zone) => {
  const target = zone.dataset.dropTarget; ["dragenter", "dragover"].forEach((name) => zone.addEventListener(name, (event) => { event.preventDefault(); zone.classList.add("is-dragging"); }));
  zone.addEventListener("dragleave", () => zone.classList.remove("is-dragging")); zone.addEventListener("drop", (event) => { event.preventDefault(); zone.classList.remove("is-dragging"); if (target === "contract-file") processContractFile(event.dataTransfer.files[0]); else processCsvFile(event.dataTransfer.files[0]); });
});
document.querySelectorAll("[data-checkin]").forEach((input) => input.addEventListener("change", () => { vault.checkins[input.dataset.checkin] = input.checked; saveVault(); }));
$("#reset-vault").addEventListener("click", () => { if (confirm("Clear your saved totals, reports and checklist from this device?")) { vault = emptyVault(); saveVault(); } });
renderVault(); updateCount();
