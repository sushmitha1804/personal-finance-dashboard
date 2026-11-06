require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "finora.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS settings (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 salary REAL NOT NULL DEFAULT 65000,
 currency TEXT NOT NULL DEFAULT 'INR',
 theme TEXT NOT NULL DEFAULT 'dark',
 monthly_budget REAL NOT NULL DEFAULT 25000,
 savings_target REAL NOT NULL DEFAULT 100000,
 savings_current REAL NOT NULL DEFAULT 25000,
 locale TEXT NOT NULL DEFAULT 'en-IN'
);
CREATE TABLE IF NOT EXISTS transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title TEXT NOT NULL,
 category TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('income','expense')),
 amount REAL NOT NULL CHECK(amount > 0),
 date TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS budgets (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 category TEXT NOT NULL,
 limit_amount REAL NOT NULL CHECK(limit_amount > 0),
 UNIQUE(user_id, category)
);
`);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: dataDir }),
  secret: process.env.SESSION_SECRET || "dev-only-change-this-secret-before-deployment",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(express.static(path.join(__dirname, "public")));

const defaultBudgets = [
 ["Food", 6000], ["Transport", 3000], ["Shopping", 5000], ["Bills", 4000], ["Health", 2500], ["Entertainment", 2500]
];
const today = () => new Date().toISOString().slice(0, 10);
function seedUser(userId) {
 const insert = db.prepare("INSERT INTO transactions(user_id,title,category,type,amount,date,note) VALUES(?,?,?,?,?,?,?)");
 const examples = [
  ["Monthly salary", "Salary", "income", 65000, today(), "Primary income"],
  ["Freelance project", "Freelance", "income", 8500, today(), "Side income"],
  ["Groceries", "Food", "expense", 1850, today(), "Weekly groceries"],
  ["Internet bill", "Bills", "expense", 999, today(), "Monthly connection"],
  ["Cab rides", "Transport", "expense", 620, today(), "Commute"],
  ["Coffee & lunch", "Food", "expense", 480, today(), "Meals"]
 ];
 const tx = db.transaction(() => {
  examples.forEach(x => insert.run(userId, ...x));
  const b = db.prepare("INSERT OR IGNORE INTO budgets(user_id,category,limit_amount) VALUES(?,?,?)");
  defaultBudgets.forEach(x => b.run(userId, ...x));
 });
 tx();
}
function userId(req) { return req.session.userId; }
function requireAuth(req, res, next) {
 if (!userId(req)) return res.status(401).json({ error: "Please sign in to continue." });
 next();
}
function safeUser(row) { return { id: row.id, name: row.name, email: row.email }; }
function getSettings(id) { return db.prepare("SELECT * FROM settings WHERE user_id=?").get(id); }
function getOverview(id) {
 const settings = getSettings(id);
 const tx = db.prepare("SELECT * FROM transactions WHERE user_id=? ORDER BY date DESC, id DESC").all(id);
 const month = today().slice(0, 7);
 const monthTx = tx.filter(t => t.date.startsWith(month));
 const income = monthTx.filter(t => t.type === "income").reduce((s,t) => s + t.amount, 0);
 const expenses = monthTx.filter(t => t.type === "expense").reduce((s,t) => s + t.amount, 0);
 const byCategory = {};
 monthTx.filter(t => t.type === "expense").forEach(t => byCategory[t.category] = (byCategory[t.category] || 0) + t.amount);
 const budgets = db.prepare("SELECT * FROM budgets WHERE user_id=? ORDER BY category").all(id).map(b => ({
   ...b, spent: byCategory[b.category] || 0, percent: Math.min(100, Math.round(((byCategory[b.category] || 0) / b.limit_amount) * 100))
 }));
 const goals = { current: settings.savings_current, target: settings.savings_target, percent: Math.min(100, Math.round(settings.savings_current / Math.max(settings.savings_target,1) * 100)) };
 return { settings, transactions: tx, stats: { income, expenses, balance: income-expenses, savingsRate: income > 0 ? Math.round((income-expenses)/income*100) : 0 }, categorySpending: byCategory, budgets, goals };
}
function validAmount(v) { return Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 1000000000; }

app.post("/api/auth/register", async (req,res) => {
 const name = String(req.body.name || "").trim();
 const email = String(req.body.email || "").trim().toLowerCase();
 const password = String(req.body.password || "");
 if (name.length < 2 || name.length > 80) return res.status(400).json({error:"Name must be 2–80 characters."});
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email address."});
 if (password.length < 8) return res.status(400).json({error:"Password must contain at least 8 characters."});
 try {
   const hash = await bcrypt.hash(password, 12);
   const result = db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name,email,hash);
   const id = Number(result.lastInsertRowid);
   db.prepare("INSERT INTO settings(user_id) VALUES(?)").run(id);
   seedUser(id);
   req.session.userId = id;
   res.json({ user: { id, name, email } });
 } catch(e) {
   if (String(e.code).includes("SQLITE_CONSTRAINT")) return res.status(409).json({error:"An account with that email already exists."});
   console.error(e); res.status(500).json({error:"Could not create account."});
 }
});
app.post("/api/auth/login", async (req,res) => {
 const email = String(req.body.email || "").trim().toLowerCase();
 const password = String(req.body.password || "");
 const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
 if (!user || !(await bcrypt.compare(password,user.password_hash))) return res.status(401).json({error:"Incorrect email or password."});
 req.session.regenerate(err => {
   if (err) return res.status(500).json({error:"Could not start session."});
   req.session.userId = user.id;
   res.json({ user: safeUser(user) });
 });
});
app.post("/api/auth/logout", (req,res) => req.session.destroy(() => { res.clearCookie("connect.sid"); res.json({ok:true}); }));
app.get("/api/auth/me", (req,res) => {
 if (!userId(req)) return res.json({user:null});
 const user = db.prepare("SELECT id,name,email FROM users WHERE id=?").get(userId(req));
 res.json({user: user || null});
});

app.get("/api/dashboard", requireAuth, (req,res) => res.json(getOverview(userId(req))));
app.post("/api/transactions", requireAuth, (req,res) => {
 const { title, category, type, amount, date, note="" } = req.body;
 if (!String(title||"").trim() || String(title).length > 100) return res.status(400).json({error:"Enter a title up to 100 characters."});
 if (!["income","expense"].includes(type)) return res.status(400).json({error:"Choose income or expense."});
 if (!validAmount(amount)) return res.status(400).json({error:"Enter an amount greater than zero."});
 const dateVal = String(date || today());
 if (!/^\d{4}-\d{2}-\d{2}$/.test(dateVal)) return res.status(400).json({error:"Enter a valid date."});
 db.prepare("INSERT INTO transactions(user_id,title,category,type,amount,date,note) VALUES(?,?,?,?,?,?,?)")
   .run(userId(req),String(title).trim(),String(category||"Other").slice(0,50),type,Number(amount),dateVal,String(note).slice(0,250));
 res.json(getOverview(userId(req)));
});
app.delete("/api/transactions/:id", requireAuth, (req,res) => {
 const result = db.prepare("DELETE FROM transactions WHERE id=? AND user_id=?").run(Number(req.params.id),userId(req));
 if (!result.changes) return res.status(404).json({error:"Transaction not found."});
 res.json(getOverview(userId(req)));
});
app.put("/api/transactions/:id", requireAuth, (req,res) => {
 const { title, category, type, amount, date, note="" } = req.body;
 if (!String(title||"").trim() || !["income","expense"].includes(type) || !validAmount(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(String(date||""))) return res.status(400).json({error:"Check the transaction fields."});
 const result = db.prepare("UPDATE transactions SET title=?,category=?,type=?,amount=?,date=?,note=? WHERE id=? AND user_id=?")
 .run(String(title).trim(),String(category||"Other").slice(0,50),type,Number(amount),String(date),String(note).slice(0,250),Number(req.params.id),userId(req));
 if (!result.changes) return res.status(404).json({error:"Transaction not found."});
 res.json(getOverview(userId(req)));
});
app.put("/api/settings", requireAuth, (req,res) => {
 const id = userId(req);
 const { name, salary, currency, theme, monthly_budget, savings_target, savings_current } = req.body;
 if (!String(name||"").trim() || String(name).length > 80) return res.status(400).json({error:"Enter a valid display name."});
 if (!Number.isFinite(Number(salary)) || Number(salary) < 0 || Number(salary) > 1000000000) return res.status(400).json({error:"Salary must be zero or greater."});
 if (!validAmount(monthly_budget) || !validAmount(savings_target) || !Number.isFinite(Number(savings_current)) || Number(savings_current) < 0) return res.status(400).json({error:"Check your budget and savings values."});
 if (!["INR","USD","EUR","GBP","AED","CAD","AUD"].includes(currency)) return res.status(400).json({error:"Unsupported currency."});
 if (!["dark","light"].includes(theme)) return res.status(400).json({error:"Unsupported theme."});
 db.prepare("UPDATE users SET name=? WHERE id=?").run(String(name).trim(),id);
 db.prepare("UPDATE settings SET salary=?,currency=?,theme=?,monthly_budget=?,savings_target=?,savings_current=? WHERE user_id=?")
 .run(Number(salary),currency,theme,Number(monthly_budget),Number(savings_target),Number(savings_current),id);
 // Keep exactly one designated monthly salary transaction, so changing salary never double-counts income.
 const salaryRows = db.prepare("SELECT id FROM transactions WHERE user_id=? AND category='Salary' ORDER BY id").all(id);
 if (salaryRows.length) {
   db.prepare("UPDATE transactions SET title='Monthly salary',amount=?,type='income',date=? WHERE id=?").run(Math.max(Number(salary),0.01),today(),salaryRows[0].id);
   if (salaryRows.length > 1) db.prepare("DELETE FROM transactions WHERE user_id=? AND category='Salary' AND id<>?").run(id,salaryRows[0].id);
 } else if (Number(salary) > 0) {
   db.prepare("INSERT INTO transactions(user_id,title,category,type,amount,date,note) VALUES(?,?,?,?,?,?,?)").run(id,"Monthly salary","Salary","income",Number(salary),today(),"Configured monthly salary");
 }
 res.json({user: db.prepare("SELECT id,name,email FROM users WHERE id=?").get(id), ...getOverview(id)});
});
app.get("/api/budgets", requireAuth, (req,res) => res.json(db.prepare("SELECT * FROM budgets WHERE user_id=? ORDER BY category").all(userId(req))));
app.post("/api/budgets", requireAuth, (req,res) => {
 const category = String(req.body.category||"").trim().slice(0,50);
 const amount = Number(req.body.limit_amount);
 if (!category || !validAmount(amount)) return res.status(400).json({error:"Enter a category and a positive budget."});
 db.prepare("INSERT INTO budgets(user_id,category,limit_amount) VALUES(?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET limit_amount=excluded.limit_amount")
 .run(userId(req),category,amount);
 res.json(getOverview(userId(req)));
});
app.delete("/api/budgets/:id", requireAuth, (req,res) => {
 db.prepare("DELETE FROM budgets WHERE id=? AND user_id=?").run(Number(req.params.id),userId(req));
 res.json(getOverview(userId(req)));
});
app.get("/api/export.csv", requireAuth, (req,res) => {
 const rows = db.prepare("SELECT date,title,category,type,amount,note FROM transactions WHERE user_id=? ORDER BY date DESC").all(userId(req));
 const cell = v => '"' + String(v ?? "").replace(/"/g,'""') + '"';
 const csv = ["Date,Title,Category,Type,Amount,Note",...rows.map(r => [r.date,r.title,r.category,r.type,r.amount,r.note].map(cell).join(","))].join("\r\n");
 res.setHeader("Content-Type","text/csv; charset=utf-8");
 res.setHeader("Content-Disposition",'attachment; filename="finora-transactions.csv"');
 res.send(csv);
});
app.get("*", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, () => console.log(`Finora is running at http://localhost:${PORT}`));