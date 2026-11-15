const aliases = {
  date: ["date", "transaction date", "posting date", "posted date", "trans date"],
  description: ["description", "merchant", "memo", "payee", "name", "details", "transaction description"],
  amount: ["amount", "transaction amount", "total"],
  debit: ["debit", "withdrawal", "debits", "charges", "outflow"],
  credit: ["credit", "deposit", "credits", "payment", "inflow"],
};

export const parseCsvRows = (text) => {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { field += char; i += 1; } else if (char === '"') quoted = false; else field += char; }
    else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[i + 1] === "\n") i += 1; row.push(field); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
};

const numeric = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return NaN;
  const parsed = Number(raw.replace(/[$,\s]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(parsed) ? parsed : NaN;
};
const findColumn = (headers, type) => headers.findIndex((header) => aliases[type].some((alias) => header === alias || header.includes(alias)));

export const cleanMerchant = (value) => String(value || "Transaction")
  .replace(/\b(?:POS|DEBIT|CREDIT|PURCHASE|CHECKCARD|RECURRING|ONLINE|ACH|VISA|MASTERCARD)\b/gi, "")
  .replace(/\b(?:MKTPL\*|TST\*|SQ\*|PP\*|PAYPAL\*)\s*/gi, "")
  .replace(/(?:\*|#)\d{3,}|\b\d{5,}\b/g, "")
  .replace(/\s+(?:[A-Z]{2}|USA)\s*$/i, "")
  .replace(/\s{2,}/g, " ").trim() || "Transaction";

export const normalizeBankCsv = (text) => {
  const [header = [], ...rows] = parseCsvRows(String(text).replace(/^\uFEFF/, ""));
  const headers = header.map((cell) => cell.trim().toLowerCase().replace(/\s+/g, " "));
  const dateColumn = findColumn(headers, "date"); const descriptionColumn = findColumn(headers, "description");
  const amountColumn = findColumn(headers, "amount"); const debitColumn = findColumn(headers, "debit"); const creditColumn = findColumn(headers, "credit");
  if (descriptionColumn < 0 || (amountColumn < 0 && debitColumn < 0 && creditColumn < 0)) throw new Error("We couldn't identify merchant and amount columns. Supported exports include Chase, Bank of America, Wells Fargo, Capital One, Amex, Stripe, and PayPal.");
  const raw = rows.map((cells, index) => {
    const debit = numeric(cells[debitColumn]); const credit = numeric(cells[creditColumn]);
    const amount = amountColumn >= 0 ? numeric(cells[amountColumn]) : (Number.isFinite(debit) ? -Math.abs(debit) : Math.abs(credit));
    return { id: index, sourceIndex: index, date: String(cells[dateColumn] || "").trim(), rawDescription: String(cells[descriptionColumn] || "").trim(), description: cleanMerchant(cells[descriptionColumn]), amount };
  }).filter((row) => Number.isFinite(row.amount) && row.amount !== 0);
  // Split debit/credit files are unambiguous. For a signed amount column, deposits are
  // normally the sign minority with income language; retain both so audit ratios work.
  const expensesAreNegative = amountColumn >= 0 && raw.some((row) => row.amount < 0) && raw.some((row) => row.amount > 0);
  const transactions = raw.map((row) => {
    const debit = numeric(rows[row.sourceIndex][debitColumn]);
    const isSplitExpense = debitColumn >= 0 && Number.isFinite(debit) && debit !== 0;
    const kind = debitColumn >= 0
        ? (isSplitExpense ? "expense" : "income")
        : expensesAreNegative ? (row.amount < 0 ? "expense" : "income") : "expense";
    const { sourceIndex, ...transaction } = row;
    return { ...transaction, kind, amount: Math.abs(row.amount) };
  });
  return { transactions, detected: { date: headers[dateColumn], description: headers[descriptionColumn], amount: headers[amountColumn] || `${headers[debitColumn] || ""}/${headers[creditColumn] || ""}`, expensesAreNegative } };
};
