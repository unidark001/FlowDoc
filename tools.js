(() => {
  "use strict";

  /* ---------- Sample data ---------- */
  const SAMPLE_LEASE = `RESIDENTIAL LEASE AGREEMENT

This Residential Lease Agreement is between Harbor View Properties ("Landlord") and Jordan Lee ("Tenant") for 1458 W 19th Street, Unit 4B, Chicago, Illinois.

1. TERM AND RENT. The lease begins August 1, 2025 and ends July 31, 2026. Monthly rent is $2,150, due on the first day of each month. A late fee of $125 is charged if rent is not received by 5:00 PM on the third day. Rent increases by 8% upon renewal unless Landlord gives 30 days' notice.

2. DEPOSIT AND FEES. Tenant will pay a $2,150 security deposit and a non-refundable $350 move-in fee. If Tenant ends the lease early, Tenant owes an early termination charge equal to two months' rent plus the cost of re-leasing the unit. A $75 fee applies to each returned payment.

3. UTILITIES AND SERVICES. Tenant pays electricity, gas, water, and a $65 monthly technology and amenity fee. Landlord may change the technology fee with 15 days' notice. Tenant must keep renter's insurance with at least $100,000 liability coverage.

4. AUTO-RENEWAL. Unless Tenant provides written notice 60 days before the end date, this lease automatically renews for another 12-month term at the then-current rent.

5. MAINTENANCE AND ACCESS. Tenant is responsible for the first $200 of every repair call, including repairs not caused by Tenant. Landlord may enter with reasonable notice for inspection, repairs, or showings.

6. LEGAL TERMS. Tenant waives the right to participate in any class action against Landlord and agrees to pay Landlord's attorney fees in any dispute. This document is a summary for demonstration and does not replace advice from a qualified local attorney.`;

  const SAMPLE_CSV = `Date,Description,Amount,Category
2025-10-01,Comcast Internet,-119.99,Utilities
2025-10-02,Client payment - Studio North,2400.00,Income
2025-10-03,Adobe Creative Cloud,-59.99,Subscriptions
2025-10-05,Trader Joe's,-86.42,Groceries
2025-10-07,Uber,-42.80,Travel
2025-10-10,Apple Store - MacBook accessories,-249.00,Shopping
2025-10-12,Starbucks,-18.75,Restaurants
2025-10-15,Delta Airlines,-386.40,Travel
2025-10-18,AT&T Wireless,-92.00,Utilities
2025-10-20,Office Depot,-74.62,Shopping
2025-10-22,Uber Eats,-31.40,Restaurants
2025-10-25,Canva Pro,-15.00,Subscriptions
2025-10-28,Target,-64.18,Shopping`;

  /* ---------- Utilities ---------- */
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const money = (value) => currency.format(Number(value) || 0);
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const MAX_FILE_BYTES = 25 * 1024 * 1024;

  const setStatus = (selector, message, tone = "") => {
    const element = $(selector);
    if (!element) return;
    element.textContent = message;
    element.dataset.tone = tone;
  };

  const scriptCache = new Map();
  const loadScript = (src) => {
    if (!scriptCache.has(src)) {
      scriptCache.set(src, new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = () => {
          scriptCache.delete(src);
          reject(new Error("A required library could not be downloaded. Check your connection and try again."));
        };
        document.head.append(script);
      }));
    }
    return scriptCache.get(src);
  };

  const PDFJS_BASE = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
  const loadPdfJs = async () => {
    await loadScript(`${PDFJS_BASE}/pdf.min.js`);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}/pdf.worker.min.js`;
    return window.pdfjsLib;
  };
  const loadTesseract = async () => {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js");
    return window.Tesseract;
  };

  /* ---------- Vault (localStorage) ---------- */
  const STORAGE_KEY = "flowdoc-vault";
  const defaultVault = () => ({ contractSavings: 0, taxSavings: 0, reports: [], checkins: {} });
  const loadVault = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!stored || typeof stored !== "object") return defaultVault();
      return {
        contractSavings: Number(stored.contractSavings) || 0,
        taxSavings: Number(stored.taxSavings) || 0,
        reports: Array.isArray(stored.reports) ? stored.reports : [],
        checkins: stored.checkins && typeof stored.checkins === "object" ? stored.checkins : {},
      };
    } catch {
      return defaultVault();
    }
  };
  let vault = loadVault();

  const renderVault = () => {
    const total = money(vault.contractSavings + vault.taxSavings);
    document.querySelectorAll("[data-vault-total]").forEach((element) => { element.textContent = total; });
    const count = $("#saved-report-count");
    const copy = $("#saved-report-copy");
    const list = $("#saved-report-list");
    if (count) count.textContent = String(vault.reports.length);
    if (copy) copy.textContent = vault.reports.length ? "Saved locally on this device." : "Your analyzed documents and tax reports appear here.";
    if (list) {
      list.innerHTML = vault.reports.map((report) => {
        const date = new Date(report.date);
        const when = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `<li><span>${escapeHtml(report.label)}</span><small>${escapeHtml(when)}${report.savings ? ` · ${money(report.savings)}` : ""}</small></li>`;
      }).join("");
    }
    document.querySelectorAll("[data-checkin]").forEach((input) => { input.checked = Boolean(vault.checkins[input.dataset.checkin]); });
  };

  const saveVault = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(vault));
    } catch {
      // Storage can be unavailable (private mode / quota). The UI still works for this session.
    }
    renderVault();
  };

  const upsertReport = (report) => {
    vault.reports = [...vault.reports.filter((item) => item.type !== report.type), { ...report, date: new Date().toISOString() }];
  };

  /* ---------- Contract auditor: local screening ---------- */
  const AMOUNT_PATTERN = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
  const extractAmounts = (text) => [...text.matchAll(AMOUNT_PATTERN)].map((match) => ({
    value: Number(match[1].replace(/,/g, "")),
    index: match.index,
    length: match[0].length,
  }));

  // An amount counts as an avoidable fee if a fee word sits close by and no
  // "ordinary cost" word (rent, deposit, coverage) sits right next to it.
  const isAvoidableFee = (text, amount) => {
    const before = text.slice(Math.max(0, amount.index - 60), amount.index).split(/\s+/).filter(Boolean);
    const after = text.slice(amount.index + amount.length, amount.index + amount.length + 70).split(/\s+/).filter(Boolean);
    const near = [...before.slice(-3), ...after.slice(0, 3)].join(" ");
    const wide = [...before.slice(-5), ...after.slice(0, 5)].join(" ");
    if (/deposit|rent\b|coverage|insurance|liability|salary|price/i.test(near)) return false;
    return /\bfees?\b|charge|penalt|fine\b/i.test(wide);
  };

  const LOCAL_RULES = [
    { words: /auto[- ]?renew|automatically renew/i, severity: "High", title: "Automatic renewal", why: "You may be locked into another term unless you remember a notice deadline." },
    { words: /early termination|terminate.*two months|break.*lease/i, severity: "High", title: "Early termination charge", why: "Leaving early could trigger a large fee on top of ordinary rent or payments." },
    { words: /late fee|late charge|returned payment/i, severity: "Medium", title: "Late or returned-payment fee", why: "A small missed deadline can create a charge that compounds with other balances." },
    { words: /class action|arbitration/i, severity: "Medium", title: "Dispute rights limited", why: "This language can reduce the ways you can challenge a recurring or unfair charge." },
    { words: /non-?refundable/i, severity: "Medium", title: "Non-refundable payment", why: "You may not get this money back even if plans change or a service is not delivered." },
    { words: /may change|at (its|our) (sole )?discretion|change the .* fee/i, severity: "Medium", title: "One-sided changes", why: "The other party can change terms or fees without your agreement." },
    { words: /attorney.*fees|legal fees/i, severity: "Low", title: "One-sided legal fees", why: "You could be responsible for the other party’s legal costs in a disagreement." },
  ];

  const localScreening = (text) => {
    const amounts = extractAmounts(text);
    const flags = LOCAL_RULES.filter((rule) => rule.words.test(text)).map(({ severity, title, why }) => ({ severity, title, why }));
    const fees = amounts.filter((amount) => amount.value > 0 && isAvoidableFee(text, amount));
    return {
      summary: [
        flags.length ? `We found ${plural(flags.length, "clause")} worth slowing down for.` : "No common red-flag patterns matched this text.",
        amounts.length
          ? `The document mentions ${plural(amounts.length, "dollar amount")}; ${fees.length} ${fees.length === 1 ? "looks like an avoidable fee" : "look like avoidable fees"} (${money(fees.reduce((total, amount) => total + amount.value, 0))}).`
          : "No dollar amounts were extracted.",
        "Ask for exact deadlines, a complete fee schedule, and a copy you can keep.",
      ],
      obligations: amounts.map((amount) => ({
        amount: money(amount.value),
        description: text.slice(Math.max(0, amount.index - 50), amount.index + amount.length + 50).replace(/\s+/g, " ").trim(),
        note: isAvoidableFee(text, amount) ? "Looks like an avoidable fee" : "",
      })),
      redFlags: flags.length ? flags : [{ severity: "Low", title: "No obvious trap found", why: "This quick check did not match common risk patterns. A professional review may still find context-specific issues." }],
      counterScript: `Subject: Questions about the agreement\n\nHi,\n\nThanks for sending this over. Before I sign, could we please discuss the ${flags[0]?.title.toLowerCase() || "fee and renewal terms"}? I’d like the agreement to clearly state the notice period, the exact amount owed, and that charges only apply when they are reasonably related to an actual cost. Please send a revised copy for review.\n\nThank you,\n[Your name]`,
      potentialCaughtDollars: fees.reduce((total, amount) => total + amount.value, 0),
    };
  };

  /* ---------- Contract auditor: rendering ---------- */
  const contractResults = $("#contract-results");

  const renderContractResults = ({ analysis, source, notice }) => {
    if (!contractResults) return;
    const flags = analysis.redFlags || [];
    const highCount = flags.filter((flag) => flag.severity === "High").length;
    const obligations = (analysis.obligations || []).length
      ? analysis.obligations.map((item) => `<li><strong>${escapeHtml(item.amount || "Amount not specified")}</strong><span>${escapeHtml(item.description || "")}</span>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ""}</li>`).join("")
      : "<li><span>No dollar amounts found. Check the original document before signing.</span></li>";
    const flagMarkup = flags.map((flag) => {
      const severity = ["High", "Medium", "Low"].includes(flag.severity) ? flag.severity : "Low";
      return `<article class="flag-card"><span class="severity severity-${severity.toLowerCase()}">${severity}</span><div><strong>${escapeHtml(flag.title)}</strong><p>${escapeHtml(flag.why)}</p></div></article>`;
    }).join("");
    const sourceLabel = {
      live: '<p class="ai-status">✦ Reviewed by FlowDoc AI</p>',
      mock: '<p class="ai-status ai-mock">◌ Mock AI response · no external model was called</p>',
      local: '<p class="ai-status ai-local">◇ On-device screening · nothing left your browser</p>',
    }[source] || "";

    contractResults.innerHTML = `
      <div class="result-header">
        <div><p class="eyebrow">Plain-English review</p><h3 id="contract-result-title">Here’s what deserves a second look.</h3></div>
        <span class="result-count${highCount ? " has-high" : ""}">${plural(flags.length, "flag")}${highCount ? ` · ${highCount} high` : ""}</span>
      </div>
      ${sourceLabel}
      ${notice ? `<p class="ai-status ai-error">${escapeHtml(notice)}</p>` : ""}
      <div class="result-stat"><span>Avoidable fees caught</span><strong>${money(analysis.potentialCaughtDollars)}</strong></div>
      <div class="result-card"><h4>Plain-English TL;DR</h4><ul>${(analysis.summary || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      <div class="result-card"><h4>Red flags &amp; legal traps</h4><div class="flag-list">${flagMarkup}</div></div>
      <details class="result-card result-details"><summary><h4>Financial obligations &amp; fees</h4><span>${plural((analysis.obligations || []).length, "item")}</span></summary><ul class="amount-list">${obligations}</ul></details>
      <div class="result-card script-card"><div class="card-title-row"><h4>Ready-to-send negotiation script</h4><button class="copy-button" type="button" data-copy-script>Copy</button></div><pre>${escapeHtml(analysis.counterScript || "")}</pre></div>
      <p class="disclaimer">This is an educational screening, not legal advice. Laws vary by state and situation.</p>`;

    contractResults.querySelector("[data-copy-script]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget; // capture before await: currentTarget is null afterwards
      try {
        await navigator.clipboard.writeText(analysis.counterScript || "");
        button.textContent = "Copied ✓";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(contractResults.querySelector(".script-card pre"));
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        button.textContent = "Press Ctrl+C";
      }
      setTimeout(() => { button.textContent = "Copy"; }, 2200);
    });

    vault.contractSavings = Number(analysis.potentialCaughtDollars) || 0;
    upsertReport({ type: "contract", label: "Contract audit", savings: vault.contractSavings });
    saveVault();
  };

  const revealResults = (panel) => {
    panel.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 900px)").matches) {
      panel.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }
  };

  /* ---------- Contract auditor: file input ---------- */
  const contractText = $("#contract-text");
  const contractCount = $("#contract-count");
  const auditButton = $("#audit-contract");
  const useAi = $("#use-ai");

  const updateCount = () => {
    if (contractCount && contractText) contractCount.textContent = `${contractText.value.length.toLocaleString("en-US")} characters`;
  };

  const readPdf = async (file) => {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      setStatus("#contract-status", `Reading page ${pageNumber} of ${pdf.numPages}…`, "busy");
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str).join(" "));
    }
    const text = pages.join("\n\n").trim();
    if (!text) throw new Error("This PDF has no selectable text (it may be a scan). Export a page as PNG or JPG and drop it here to use OCR.");
    return text;
  };

  const readImage = async (file) => {
    setStatus("#contract-status", "Loading the on-device text reader…", "busy");
    const tesseract = await loadTesseract();
    const result = await tesseract.recognize(file, "eng", {
      logger: (message) => {
        if (message.status === "recognizing text") setStatus("#contract-status", `Reading image… ${Math.round(message.progress * 100)}%`, "busy");
        else if (message.status) setStatus("#contract-status", `Preparing OCR: ${message.status}…`, "busy");
      },
    });
    return result.data.text.trim();
  };

  const isPdf = (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  const isImage = (file) => /^image\/(png|jpe?g)$/.test(file.type) || /\.(png|jpe?g)$/i.test(file.name);

  const processContractFile = async (file) => {
    if (!file || !contractText) return;
    if (!isPdf(file) && !isImage(file)) {
      setStatus("#contract-status", `${file.name} isn't supported. Use a PDF, PNG or JPG.`, "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus("#contract-status", "That file is over 25 MB. Try a smaller export or a single page.", "error");
      return;
    }
    setStatus("#contract-status", `Reading ${file.name}…`, "busy");
    try {
      contractText.value = isPdf(file) ? await readPdf(file) : await readImage(file);
      updateCount();
      setStatus("#contract-status", `${file.name} is ready. Review the text, then run the audit.`, "success");
    } catch (error) {
      setStatus("#contract-status", error.message || "We couldn't read that file.", "error");
    }
  };

  const requestAiReview = async (text, signal) => {
    const response = await fetch("/api/analyze-contract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.analysis) throw new Error(payload.error || `AI service returned HTTP ${response.status}.`);
    return payload;
  };

  let auditController = null;
  const setAuditBusy = (busy) => {
    if (!auditButton) return;
    auditButton.disabled = busy;
    auditButton.setAttribute("aria-busy", String(busy));
    auditButton.querySelector("span").textContent = busy ? "Reviewing…" : "Audit document";
  };

  auditButton?.addEventListener("click", async () => {
    const text = contractText?.value.trim() || "";
    if (!text) {
      setStatus("#contract-status", "Add a document, paste text, or load the sample lease first.", "error");
      contractText?.focus();
      return;
    }

    if (!useAi?.checked) {
      renderContractResults({ analysis: localScreening(text), source: "local" });
      setStatus("#contract-status", "On-device screening complete.", "success");
      revealResults(contractResults);
      return;
    }

    auditController?.abort();
    auditController = new AbortController();
    setAuditBusy(true);
    setStatus("#contract-status", "Sending the document text to the AI reviewer…", "busy");
    try {
      const payload = await requestAiReview(text, auditController.signal);
      renderContractResults({
        analysis: payload.analysis,
        source: payload.mode === "mock" ? "mock" : "live",
        notice: payload.truncated ? "This document is long, so only the first part was reviewed. Check the rest manually." : "",
      });
      setStatus("#contract-status", payload.mode === "mock" ? "Mock AI review complete." : "AI review complete.", "success");
    } catch (error) {
      if (error.name === "AbortError") return;
      renderContractResults({ analysis: localScreening(text), source: "local", notice: `AI review unavailable: ${error.message} Showing the on-device screening instead.` });
      setStatus("#contract-status", "AI review couldn't finish. The on-device screening is shown instead.", "error");
    } finally {
      setAuditBusy(false);
    }
    revealResults(contractResults);
  });

  $("#contract-file")?.addEventListener("change", (event) => {
    processContractFile(event.target.files[0]);
    event.target.value = ""; // allow re-selecting the same file
  });
  $("#sample-lease")?.addEventListener("click", () => {
    if (!contractText) return;
    contractText.value = SAMPLE_LEASE;
    updateCount();
    setStatus("#contract-status", "Sample US apartment lease loaded. Press “Audit document”.", "success");
  });
  $("#clear-contract")?.addEventListener("click", () => {
    if (!contractText) return;
    contractText.value = "";
    updateCount();
    setStatus("#contract-status", "No document selected.");
    contractText.focus();
  });
  contractText?.addEventListener("input", updateCount);

  /* ---------- Drag & drop ---------- */
  document.querySelectorAll("[data-drop-target]").forEach((zone) => {
    const targetId = zone.dataset.dropTarget;
    ["dragenter", "dragover"].forEach((eventName) => zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    }));
    zone.addEventListener("dragleave", (event) => {
      if (!zone.contains(event.relatedTarget)) zone.classList.remove("is-dragging");
    });
    zone.addEventListener("drop", (event) => {
      event.preventDefault();
      zone.classList.remove("is-dragging");
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      if (targetId === "contract-file") processContractFile(file);
      if (targetId === "csv-file") processCsvFile(file);
    });
  });
  // Stop the browser from navigating away when a file is dropped just outside a zone.
  ["dragover", "drop"].forEach((eventName) => window.addEventListener(eventName, (event) => {
    if (!event.target.closest?.("[data-drop-target]")) event.preventDefault();
  }));

  /* ---------- Write-off hunter ---------- */
  const MEALS = "Meals (50%)";
  const CATEGORY_RULES = [
    [/applebee|starbucks|restaurant|doordash|grubhub|uber ?eats|meal|cafe|coffee/, MEALS],
    [/adobe|canva|dropbox|figma|notion|github|software|saas|subscription|google workspace|microsoft 365/, "Software & Subscriptions"],
    [/comcast|xfinity|internet|wi-?fi|at&t|verizon|t-mobile|phone|wireless/, "Internet & Phone"],
    [/delta|united air|american air|southwest|airline|hotel|airbnb|marriott|hilton|\buber\b|lyft|parking|amtrak/, "Travel"],
    [/apple store|apple\.com|macbook|office depot|staples|best buy|equipment|supplies|b&h/, "Equipment & Supplies"],
    [/facebook ads|meta ads|google ads|linkedin ads|advertis|mailchimp/, "Advertising"],
    [/usps|fedex|\bups\b|shipping|postage/, "Shipping & Postage"],
    [/udemy|coursera|skillshare|masterclass|conference|course/, "Education"],
    [/home office|coworking|wework|regus/, "Home Office & Workspace"],
  ];
  const MIXED_USE = /comcast|xfinity|internet|phone|wireless|verizon|t-mobile|at&t/i;
  // Self-employment tax applies to 92.35% of net earnings at 15.3%.
  const SE_TAX_RATE = 0.153 * 0.9235;

  const categoryFor = (description) => {
    const value = description.toLowerCase();
    return CATEGORY_RULES.find(([pattern]) => pattern.test(value))?.[1] || "";
  };

  // RFC 4180-style parser: handles quoted fields, escaped quotes and CRLF.
  const parseCsvRows = (text) => {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else field += character;
      } else if (character === '"') quoted = true;
      else if (character === ",") { row.push(field); field = ""; }
      else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += character;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((cells) => cells.some((cell) => cell.trim()));
  };

  const parseAmount = (value) => {
    const raw = String(value ?? "").trim();
    if (!raw) return NaN;
    const negative = /^\(.*\)$/.test(raw) || raw.includes("-");
    const number = Number(raw.replace(/[^\d.]/g, ""));
    return negative ? -number : number;
  };

  const parseTransactions = (text) => {
    const [header = [], ...rows] = parseCsvRows(text.replace(/^﻿/, ""));
    const keys = header.map((cell) => cell.trim().toLowerCase());
    const column = (...names) => keys.findIndex((key) => names.some((name) => key === name || key.includes(name)));
    const dateColumn = column("date", "posted");
    const descriptionColumn = column("description", "memo", "payee", "merchant", "name", "details");
    const amountColumn = column("amount");
    const debitColumn = column("debit", "withdrawal");
    if (descriptionColumn < 0 || (amountColumn < 0 && debitColumn < 0)) {
      throw new Error("We couldn't find Description and Amount columns in this CSV.");
    }

    const parsed = rows.map((cells) => ({
      date: (cells[dateColumn] || "").trim(),
      description: (cells[descriptionColumn] || "Transaction").trim(),
      amount: debitColumn >= 0 ? Math.abs(parseAmount(cells[debitColumn])) : parseAmount(cells[amountColumn]),
    })).filter((row) => Number.isFinite(row.amount) && row.amount !== 0);

    // Banks export spending as negative numbers when deposits are positive.
    // If the file has both signs, only negatives are expenses; otherwise treat all as expenses.
    const hasNegatives = debitColumn < 0 && parsed.some((row) => row.amount < 0);
    return parsed
      .filter((row) => !hasNegatives || row.amount < 0)
      .map((row, index) => {
        const category = categoryFor(row.description);
        return { id: index, ...row, amount: Math.abs(row.amount), category, business: Boolean(category), percentage: MIXED_USE.test(row.description) ? 60 : 100 };
      });
  };

  let transactions = [];
  const taxResults = $("#tax-results");
  const taxRate = $("#tax-rate");
  const deductibleFor = (transaction) => transaction.amount * (transaction.percentage / 100) * (transaction.category === MEALS ? 0.5 : 1);

  const computeTax = () => {
    const rate = Number(taxRate?.value) || 0.22;
    const eligible = transactions.filter((transaction) => transaction.business && transaction.category);
    const deductible = eligible.reduce((total, transaction) => total + deductibleFor(transaction), 0);
    const buckets = eligible.reduce((result, transaction) => {
      result[transaction.category] = (result[transaction.category] || 0) + deductibleFor(transaction);
      return result;
    }, {});
    return { rate, eligible, deductible, savings: deductible * (SE_TAX_RATE + rate), buckets };
  };

  // Updates only the totals so table inputs keep focus while the user toggles rows.
  const updateTaxSummary = () => {
    if (!taxResults || !transactions.length) return;
    const { rate, eligible, deductible, savings, buckets } = computeTax();
    $("[data-tax-deductible]", taxResults).textContent = money(deductible);
    $("[data-tax-savings]", taxResults).textContent = money(savings);
    $("[data-tax-rate-note]", taxResults).textContent = `${(SE_TAX_RATE * 100).toFixed(1)}% self-employment tax + ${Math.round(rate * 100)}% federal`;
    $("[data-tax-count]", taxResults).textContent = `${eligible.length} of ${transactions.length} expenses marked business`;
    $(".bucket-list", taxResults).innerHTML = Object.entries(buckets)
      .sort(([, a], [, b]) => b - a)
      .map(([name, amount]) => `<span>${escapeHtml(name)}<strong>${money(amount)}</strong></span>`).join("")
      || "<span>Mark a matched expense as business to see Schedule C categories.</span>";

    vault.taxSavings = savings;
    upsertReport({ type: "tax", label: "Schedule C estimate", savings });
    saveVault();
  };

  const renderTaxTable = () => {
    if (!taxResults) return;
    if (!transactions.length) {
      taxResults.innerHTML = '<div class="empty-result"><span aria-hidden="true">$</span><strong>No expenses found in this file.</strong><p>Check that the CSV has Description and Amount columns with spending rows.</p></div>';
      return;
    }
    const rows = transactions.map((transaction, index) => `
      <tr class="${transaction.business ? "" : "is-personal"}">
        <td>${escapeHtml(transaction.date)}</td>
        <td><strong title="${escapeHtml(transaction.description)}">${escapeHtml(transaction.description)}</strong><small>${escapeHtml(transaction.category || "No common Schedule C match")}</small></td>
        <td class="num">${money(transaction.amount)}</td>
        <td><label class="switch"><input type="checkbox" data-business="${index}" ${transaction.business ? "checked" : ""} aria-label="Business expense: ${escapeHtml(transaction.description)}"><span aria-hidden="true"></span></label></td>
        <td><span class="percent-field"><input class="percent-input" data-percent="${index}" type="number" inputmode="numeric" min="0" max="100" step="5" value="${transaction.percentage}" ${transaction.business ? "" : "disabled"} aria-label="Business use percentage for ${escapeHtml(transaction.description)}">%</span></td>
      </tr>`).join("");

    taxResults.innerHTML = `
      <div class="tax-summary">
        <div><span>Estimated deductible</span><strong data-tax-deductible>$0.00</strong><small data-tax-count></small></div>
        <div class="savings-highlight"><span>Potential tax savings</span><strong data-tax-savings>$0.00</strong><small data-tax-rate-note></small></div>
      </div>
      <div class="bucket-list"></div>
      <div class="table-wrap">
        <table>
          <caption class="sr-only">Transactions from your statement</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Transaction</th><th scope="col" class="num">Amount</th><th scope="col">Business</th><th scope="col">Use %</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="export-row">
        <button class="specular-button tool-action" type="button" id="export-csv"><span>Download Schedule C summary (CSV)</span></button>
        <span>Keep receipts for every business expense.</span>
      </div>
      <p class="disclaimer">Estimate only. A CPA can confirm your Schedule C treatment, state taxes, and record-keeping requirements.</p>`;
    updateTaxSummary();
  };

  taxResults?.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-business]")) {
      const index = Number(target.dataset.business);
      transactions[index].business = target.checked;
      const row = target.closest("tr");
      row?.classList.toggle("is-personal", !target.checked);
      const percent = row?.querySelector("[data-percent]");
      if (percent) percent.disabled = !target.checked;
      updateTaxSummary();
    } else if (target.matches("[data-percent]")) {
      const value = Math.max(0, Math.min(100, Math.round(Number(target.value)) || 0));
      transactions[Number(target.dataset.percent)].percentage = value;
      target.value = String(value);
      updateTaxSummary();
    }
  });
  taxResults?.addEventListener("click", (event) => {
    if (event.target.closest("#export-csv")) exportTaxCsv();
  });

  const processCsvText = (text, label) => {
    try {
      transactions = parseTransactions(text);
      const matched = transactions.filter((transaction) => transaction.category).length;
      setStatus("#csv-status", `${label}: ${plural(transactions.length, "expense")} found, ${matched} likely business.`, "success");
      renderTaxTable();
      revealResults(taxResults);
    } catch (error) {
      setStatus("#csv-status", error.message, "error");
    }
  };

  const processCsvFile = async (file) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) {
      setStatus("#csv-status", `${file.name} isn't a CSV file.`, "error");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus("#csv-status", "That CSV is over 25 MB. Export a shorter date range.", "error");
      return;
    }
    processCsvText(await file.text(), file.name);
  };

  // Prevent spreadsheet formula injection from bank descriptions such as "=HYPERLINK(...)".
  const csvCell = (value) => {
    let text = String(value ?? "");
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };

  const exportTaxCsv = () => {
    const { rate, eligible, deductible, savings } = computeTax();
    const lines = [["Date", "Description", "Schedule C category", "Original amount", "Business use %", "Deductible amount"]];
    eligible.forEach((transaction) => lines.push([transaction.date, transaction.description, transaction.category, transaction.amount.toFixed(2), transaction.percentage, deductibleFor(transaction).toFixed(2)]));
    lines.push([], ["Summary", "Estimated deductible", deductible.toFixed(2)], ["Summary", "Federal rate", `${Math.round(rate * 100)}%`], ["Summary", "Potential tax savings", savings.toFixed(2)]);
    const csv = lines.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `flowdoc-schedule-c-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    vault.checkins["export-expenses"] = true;
    saveVault();
  };

  $("#csv-file")?.addEventListener("change", (event) => {
    processCsvFile(event.target.files[0]);
    event.target.value = "";
  });
  $("#sample-csv")?.addEventListener("click", () => processCsvText(SAMPLE_CSV, "Sample US bank CSV"));
  taxRate?.addEventListener("change", updateTaxSummary);

  /* ---------- Vault controls ---------- */
  document.querySelectorAll("[data-checkin]").forEach((input) => {
    input.addEventListener("change", () => {
      vault.checkins[input.dataset.checkin] = input.checked;
      saveVault();
    });
  });
  $("#reset-vault")?.addEventListener("click", () => {
    if (!window.confirm("Clear your saved totals, reports and checklist from this device?")) return;
    vault = defaultVault();
    saveVault();
  });

  renderVault();
  updateCount();
})();
