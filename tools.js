const STORAGE_KEY = "flowdoc-vault";
const SAMPLE_LEASE = `RESIDENTIAL LEASE AGREEMENT

This Residential Lease Agreement is between Harbor View Properties ("Landlord") and Jordan Lee ("Tenant") for 1458 W 19th Street, Unit 4B, Chicago, Illinois.

1. TERM AND RENT. The lease begins August 1, 2025 and ends July 31, 2026. Monthly rent is $2,150, due on the first day of each month. A late fee of $125 is charged if rent is not received by 5:00 PM on the third day. Rent increases by 8% upon renewal unless Landlord gives 30 days' notice.

2. DEPOSIT AND FEES. Tenant will pay a $2,150 security deposit and a non-refundable $350 move-in fee. If Tenant ends the lease early, Tenant owes an early termination charge equal to two months' rent plus the cost of re-leasing the unit. A $75 fee applies to each returned payment.

3. UTILITIES AND SERVICES. Tenant pays electricity, gas, water, and a $65 monthly technology and amenity fee. Landlord may change the technology fee with 15 days' notice. Tenant must keep renter's insurance with at least $100,000 liability coverage.

4. AUTO-RENEWAL. Unless Tenant provides written notice 60 days before the end date, this lease automatically renews for another 12-month term at the then-current rent.

5. MAINTENANCE AND ACCESS. Tenant is responsible for the first $200 of every repair call, including repairs not caused by Tenant. Landlord may enter with reasonable notice for inspection, repairs, or showings.

6. LEGAL TERMS. Tenant waives the right to participate in any class action against Landlord and agrees to pay Landlord's attorney fees in any dispute. This document is a summary for demonstration and does not replace advice from a qualified local attorney.`;

const SAMPLE_CSV = `Date,Description,Amount,Category
2025-10-01,Comcast Internet,119.99,Utilities
2025-10-03,Adobe Creative Cloud,59.99,Subscriptions
2025-10-05,Trader Joe's,86.42,Groceries
2025-10-07,Uber,42.80,Travel
2025-10-10,Apple Store - MacBook accessories,249.00,Shopping
2025-10-12,Starbucks,18.75,Restaurants
2025-10-15,Delta Airlines,386.40,Travel
2025-10-18,AT&T Wireless,92.00,Utilities
2025-10-20,Office Depot,74.62,Shopping
2025-10-22,Uber Eats,31.40,Restaurants
2025-10-25,Canva Pro,15.00,Subscriptions
2025-10-28,Target,64.18,Shopping`;

const vault = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"contractSavings":0,"taxSavings":0,"reports":[],"checkins":{}}');
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
const saveVault = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
  document.querySelectorAll("[data-vault-total]").forEach((element) => {
    element.textContent = money(vault.contractSavings + vault.taxSavings);
  });
  const count = document.querySelector("#saved-report-count");
  const copy = document.querySelector("#saved-report-copy");
  if (count) count.textContent = String(vault.reports.length);
  if (copy) copy.textContent = vault.reports.length ? "Saved locally on this device." : "Your analyzed documents and tax reports appear here.";
};
saveVault();

const setStatus = (selector, message) => {
  const element = document.querySelector(selector);
  if (element) element.textContent = message;
};

