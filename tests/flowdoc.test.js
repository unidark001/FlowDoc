import test from "node:test";
import assert from "node:assert/strict";
import { analyzeContract, makeCounterScript, maskPersonalData, normalizeDocumentText } from "../src/utils/contractAnalyzer.js";
import { normalizeBankCsv } from "../src/utils/csvNormalizer.js";
import { calculateScheduleC, classifyTransactions, TAX_ESTIMATE } from "../src/utils/scheduleCEngine.js";

test("Uber Eats is categorized as meals, not travel", () => {
  const [transaction] = classifyTransactions([{ description: "UBER EATS", amount: 25, kind: "expense" }]);
  assert.equal(transaction.lineKey, "meals");
});

test("Uber rides remain travel", () => {
  const [transaction] = classifyTransactions([{ description: "UBER TRIP", amount: 25, kind: "expense" }]);
  assert.equal(transaction.lineKey, "travel");
});

test("ambiguous merchants need review", () => {
  const [transaction] = classifyTransactions([{ description: "Target", amount: 40, kind: "expense" }]);
  assert.equal(transaction.confidence, "Needs Review");
  assert.equal(transaction.business, false);
});

test("CSV prefers exact amount column over partial payment matches", () => {
  const result = normalizeBankCsv("Date,Description,Payment method,Amount\n2025-01-01,Office Depot,Card,25.00");
  assert.equal(result.transactions[0].amount, 25);
});

test("document normalization preserves page boundaries", () => {
  assert.equal(normalizeDocumentText("First line\n\n[Page 2]\nSecond line"), "First line\n\n[Page 2]\nSecond line");
});

test("PII is redacted before AI submission", () => {
  const masked = maskPersonalData("Call 212-555-0199 or email jane@example.com. SSN 123-45-6789.");
  assert.match(masked, /\[PHONE REDACTED\]/);
  assert.match(masked, /\[EMAIL REDACTED\]/);
  assert.match(masked, /\[SSN REDACTED\]/);
  assert.doesNotMatch(masked, /jane@example\.com|123-45-6789/);
});

test("contract analyzer identifies renewal and late fees", () => {
  const analysis = analyzeContract("Monthly rent is $2,000. A $100 late fee applies. The lease automatically renews.");
  assert.ok(analysis.redFlags.some((flag) => flag.title.includes("renewal")));
  assert.ok(analysis.redFlags.some((flag) => flag.title.includes("Late")));
  assert.equal(analysis.headlineAnnualCost, 24000);
});

test("Schedule C savings include deductible business meals at 50 percent", () => {
  const transactions = classifyTransactions([{ description: "Business restaurant dinner", amount: 100, kind: "expense" }]);
  const result = calculateScheduleC(transactions, { bracket: 0.22 });
  assert.equal(result.deductible, 50);
  assert.ok(result.totalSavings > 0);
});

test("Las Vegas is not misclassified as a gas utility", () => {
  const [transaction] = classifyTransactions([{ description: "Las Vegas conference", amount: 100, kind: "expense" }]);
  assert.notEqual(transaction.lineKey, "utilities");
});

test("Metallica is not misclassified as Meta advertising", () => {
  const [transaction] = classifyTransactions([{ description: "Metallica tickets", amount: 100, kind: "expense" }]);
  assert.notEqual(transaction.lineKey, "advertising");
});

test("Starbucks is a 50 percent meal", () => {
  const [transaction] = classifyTransactions([{ description: "Starbucks client coffee", amount: 20, kind: "expense" }]);
  assert.equal(transaction.lineKey, "meals");
  assert.equal(transaction.percentage, 100);
});

test("Adobe is high confidence office software", () => {
  const [transaction] = classifyTransactions([{ description: "Adobe Creative Cloud", amount: 60, kind: "expense" }]);
  assert.equal(transaction.lineKey, "office");
  assert.equal(transaction.confidence, "High Confidence");
});

