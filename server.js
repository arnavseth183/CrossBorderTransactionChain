// server.js - TransactChain (Complete)
const express = require("express");
const path = require("path");
const bodyParser = require("body-parser");
const session = require("express-session");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 3000;

// Paths for persistent JSON (mock CouchDB)
const DB_DIR = path.join(__dirname, "couchdb");
const ACCOUNTS_FILE = path.join(DB_DIR, "accounts.json");
const TX_FILE = path.join(DB_DIR, "transactions.json");

// Ensure db folder & files exist
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
if (!fs.existsSync(ACCOUNTS_FILE)) fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify([], null, 2));
if (!fs.existsSync(TX_FILE)) fs.writeFileSync(TX_FILE, JSON.stringify([], null, 2));

// Helpers
function readJSON(fp) {
  try {
    const raw = fs.readFileSync(fp, "utf8");
    return JSON.parse(raw || "[]");
  } catch (e) {
    console.error("readJSON error", e);
    return [];
  }
}
function writeJSON(fp, data) {
  try {
    fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("writeJSON error", e);
  }
}

function generateAddress() {
  return "0x" + uuidv4().replace(/-/g, "").slice(0, 40);
}

// Real-world based mock cross-border fee mapping (%) - editable
const COUNTRY_FEES = {
  "USA": 1.5,
  "UK": 1.8,
  "India": 2.0,
  "Germany": 1.6,
  "Japan": 1.4,
  "Australia": 1.9,
  "Canada": 1.7,
  "UAE": 2.2,
  "Singapore": 1.3,
  "France": 1.5
};

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public")));
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(session({
  secret: "transactchain-secret-please-change",
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 60 * 60 * 1000 } // 1 hour
}));

// Auth middlewares
function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  res.redirect("/login");
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === "admin") return next();
  res.status(403).send("Access denied.");
}
function requireBank(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === "bank") return next();
  res.status(403).send("Access denied.");
}

// --- Routes ---

// Home
app.get("/", (req, res) => {
  res.render("index", { user: req.session.user || null });
});

// Register page
app.get("/register", (req, res) => {
  res.render("register", { user: req.session.user || null, error: null });
});

// Register handler
app.post("/register", (req, res) => {
  const { username, email, password, role, country, spareSentence, deleteSecret } = req.body;
  if (!username || !email || !password || !role || !country) {
    return res.render("register", { user: req.session.user || null, error: "All fields required." });
  }

  const accounts = readJSON(ACCOUNTS_FILE);
  if (accounts.find(a => a.email === email)) {
    return res.render("register", { user: req.session.user || null, error: "Email already registered." });
  }

  const address = generateAddress();
  // Admins are not allotted funds (balance 0); others get mock initial balance
  const initialBalance = (role.toLowerCase() === "admin") ? 0 : 10000;

  const account = {
    id: uuidv4(),
    username,
    email,
    password,
    role: role.toLowerCase(), // "bank" or "customer" or "admin"
    country,
    address,
    balance: initialBalance,
    spareSentence: spareSentence || "",
    deleteSecret: deleteSecret || "",
    createdAt: new Date().toISOString()
  };

  accounts.push(account);
  writeJSON(ACCOUNTS_FILE, accounts);

  // Auto-login after registration
  req.session.user = { username: account.username, email: account.email, role: account.role, address: account.address };
  res.redirect("/dashboard");
});

// Login page
app.get("/login", (req, res) => {
  res.render("login", { error: null });
});

// Login handler
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  const accounts = readJSON(ACCOUNTS_FILE);
  const user = accounts.find(u => u.email === email && u.password === password);
  if (!user) {
    return res.render("login", { error: "Invalid credentials" });
  }
  req.session.user = { username: user.username, email: user.email, role: user.role, address: user.address };
  res.redirect("/dashboard");
});

// Dashboard (user)
app.get("/dashboard", requireLogin, (req, res) => {
  const accounts = readJSON(ACCOUNTS_FILE);
  const txns = readJSON(TX_FILE);

  // refresh user's latest balance & info from persistent store
  const user = accounts.find(a => a.email === req.session.user.email);
  req.session.user = { username: user.username, email: user.email, role: user.role, address: user.address };

  // user's own transactions (in/out)
  const userTxns = txns.filter(t => t.fromAddress === user.address || t.toAddress === user.address)
                       .sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));

  res.render("dashboard", { user, transactions: userTxns });
});

// Transfer page
app.get("/transfer", requireLogin, (req, res) => {
  // disallow admins from accessing transfer page
  if (req.session.user && req.session.user.role === "admin") {
    return res.redirect("/dashboard");
  }

  // show list of possible recipients (exclude self and admins)
  const accounts = readJSON(ACCOUNTS_FILE);
  const recipients = accounts.filter(a => a.email !== req.session.user.email && a.role !== "admin");
  const sender = accounts.find(a => a.email === req.session.user.email);
  res.render("transfer", { user: sender, recipients, error: null });
});