const contractResults = document.querySelector("#contract-results");
const renderContractResults = (text, aiAnalysis = null, aiError = "", aiMode = "live") => {
  const amountMatches = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((match) => Number(match[1].replace(/,/g, "")));
  const obligations = aiAnalysis?.obligations?.length
    ? aiAnalysis.obligations.map((obligation) => `<li><strong>${escapeHtml(obligation.amount || "Amount not specified")}</strong> ${escapeHtml(obligation.description || "")}${obligation.note ? `<small>${escapeHtml(obligation.note)}</small>` : ""}</li>`).join("")
    : amountMatches.length
    ? amountMatches.map((amount) => `<li><strong>${money(amount)}</strong> mentioned in the document</li>`).join("")
    : "<li>No dollar amounts found. Confirm the original document before signing.</li>";
  const rules = [
    { words: /auto[- ]?renew|automatically renew/i, severity: "High", title: "Automatic renewal", why: "You may be locked into another term unless you remember a notice deadline." },
    { words: /early termination|terminate.*two months|break.*lease/i, severity: "High", title: "Early termination charge", why: "Leaving early could trigger a large fee on top of ordinary rent or payments." },
    { words: /late fee|late charge|returned payment/i, severity: "Medium", title: "Late or returned-payment fee", why: "A small missed deadline can create a charge that compounds with other balances." },
    { words: /waive.*class action|class action/i, severity: "Medium", title: "Dispute rights limited", why: "This language can reduce the ways you can challenge a recurring or unfair charge." },
    { words: /non-refundable|nonrefundable/i, severity: "Medium", title: "Non-refundable payment", why: "You may not get this money back even if plans change or a service is not delivered." },
    { words: /attorney.*fees|legal fees/i, severity: "Low", title: "One-sided legal fees", why: "You could be responsible for the other party’s legal costs in a disagreement." },
  ];
  const flags = rules.filter((rule) => rule.words.test(text));
  const displayedFlags = aiAnalysis?.redFlags?.length ? aiAnalysis.redFlags : (flags.length ? flags : [{ severity: "Low", title: "No obvious trap found", why: "This quick browser check did not match common risk patterns. A professional review may still find context-specific issues." }]);
  const flagMarkup = displayedFlags
    .map((flag) => {
      const severity = ["High", "Medium", "Low"].includes(flag.severity) ? flag.severity : "Low";
      return `<article class="flag-card"><span class="severity severity-${severity.toLowerCase()}">${severity}</span><div><strong>${escapeHtml(flag.title || "Review this clause")}</strong><p>${escapeHtml(flag.why || "Ask a qualified professional to review this language.")}</p></div></article>`;
    }).join("");
  const feeSavings = Number(aiAnalysis?.potentialCaughtDollars) || amountMatches.filter((amount) => amount > 0 && amount <= 500).reduce((total, amount) => total + amount, 0);
  const counterScript = aiAnalysis?.counterScript || `Subject: Questions about the agreement\n\nHi,\n\nThanks for sending this over. Before I sign, could we please discuss the ${flags[0]?.title.toLowerCase() || "fee and renewal terms"}? I’d like the agreement to clearly state the notice period, the exact amount owed, and that charges only apply when they are reasonably related to an actual cost. Please send a revised copy for review.\n\nThank you,\n[Your name]`;
  const summary = aiAnalysis?.summary?.length ? aiAnalysis.summary : [
    flags.length ? `We found ${flags.length} clause${flags.length === 1 ? "" : "s"} worth slowing down for.` : "No common red-flag patterns matched this text.",
    amountMatches.length ? `The document mentions ${amountMatches.length} dollar amount${amountMatches.length === 1 ? "" : "s"}, including fees or deposits.` : "No dollar amounts were extracted.",
    "Ask for exact deadlines, a complete fee schedule, and a copy you can keep.",
  ];
  const aiStatus = aiAnalysis ? (aiMode === "mock" ? '<p class="ai-status ai-mock">◌ Mock AI response · no external model was called</p>' : '<p class="ai-status">✦ Reviewed by FlowDoc AI · OpenAI-compatible model</p>') : (aiError ? `<p class="ai-status ai-error">AI review unavailable: ${escapeHtml(aiError)} Showing the local browser screening instead.</p>` : "");
  contractResults.innerHTML = `
    <div class="result-header"><div><p class="eyebrow">Plain-English review</p><h3>Here’s what deserves a second look.</h3></div><span class="result-count">${displayedFlags.length} flags</span></div>
    ${aiStatus}
    <div class="result-card"><h4>Plain-English TL;DR</h4><ul>${summary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
    <div class="result-card"><h4>Financial Obligations &amp; Fees</h4><ul class="amount-list">${obligations}</ul></div>
    <div class="result-card"><h4>Red Flags &amp; Legal Traps</h4><div class="flag-list">${flagMarkup}</div></div>
    <div class="result-card script-card"><div class="card-title-row"><h4>Ready-to-Send Negotiation Counter-Script</h4><button class="copy-button" type="button" data-copy-script>Copy</button></div><pre>${escapeHtml(counterScript)}</pre></div>
    <p class="disclaimer">This is an educational screening, not legal advice. Laws vary by state and situation.</p>`;
  contractResults.querySelector("[data-copy-script]")?.addEventListener("click", async (event) => {
    await navigator.clipboard?.writeText(counterScript);
    event.currentTarget.textContent = "Copied";
  });
  vault.contractSavings = Math.max(vault.contractSavings, feeSavings);
  vault.reports = [...vault.reports.filter((report) => report.type !== "contract"), { type: "contract", label: "Contract audit", date: new Date().toISOString() }];
  saveVault();
};

