export const LINES = {
  advertising: { line: "Line 8", label: "Advertising & Marketing" }, office: { line: "Line 18", label: "Office Expense & Software/SaaS" },
  supplies: { line: "Line 22", label: "Supplies & Equipment" }, travel: { line: "Line 24a", label: "Business Travel" },
  meals: { line: "Line 24b", label: "Deductible Business Meals (50%)", mealCap: true }, utilities: { line: "Line 25", label: "Utilities, Internet & Telecom", mixed: true },
  other: { line: "Line 27a", label: "Other / Professional Services & Contractors" },
};
export const TAX_ESTIMATE = Object.freeze({ selfEmploymentRate: 0.153, netEarningsFactor: 0.9235 });
const rules = [
  [/\bmeta\b|facebook ads|google ads|linkedin ads|mailchimp|advertis|promotion/, "advertising"],
  [/adobe|canva|dropbox|figma|notion|github|openai|software|saas|subscription|google workspace|microsoft 365|zoom/, "office"],
  [/office depot|staples|best buy|apple store|apple\.com|equipment|supplies|b&h/, "supplies"],
  [/delta|united|american air|southwest|airline|hotel|airbnb|marriott|hilton|amtrak|parking|\buber\b(?!\s*eats)|lyft/, "travel"],
  [/restaurant|doordash|grubhub|uber\s*eats|meal|cafe|coffee|starbucks/, "meals"],
  [/comcast|xfinity|internet|wi-?fi|at&t|verizon|t-mobile|\bphone\b|wireless|utility|\belectric\b|\bwater\b|\bgas\b/, "utilities"],
  [/legal|accounting|cpa|bookkeep|consult|contractor|freelance|upwork|fiverr|stripe fee|paypal fee/, "other"],
];
const personal = /target|walmart|costco|grocery|trader joe|netflix|spotify|personal payment|payment thank you/i;
const income = /client payment|invoice payment|deposit|payout|stripe transfer|paypal transfer|direct dep/i;

export const classifyTransactions = (transactions) => transactions.map((item) => {
  const text = `${item.description} ${item.rawDescription || ""}`.toLowerCase();
  const key = rules.find(([pattern]) => pattern.test(text))?.[1];
  const recurring = key === "office" && /subscription|software|saas|adobe|canva|notion|github|dropbox|figma|zoom/i.test(text);
  const line = key ? LINES[key] : null;
  const isIncome = item.kind === "income" || income.test(text);
  const needsReview = /\b(?:amazon|walmart|target|uber)\b|\b(?:gas|water|electric)\b/.test(text);
  const confidence = isIncome ? "Personal / Non-Deductible" : needsReview ? "Needs Review" : personal.test(text) ? "Personal / Non-Deductible" : key ? "High Confidence" : "Needs Review";
  return { ...item, lineKey: key, category: line?.label || "Unclassified", lineNumber: line?.line || "", business: confidence === "High Confidence", confidence, percentage: line?.mixed ? 50 : 100, recurring };
});

export const detectRecurringSaas = (transactions) => {
  const groups = new Map();
  transactions.filter((item) => item.lineKey === "office").forEach((item) => { const key = item.description.toLowerCase(); groups.set(key, [...(groups.get(key) || []), item]); });
  return [...groups.values()].filter((items) => items.length >= 2 && Math.max(...items.map((item) => item.amount)) - Math.min(...items.map((item) => item.amount)) <= 2).map((items) => items[0].description);
};

export const deductibleFor = (item) => item.amount * (item.percentage / 100) * (LINES[item.lineKey]?.mealCap ? 0.5 : 1);
export const calculateScheduleC = (transactions, options = {}) => {
  const bracket = Number(options.bracket) || 0.22;
  const eligible = transactions.filter((item) => item.business && item.lineKey);
  const transactionDeductible = eligible.reduce((sum, item) => sum + deductibleFor(item), 0);
  const homeOffice = options.homeOffice ? Math.min(300, Math.max(0, Number(options.squareFeet) || 0)) * 5 : 0;
  const deductible = transactionDeductible + homeOffice;
  const seSavings = deductible * TAX_ESTIMATE.netEarningsFactor * TAX_ESTIMATE.selfEmploymentRate;
  const federalSavings = deductible * bracket;
  const qbiSavings = options.qbi ? deductible * 0.2 * bracket : 0;
  const incomeTotal = transactions.filter((item) => item.kind === "income" || income.test(`${item.description} ${item.rawDescription || ""}`)).reduce((sum, item) => sum + item.amount, 0);
  const byLine = eligible.reduce((out, item) => { const key = item.lineNumber; out[key] = out[key] || { ...LINES[item.lineKey], gross: 0, deductible: 0, notes: new Set() }; out[key].gross += item.amount; out[key].deductible += deductibleFor(item); out[key].notes.add(item.confidence); return out; }, {});
  if (homeOffice) byLine["Line 30"] = { line: "Line 30", label: "Simplified home office", gross: homeOffice, deductible: homeOffice, notes: new Set(["$5/sq ft simplified method"]) };
  const meals = eligible.filter((item) => item.lineKey === "meals").reduce((sum, item) => sum + item.amount, 0);
  const utilities = eligible.filter((item) => item.lineKey === "utilities").reduce((sum, item) => sum + item.amount, 0);
  const warnings = [];
  if (incomeTotal > 0 && meals / incomeTotal > 0.15) warnings.push("Meals exceed 15% of detected deposits; keep client/business purpose records.");
  if (incomeTotal > 0 && utilities / incomeTotal > 0.2) warnings.push("Utilities exceed 20% of detected deposits; confirm the business-use split.");
  if (incomeTotal > 0 && deductible / incomeTotal > 0.75) warnings.push("Claims exceed 75% of detected deposits; document each expense and consult a tax professional.");
  return { eligible, deductible, transactionDeductible, seSavings, federalSavings, qbiSavings, totalSavings: seSavings + federalSavings + qbiSavings, incomeTotal, byLine, warnings, auditRisk: warnings.length >= 2 ? "High" : warnings.length ? "Review" : "Healthy" };
};