// Perform transfer
app.post("/transfer", requireLogin, (req, res) => {
  // disallow admins from performing transfers
  if (req.session.user && req.session.user.role === "admin") {
    return res.redirect("/dashboard");
  }

  const { toAddress, amount, note } = req.body;
  const amt = Number(amount);
  if (!toAddress || !amt || amt <= 0) {
    const recipients = readJSON(ACCOUNTS_FILE).filter(a => a.email !== req.session.user.email && a.role !== "admin");
    return res.render("transfer", { user: req.session.user, recipients, error: "Invalid input." });
  }

  const accounts = readJSON(ACCOUNTS_FILE);
  const sender = accounts.find(a => a.email === req.session.user.email);
  const receiver = accounts.find(a => a.address === toAddress);

  if (!sender || !receiver) return res.send("Invalid sender or receiver.");
  if (sender.balance < amt) {
    const recipients = accounts.filter(a => a.email !== req.session.user.email && a.role !== "admin");
    return res.render("transfer", { user: req.session.user, recipients, error: "Insufficient balance." });
  }

  // Calculate cross-border fee (variable)
  let fee = 0;
  let crossBorder = false;
  if (sender.country && receiver.country && sender.country !== receiver.country) {
    crossBorder = true;
    const sFee = COUNTRY_FEES[sender.country] !== undefined ? COUNTRY_FEES[sender.country] : 2.0;
    const rFee = COUNTRY_FEES[receiver.country] !== undefined ? COUNTRY_FEES[receiver.country] : 2.0;
    // Using average of sender & receiver country rates to compute fee percent
    const feePercent = (sFee + rFee) / 2;
    fee = (feePercent / 100) * amt;
  }

  const totalDebit = amt + fee;
  if (sender.balance < totalDebit) {
    const recipients = accounts.filter(a => a.email !== req.session.user.email && a.role !== "admin");
    return res.render("transfer", { user: req.session.user, recipients, error: "Insufficient balance to cover fee." });
  }

  // Update balances
  sender.balance = Number(sender.balance) - totalDebit;
  receiver.balance = Number(receiver.balance) + amt;
  writeJSON(ACCOUNTS_FILE, accounts);

  // Create transaction record (include fee & crossBorder)
  const tx = {
    id: "TX-" + uuidv4(),
    fromAddress: sender.address,
    fromEmail: sender.email,
    toAddress: receiver.address,
    toEmail: receiver.email,
    amount: amt,
    fee: Number(fee.toFixed(2)),
    crossBorder,
    fromCountry: sender.country || "",
    toCountry: receiver.country || "",
    timestamp: new Date().toISOString(),
    note: note || ""
  };

  const txns = readJSON(TX_FILE);
  txns.push(tx);
  writeJSON(TX_FILE, txns);

  res.redirect("/dashboard");
});

// Bank view: can view all customer accounts (read-only)
app.get("/bank/accounts", requireLogin, requireBank, (req, res) => {
  const accounts = readJSON(ACCOUNTS_FILE).filter(a => a.role === "customer");
  res.render("bank_view", { bank: req.session.user, accounts });
});

// Admin view: view all transactions (audit)
app.get("/admin/transactions", requireLogin, requireAdmin, (req, res) => {
  const txns = readJSON(TX_FILE).sort((a,b)=> new Date(b.timestamp)-new Date(a.timestamp));
  res.render("admin_view", { admin: req.session.user, transactions: txns });
});

// Admin view: view all accounts
app.get("/admin/accounts", requireLogin, requireAdmin, (req, res) => {
  const accounts = readJSON(ACCOUNTS_FILE).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.render("admin_accounts", { admin: req.session.user, accounts });
});

// API endpoints (optional)
app.get("/api/accounts", requireLogin, (req, res) => {
  const accounts = readJSON(ACCOUNTS_FILE);
  if (req.session.user.role === "bank") {
    return res.json(accounts.filter(a => a.role === "customer"));
  } else if (req.session.user.role === "admin") {
    return res.json(accounts);
  } else {
    const me = accounts.find(a => a.email === req.session.user.email);
    return res.json(me || {});
  }
});

app.get("/api/transactions", requireLogin, (req, res) => {
  const txns = readJSON(TX_FILE);
  if (req.session.user.role === "admin") return res.json(txns);
  const myaddr = req.session.user.address;
  return res.json(txns.filter(t => t.fromAddress === myaddr || t.toAddress === myaddr));
});

// Account deletion - show form
app.get("/account/delete", requireLogin, (req, res) => {
  // show a page where user enters their delete secret
  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Delete Account</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; }
          .card { max-width:600px; margin: 0 auto; padding:18px; border-radius:8px; box-shadow: 0 6px 18px rgba(0,0,0,0.06); }
          label, input, button { display:block; width:100%; }
          input { padding:10px; margin:8px 0; border-radius:6px; }
          button { padding:10px; background:#c62828; color:#fff; border:none; border-radius:6px; cursor:pointer; }
        </style>
      </head>
      <body>
        <div class="card">
          <h2>Delete Account</h2>
          <p>To delete your account, please enter the secret message you set during registration. This helps prevent accidental deletion.</p>
          <form method="POST" action="/account/delete">
            <label>Secret message</label>
            <input name="deleteSecret" type="password" required />
            <button type="submit">Delete my account</button>
          </form>
          <p style="margin-top:12px;"><a href="/dashboard">Back</a></p>
        </div>
      </body>
    </html>
  `);
});

// Account deletion handler
app.post("/account/delete", requireLogin, (req, res) => {
  const { deleteSecret } = req.body;
  const accounts = readJSON(ACCOUNTS_FILE);
  const user = accounts.find(a => a.email === req.session.user.email);
  if (!user) return res.redirect("/login");

  // check secret
  if (!user.deleteSecret || user.deleteSecret !== deleteSecret) {
    return res.send(`
      <p>Secret does not match. Account NOT deleted.</p>
      <p><a href="/account/delete">Try again</a> | <a href="/dashboard">Cancel</a></p>
    `);
  }

  // remove account
  const remaining = accounts.filter(a => a.email !== user.email);
  writeJSON(ACCOUNTS_FILE, remaining);

  // destroy session and confirm
  req.session.destroy(() => {
    res.send(`
      <p>Your account has been deleted.</p>
      <p><a href="/">Home</a></p>
    `);
  });
});

// Logout
app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 TransactChain running at http://localhost:${PORT}`);
});