const readPdf = async (file) => {
  if (!window.pdfjsLib) throw new Error("PDF extraction is still loading. Please try again in a moment.");
  const buffer = await file.arrayBuffer();
  const document = await window.pdfjsLib.getDocument({ data: buffer }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return pages.join("\n");
};

const readImage = async (file) => {
  if (!window.Tesseract) throw new Error("Image OCR is still loading. Please try again in a moment.");
  const result = await window.Tesseract.recognize(file, "eng", { logger: (message) => {
    if (message.status === "recognizing text") setStatus("#contract-status", `Reading image… ${Math.round(message.progress * 100)}%`);
  } });
  return result.data.text;
};

const processContractFile = async (file) => {
  if (!file) return;
  setStatus("#contract-status", `Reading ${file.name}…`);
  try {
    const text = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? await readPdf(file) : await readImage(file);
    document.querySelector("#contract-text").value = text;
    setStatus("#contract-status", `${file.name} ready for audit.`);
  } catch (error) {
    setStatus("#contract-status", error.message);
  }
};

document.querySelector("#contract-file")?.addEventListener("change", (event) => processContractFile(event.target.files[0]));
document.querySelector("#sample-lease")?.addEventListener("click", () => {
  document.querySelector("#contract-text").value = SAMPLE_LEASE;
  setStatus("#contract-status", "Sample US apartment lease loaded.");
});
const requestAiReview = async (text) => {
  const response = await fetch("/api/analyze-contract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `AI service returned HTTP ${response.status}.`);
  return { analysis: payload.analysis, mode: payload.mode || "live" };
};

document.querySelector("#audit-contract")?.addEventListener("click", async () => {
  const text = document.querySelector("#contract-text").value.trim();
  if (!text) {
    setStatus("#contract-status", "Add a document or load the sample lease first.");
    return;
  }
  setStatus("#contract-status", "Sending document text to the AI reviewer…");
  try {
    const result = await requestAiReview(text);
    renderContractResults(text, result.analysis, "", result.mode);
    setStatus("#contract-status", result.mode === "mock" ? "Mock AI response complete; no external model was called." : "AI review complete. The extracted text was analyzed by the configured model.");
  } catch (error) {
    renderContractResults(text, null, error.message);
    setStatus("#contract-status", "AI review could not be completed; local screening is shown.");
  }
});

document.querySelectorAll("[data-drop-target]").forEach((zone) => {
  const input = document.querySelector(`#${zone.dataset.dropTarget}`);
  ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((eventName) => zone.addEventListener(eventName, (event) => { event.preventDefault(); zone.classList.remove("is-dragging"); }));
  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files[0];
    if (file && input.id === "contract-file") processContractFile(file);
    if (file && input.id === "csv-file") processCsvFile(file);
  });
});

const categoryFor = (description) => {
  const value = description.toLowerCase();
  if (/adobe|canva|dropbox|software|saas|subscription/.test(value)) return "Software & Subscriptions";
  if (/comcast|internet|wifi|at&t|verizon|t-mobile|phone/.test(value)) return "Internet & Phone";
  if (/delta|airline|hotel|airbnb|uber(?! eats)|lyft|parking/.test(value)) return "Travel";
  if (/starbucks|restaurant|doordash|grubhub|uber eats|meal/.test(value)) return "Meals (50%)";
  if (/apple|office depot|staples|best buy|equipment|supplies/.test(value)) return "Equipment & Supplies";
  if (/home office|coworking|wework/.test(value)) return "Home Office";
  return "";
};