test("generic gas requires review", () => {
  const [transaction] = classifyTransactions([{ description: "Gas station", amount: 50, kind: "expense" }]);
  assert.equal(transaction.confidence, "Needs Review");
});

test("signed negative amounts become expenses", () => {
  const { transactions } = normalizeBankCsv("Date,Description,Amount\n2025-01-01,Adobe,-12.50\n2025-01-02,Client payment,100");
  assert.equal(transactions[0].kind, "expense");
  assert.equal(transactions[0].amount, 12.5);
  assert.equal(transactions[1].kind, "income");
});

test("debit and credit columns identify income", () => {
  const { transactions } = normalizeBankCsv("Date,Description,Debit,Credit\n2025-01-01,Adobe,12.50,\n2025-01-02,Client payment,,100");
  assert.equal(transactions[0].kind, "expense");
  assert.equal(transactions[1].kind, "income");
});

test("parenthesized amounts are parsed as signed values", () => {
  const { transactions } = normalizeBankCsv("Date,Description,Amount\n2025-01-01,Adobe,(12.50)");
  assert.equal(transactions[0].amount, 12.5);
});

test("quoted commas remain inside descriptions", () => {
  const { transactions } = normalizeBankCsv('Date,Description,Amount\n2025-01-01,"Office Depot, Downtown",25');
  assert.equal(transactions[0].description, "Office Depot, Downtown");
});

test("UTF-8 BOM is ignored", () => {
  const { transactions } = normalizeBankCsv("\uFEFFDate,Description,Amount\n2025-01-01,Adobe,25");
  assert.equal(transactions[0].date, "2025-01-01");
});

test("mixed utilities use the business percentage", () => {
  const [transaction] = classifyTransactions([{ description: "Comcast internet", amount: 100, kind: "expense" }]);
  transaction.business = true;
  transaction.percentage = 60;
  assert.equal(calculateScheduleC([transaction]).deductible, 60);
});

test("home office simplified method is capped at 300 square feet", () => {
  const result = calculateScheduleC([], { homeOffice: true, squareFeet: 500 });
  assert.equal(result.deductible, 1500);
});

test("QBI estimate is optional", () => {
  const [transaction] = classifyTransactions([{ description: "Adobe", amount: 100, kind: "expense" }]);
  const withoutQbi = calculateScheduleC([transaction], { bracket: 0.22 });
  const withQbi = calculateScheduleC([transaction], { bracket: 0.22, qbi: true });
  assert.ok(withQbi.totalSavings > withoutQbi.totalSavings);
});

test("SE estimate uses documented constants", () => {
  const [transaction] = classifyTransactions([{ description: "Adobe", amount: 100, kind: "expense" }]);
  const result = calculateScheduleC([transaction]);
  assert.equal(result.seSavings, 100 * TAX_ESTIMATE.netEarningsFactor * TAX_ESTIMATE.selfEmploymentRate);
});

test("freelance net-90 terms are flagged", () => {
  const analysis = analyzeContract("Client pays Net-90 after delivery.");
  assert.ok(analysis.redFlags.some((flag) => flag.title.includes("payment terms")));
});

test("freelance IP assignment is flagged", () => {
  const analysis = analyzeContract("All intellectual property rights are assigned before payment.");
  assert.ok(analysis.redFlags.some((flag) => flag.title.includes("IP")));
});

test("unlimited revisions are flagged", () => {
  const analysis = analyzeContract("The client receives unlimited revisions.");
  assert.ok(analysis.redFlags.some((flag) => flag.title.includes("revisions")));
});

test("scope creep is flagged", () => {
  const analysis = analyzeContract("Scope creep and additional work are included at no cost.");
  assert.ok(analysis.redFlags.some((flag) => flag.title.includes("Scope")));
});

test("counter script includes selected freelance request", () => {
  const analysis = analyzeContract("The client receives unlimited revisions.");
  const script = makeCounterScript(analysis, analysis.redFlags.map((flag) => flag.id));
  assert.match(script, /revisions/i);
});
