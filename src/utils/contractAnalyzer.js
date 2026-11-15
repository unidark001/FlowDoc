const moneyPattern = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
const dollars = (value) => Number(String(value || "").replace(/[^\d.]/g, "")) || 0;
const uid = (title, index) => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index}`;

export const normalizeDocumentText = (text) => clean(text)
  .replace(/([a-z,;:])\s*\n\s*([a-z])/gi, "$1 $2")
  .replace(/\s*\[Page\s+(\d+)\]\s*/gi, "\n\n[Page $1]\n");

// PDFs often repeat a title or page number in their top/bottom lines. Remove only lines
// repeated on 3+ pages, never text in the middle of a page.
export const stripRepeatedPageChrome = (pageTexts) => {
  const candidates = new Map();
  pageTexts.forEach((page) => {
    const lines = String(page).split(/\r?\n/).map(clean).filter(Boolean);
    [...lines.slice(0, 2), ...lines.slice(-2)].forEach((line) => {
      if (line.length > 2 && line.length < 130) candidates.set(line, (candidates.get(line) || 0) + 1);
    });
  });
  const repeated = new Set([...candidates].filter(([, count]) => count >= 3).map(([line]) => line));
  return pageTexts.map((page, i) => {
    const body = String(page).split(/\r?\n/).filter((line) => !repeated.has(clean(line))).join("\n");
    return `[Page ${i + 1}]\n${body}`;
  }).join("\n\n");
};

export const preprocessOcrCanvas = async (file) => {
  const bitmap = await createImageBitmap(file);
  const maxWidth = 2400;
  const scale = Math.min(1, maxWidth / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  // Grayscale + contrast expansion + adaptive-ish fixed binarization is intentionally
  // deterministic, so OCR quality doesn't depend on a remote image service.
  for (let i = 0; i < image.data.length; i += 4) {
    const gray = image.data[i] * 0.299 + image.data[i + 1] * 0.587 + image.data[i + 2] * 0.114;
    const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.65 + 128));
    const value = contrast > 172 ? 255 : 0;
    image.data[i] = value; image.data[i + 1] = value; image.data[i + 2] = value;
  }
  context.putImageData(image, 0, 0);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not prepare image for OCR.")), "image/png"));
};

const quoteFor = (text, index, length) => clean(text.slice(Math.max(0, index - 95), Math.min(text.length, index + length + 150)));
const find = (text, pattern) => {
  const match = pattern.exec(text);
  return match ? { quote: quoteFor(text, match.index, match[0].length), match } : null;
};

const flag = (text, pattern, details) => {
  const result = find(text, pattern);
  return result && { ...details, verbatimQuote: result.quote, financialImpactDollars: details.financialImpactDollars || 0 };
};

export const extractTerms = (rawText) => {
  const text = normalizeDocumentText(rawText);
  const amounts = [...text.matchAll(moneyPattern)].map((match) => ({ value: dollars(match[0]), quote: quoteFor(text, match.index, match[0].length), index: match.index }));
  const percentages = [...text.matchAll(/\b(\d{1,3}(?:\.\d+)?)\s*%/g)].map((match) => ({ value: Number(match[1]), quote: quoteFor(text, match.index, match[0].length) }));
  const noticeWindows = [...text.matchAll(/\b(\d{1,3})\s*(?:calendar\s*)?days?\b/gi)].map((match) => ({ days: Number(match[1]), quote: quoteFor(text, match.index, match[0].length) }));
  const rentMatch = text.match(/(?:monthly\s+)?(?:base\s+)?rent(?:\s+(?:is|of|:))?\s*\$\s?([\d,]+(?:\.\d{1,2})?)/i);
  const baseRent = rentMatch ? dollars(rentMatch[1]) : 0;
  const recurring = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)\s*(?:per\s*month|\/\s*month|monthly)[^.\n]*/gi)]
    .map((match) => ({ value: dollars(match[1]), quote: clean(match[0]) }))
    .filter((item) => !rentMatch || item.value !== baseRent || !/rent/i.test(item.quote));
  const nonRefundable = [...text.matchAll(/(?:non[- ]?refundable[^$]{0,50}\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\$\s?(\d[\d,]*(?:\.\d{1,2})?)[^.\n]{0,50}non[- ]?refundable)/gi)]
    .map((match) => ({ value: dollars(match[1] || match[2]), quote: quoteFor(text, match.index, match[0].length), index: match.index }));
  const caps = [...text.matchAll(/(?:liability|damages?)\s+(?:shall\s+)?(?:not\s+)?(?:exceed|limited\s+to|cap(?:ped)?\s+(?:at|of))\s*\$?\s?([\d,]+(?:\.\d{1,2})?)/gi)]
    .map((match) => ({ value: dollars(match[1]), quote: quoteFor(text, match.index, match[0].length) }));
  return { text, amounts, percentages, noticeWindows, baseRent, recurring, nonRefundable, caps };
};

const RULES = [
  [/\b(?:automatically?\s+renew|auto[- ]?renew)/i, { severity: "High", title: "Automatic renewal commitment", whyItHurts: "A missed notice deadline can extend the agreement or lock in another term.", proposedCounterClause: "This agreement will not renew automatically. Any renewal requires both parties' written agreement after the final 30 days of the term." }],
  [/\b(?:binding\s+)?arbitration\b/i, { severity: "Medium", title: "Mandatory arbitration", whyItHurts: "This can move a dispute out of court and limit discovery or appeal options.", proposedCounterClause: "Arbitration is voluntary and does not waive either party's right to bring an individual claim in court." }],
  [/\b(?:class\s+action|class[- ]action)\s+(?:waiver|waive)/i, { severity: "Medium", title: "Class-action waiver", whyItHurts: "You may lose the ability to join others with the same small-dollar claim.", proposedCounterClause: "No class-action or representative-action rights are waived by this agreement." }],
  [/\b(?:sole\s+discretion|may\s+change|unilaterally\s+change)\b/i, { severity: "Medium", title: "One-sided change right", whyItHurts: "The other party may be able to change price or obligations without your agreement.", proposedCounterClause: "Material fees and obligations may change only by a written amendment signed by both parties." }],
  [/\b(?:tenant|customer|resident)\s+(?:is|shall be)\s+responsible\s+for[^.]{0,110}(?:repair|maintenance)/i, { severity: "High", title: "Repair costs shifted to you", whyItHurts: "The clause may make you pay even when you did not cause the problem.", proposedCounterClause: "Tenant is responsible only for damage caused by Tenant, occupants, or guests; ordinary maintenance remains the owner's responsibility." }],
  [/\battorney(?:'s|s)?\s+fees?/i, { severity: "Low", title: "Attorney-fee exposure", whyItHurts: "A one-way fee clause can make a small dispute expensive.", proposedCounterClause: "Attorney fees may be awarded only as permitted by applicable law and on an equal basis to the prevailing party." }],
];

export const analyzeContract = (rawText) => {
  const terms = extractTerms(rawText);
  const flags = RULES.map(([pattern, detail]) => flag(terms.text, pattern, detail)).filter(Boolean);
  const renewalNotice = terms.noticeWindows.find((window) => /renew|notice/i.test(window.quote));
  if (renewalNotice?.days > 30) flags.push({ severity: "High", title: "Long renewal notice window", financialImpactDollars: terms.baseRent, verbatimQuote: renewalNotice.quote, whyItHurts: `A ${renewalNotice.days}-day deadline is easy to miss and can trigger another term.`, proposedCounterClause: "Notice to decline renewal may be delivered up to 30 days before the term ends." });
  const texas = /\btexas\b|\btx\b/i.test(terms.text);
  const deposit = terms.amounts.find((amount) => /security\s+deposit/i.test(amount.quote));
  if (texas && deposit && !/30\s+days?[^.]{0,80}(?:return|refund|itemized)/i.test(terms.text)) flags.push({ severity: "Medium", title: "Texas deposit-return deadline is not stated", financialImpactDollars: deposit.value, verbatimQuote: deposit.quote, whyItHurts: "Texas generally requires a security-deposit accounting and return within 30 days after surrender and a forwarding address; the agreement should not imply a longer period.", proposedCounterClause: "The security deposit will be accounted for and returned as required by Texas Property Code § 92.103." });
  const nonRefundable = terms.nonRefundable[0];
  if (nonRefundable) flags.push({ severity: "Medium", title: "Non-refundable charge", financialImpactDollars: nonRefundable.value, verbatimQuote: nonRefundable.quote, whyItHurts: "This fee may be lost even if no corresponding service or damage occurs.", proposedCounterClause: "Any move-in fee must be itemized, reasonable, and refundable to the extent no documented cost is incurred." });
  const late = terms.amounts.find((amount) => /late\s+(?:fee|charge)/i.test(amount.quote));
  if (late) flags.push({ severity: "Medium", title: "Late-payment charge", financialImpactDollars: late.value, verbatimQuote: late.quote, whyItHurts: "A short delay can create a separate charge in addition to the underlying balance.", proposedCounterClause: "Any late fee will be reasonable, disclosed in advance, and charged only after any legally required grace period." });
  const recurringCost = terms.recurring.reduce((sum, item) => sum + item.value, 0);
  const nonRefundableCost = terms.nonRefundable.reduce((sum, item) => sum + item.value, 0);
  const trueAnnualizedCost = terms.baseRent * 12 + recurringCost * 12 + nonRefundableCost;
  const riskScore = Math.min(100, flags.reduce((score, item) => score + ({ High: 19, Medium: 11, Low: 5 }[item.severity] || 0), 0) + (recurringCost ? 4 : 0));
  const redFlags = flags.map((item, index) => ({ id: uid(item.title, index), ...item }));
  const savings = redFlags.reduce((sum, item) => sum + (item.financialImpactDollars || 0), 0);
  return {
    terms, redFlags, riskScore, trueAnnualizedCost, headlineAnnualCost: terms.baseRent * 12,
    hiddenAnnualCost: recurringCost * 12 + nonRefundableCost, potentialCaughtDollars: savings,
    summary: [
      `Deterministic score: ${riskScore}/100 from ${redFlags.length} document-specific issue${redFlags.length === 1 ? "" : "s"}.`,
      terms.baseRent ? `True first-year cost is ${trueAnnualizedCost.toLocaleString("en-US", { style: "currency", currency: "USD" })} versus ${ (terms.baseRent * 12).toLocaleString("en-US", { style: "currency", currency: "USD" })} headline annual rent.` : "No clearly labeled base rent was extracted.",
      terms.caps.length ? `${terms.caps.length} liability cap${terms.caps.length === 1 ? "" : "s"} extracted for review.` : "Confirm that all liability limits and exclusions are acceptable.",
    ],
  };
};

export const makeCounterScript = (analysis, selectedIds) => {
  const selected = analysis.redFlags.filter((item) => selectedIds.includes(item.id));
  const savings = selected.reduce((sum, item) => sum + (item.financialImpactDollars || 0), 0);
  const requests = selected.map((item) => `• ${item.title}: ${item.proposedCounterClause}`).join("\n");
  return `Subject: Requested revisions to the agreement\n\nHello,\n\nThank you for sharing the agreement. Before I sign, I would appreciate revisions or written clarification on the items below:\n\n${requests || "• Please confirm the full fee schedule, renewal deadline, and each party's repair responsibilities."}\n\n${savings ? `These items represent up to ${savings.toLocaleString("en-US", { style: "currency", currency: "USD" })} in identified charges or exposure, so I would like them resolved in the signed copy.\n\n` : "\n"}I’m happy to review a revised copy. Thank you for your help.\n\nBest,\n[Your name]`;
};