let transactions = [];
const parseCsv = (text) => {
  if (window.Papa) return window.Papa.parse(text, { header: true, skipEmptyLines: true }).data;
  const [header, ...rows] = text.trim().split(/\r?\n/).map((row) => row.split(","));
  return rows.map((row) => Object.fromEntries(header.map((key, index) => [key, row[index]])));
};
const normalizeTransaction = (row, index) => {
  const get = (name) => row[Object.keys(row).find((key) => key.trim().toLowerCase() === name) || name] || "";
  const description = String(get("description") || get("memo") || "Transaction").trim();
  const amount = Math.abs(Number(String(get("amount")).replace(/[$,]/g, ""))) || 0;
  const category = categoryFor(description);
  return { id: `${index}-${description}`, date: get("date"), description, amount, category, business: Boolean(category), percentage: /comcast|internet|phone|wireless/i.test(description) ? 60 : 100 };
};
const recalculateTax = () => {
  const rate = Number(document.querySelector("#tax-rate").value);
  const eligible = transactions.filter((transaction) => transaction.business && transaction.category);
  const deductible = eligible.reduce((total, transaction) => total + transaction.amount * (transaction.percentage / 100) * (transaction.category === "Meals (50%)" ? 0.5 : 1), 0);
  const savings = deductible * (0.153 + rate);
  const buckets = eligible.reduce((result, transaction) => {
    const amount = transaction.amount * (transaction.percentage / 100) * (transaction.category === "Meals (50%)" ? 0.5 : 1);
    result[transaction.category] = (result[transaction.category] || 0) + amount;
    return result;
  }, {});
  const rows = transactions.map((transaction, index) => `<tr><td>${escapeHtml(transaction.date)}</td><td><strong>${escapeHtml(transaction.description)}</strong><small>${transaction.category || "Not a common Schedule C match"}</small></td><td>${money(transaction.amount)}</td><td><label class="switch"><input type="checkbox" data-business="${index}" ${transaction.business ? "checked" : ""}><span></span></label></td><td><input class="percent-input" data-percent="${index}" type="number" min="0" max="100" step="5" value="${transaction.percentage}" ${transaction.business ? "" : "disabled"} aria-label="Business use percentage for ${escapeHtml(transaction.description)}">%</td></tr>`).join("");
  document.querySelector("#tax-results").innerHTML = `<div class="tax-summary"><div><span>Estimated deductible</span><strong>${money(deductible)}</strong></div><div class="savings-highlight"><span>Potential tax savings</span><strong>${money(savings)}</strong><small>15.3% SE tax + ${(rate * 100).toFixed(0)}% federal rate</small></div></div><div class="bucket-list">${Object.entries(buckets).map(([name, amount]) => `<span>${name}<strong>${money(amount)}</strong></span>`).join("") || "<span>Toggle a matched expense to business to see Schedule C buckets.</span>"}</div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Transaction</th><th>Amount</th><th>Use</th><th>Business %</th></tr></thead><tbody>${rows}</tbody></table></div><div class="export-row"><button class="specular-button tool-action" type="button" id="export-csv"><span>Download Tax-Ready Schedule C Summary</span></button><span>Keep receipts for every business expense.</span></div><p class="disclaimer">Estimate only. A CPA can confirm your Schedule C treatment, state taxes, and substantiation requirements.</p>`;
  document.querySelectorAll("[data-business]").forEach((input) => input.addEventListener("change", (event) => { transactions[Number(event.target.dataset.business)].business = event.target.checked; recalculateTax(); }));
  document.querySelectorAll("[data-percent]").forEach((input) => input.addEventListener("change", (event) => { transactions[Number(event.target.dataset.percent)].percentage = Math.max(0, Math.min(100, Number(event.target.value) || 0)); recalculateTax(); }));
  document.querySelector("#export-csv")?.addEventListener("click", () => exportTaxCsv(rate, deductible, savings));
  vault.taxSavings = savings;
  vault.reports = [...vault.reports.filter((report) => report.type !== "tax"), { type: "tax", label: "Schedule C estimate", date: new Date().toISOString(), savings }];
  saveVault();
};
const processCsvText = (text, label) => {
  transactions = parseCsv(text).map(normalizeTransaction).filter((transaction) => transaction.amount);
  setStatus("#csv-status", `${label} loaded · ${transactions.length} transactions found.`);
  recalculateTax();
};
const processCsvFile = async (file) => {
  if (!file) return;
  processCsvText(await file.text(), file.name);
};
document.querySelector("#csv-file")?.addEventListener("change", (event) => processCsvFile(event.target.files[0]));
document.querySelector("#sample-csv")?.addEventListener("click", () => processCsvText(SAMPLE_CSV, "Sample US bank CSV"));
document.querySelector("#tax-rate")?.addEventListener("change", () => { if (transactions.length) recalculateTax(); });
const exportTaxCsv = (rate, deductible, savings) => {
  const lines = [["Date", "Description", "Schedule C bucket", "Original amount", "Business use %", "Deductible amount"]];
  transactions.filter((transaction) => transaction.business && transaction.category).forEach((transaction) => lines.push([transaction.date, transaction.description, transaction.category, transaction.amount.toFixed(2), transaction.percentage, (transaction.amount * transaction.percentage / 100 * (transaction.category === "Meals (50%)" ? 0.5 : 1)).toFixed(2)]));
  lines.push([], ["Summary", "Estimated deductible", deductible.toFixed(2)], ["Summary", "Federal rate", `${rate * 100}%`], ["Summary", "Potential tax savings", savings.toFixed(2)]);
  const csv = lines.map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "flowdoc-schedule-c-summary.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  const checkin = document.querySelector('[data-checkin="export-expenses"]');
  if (checkin) { checkin.checked = true; vault.checkins["export-expenses"] = true; saveVault(); }
};
document.querySelectorAll("[data-checkin]").forEach((input) => {
  input.checked = Boolean(vault.checkins[input.dataset.checkin]);
  input.addEventListener("change", () => { vault.checkins[input.dataset.checkin] = input.checked; saveVault(); });
});
