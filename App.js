const express = require("express");
const path = require("path");
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json({ limit: "5mb" }));

// --- Database (sqlite) ---
const DB_FILE = path.join(__dirname, "customers.db");
const db = new sqlite3.Database(DB_FILE);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    city TEXT,
    state TEXT,
    pincode TEXT,
    email TEXT,
    account_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS addresses (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    line1 TEXT NOT NULL,
    line2 TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    country TEXT,
    is_primary INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    detail TEXT,
    amount REAL,
    created_at TEXT NOT NULL
  )`);

  // seed small data if empty
  db.get("SELECT COUNT(*) as c FROM customers", (err, r) => {
    if (err) return console.error(err);
    if (r.c === 0) {
      const now = new Date().toISOString();
      const cust1 = uuidv4();
      const cust2 = uuidv4();
      db.run(
        `INSERT INTO customers (id, first_name, last_name, phone, city, state, pincode, email, account_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cust1, "Alice", "Wong", "9876543210", "Chennai", "Tamil Nadu", "600001", "alice@example.com", "Retail", now, now]
      );
      db.run(
        `INSERT INTO customers (id, first_name, last_name, phone, city, state, pincode, email, account_type, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [cust2, "Ravi", "Kumar", "9123456780", "Bengaluru", "Karnataka", "560001", "ravi@example.com", "Wholesale", now, now]
      );

      const addr1 = uuidv4();
      const addr2 = uuidv4();
      db.run(
        `INSERT INTO addresses (id, customer_id, line1, city, state, pincode, country, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [addr1, cust1, "12 MG Road", "Chennai", "Tamil Nadu", "600001", "India", 1, now, now]
      );
      db.run(
        `INSERT INTO addresses (id, customer_id, line1, city, state, pincode, country, is_primary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [addr2, cust2, "4 Bannerghatta Rd", "Bengaluru", "Karnataka", "560001", "India", 1, now, now]
      );

      // add an example transaction for cust2 to demonstrate delete-check
      const tx1 = uuidv4();
      db.run(
        `INSERT INTO transactions (id, customer_id, detail, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
        [tx1, cust2, "Order #1001", 1500.0, now]
      );
    }
  });
});

// --- Utilities & Validation ---
function validateCustomerPayload(payload, requireAll = true) {
  const errors = [];
  const phoneRegex = /^\d{10}$/;
  if (requireAll || payload.first_name !== undefined) {
    if (!payload.first_name || payload.first_name.trim().length < 1) errors.push("first_name");
  }
  if (requireAll || payload.last_name !== undefined) {
    if (!payload.last_name || payload.last_name.trim().length < 1) errors.push("last_name");
  }
  if (requireAll || payload.phone !== undefined) {
    if (!payload.phone || !phoneRegex.test(payload.phone)) errors.push("phone");
  }
  if (requireAll || payload.pincode !== undefined) {
    if (payload.pincode && !/^\d{5,7}$/.test(payload.pincode)) errors.push("pincode");
  }
  return errors;
}

// --- API: Customers ---
// Create customer
app.post("/api/customers", (req, res) => {
  const payload = req.body || {};
  const errs = validateCustomerPayload(payload, true);
  if (errs.length) return res.status(400).json({ error: "validation_failed", fields: errs });

  // server-side rule: no duplicate email
  if (payload.email) {
    db.get("SELECT id FROM customers WHERE email = ?", [payload.email], (err, row) => {
      if (err) return res.status(500).json({ error: "db_error" });
      if (row) return res.status(409).json({ error: "email_exists" });
      insertCustomer();
    });
  } else {
    insertCustomer();
  }

  function insertCustomer() {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO customers (id, first_name, last_name, phone, city, state, pincode, email, account_type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payload.first_name.trim(),
        payload.last_name.trim(),
        payload.phone.trim(),
        payload.city || null,
        payload.state || null,
        payload.pincode || null,
        payload.email || null,
        payload.account_type || null,
        now,
        now,
      ],
      function (err) {
        if (err) return res.status(500).json({ error: "db_insert_failed" });
        // optionally create an address if provided
        if (payload.address && payload.address.line1) {
          const addrId = uuidv4();
          db.run(
            `INSERT INTO addresses (id, customer_id, line1, line2, city, state, pincode, country, is_primary, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              addrId,
              id,
              payload.address.line1,
              payload.address.line2 || null,
              payload.address.city || null,
              payload.address.state || null,
              payload.address.pincode || null,
              payload.address.country || "India",
              1,
              now,
              now,
            ],
            (e) => {
              // ignore address errors for now
              return res.status(201).json({ id });
            }
          );
        } else {
          return res.status(201).json({ id });
        }
      }
    );
  }
});

// Read customers with filters, pagination, sorting, search
// Query params: page, pageSize, city, state, pincode, search, sortBy, sortDir, onlyMultipleAddresses=true
app.get("/api/customers", (req, res) => {
  let { page = 1, pageSize = 10, city, state, pincode, search, sortBy = "created_at", sortDir = "DESC", onlyMultipleAddresses } = req.query;
  page = parseInt(page);
  pageSize = parseInt(pageSize);
  const offset = (page - 1) * pageSize;

  // Base query
  const filters = [];
  const params = [];

  if (city) {
    filters.push("c.city = ?");
    params.push(city);
  }
  if (state) {
    filters.push("c.state = ?");
    params.push(state);
  }
  if (pincode) {
    filters.push("c.pincode = ?");
    params.push(pincode);
  }
  if (search) {
    filters.push("(c.first_name LIKE ? OR c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)");
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  // If onlyMultipleAddresses flag provided, we join and group
  let base = `FROM customers c`;
  if (onlyMultipleAddresses === "true") {
    base = `FROM customers c JOIN addresses a ON c.id = a.customer_id`;
  }

  const where = filters.length ? "WHERE " + filters.join(" AND ") : "";

  // For multiple address condition we HAVING count>1
  let groupHaving = "";
  if (onlyMultipleAddresses === "true") {
    groupHaving = "GROUP BY c.id HAVING COUNT(a.id) > 1";
  }

  // Total count
  const countQuery = `SELECT COUNT(DISTINCT c.id) as total ${base} ${where} ${groupHaving}`;
  db.get(countQuery, params, (err, row) => {
    if (err) return res.status(500).json({ error: "db_error" });
    const total = row.total || 0;

    // Data query
    const dataQuery = `SELECT DISTINCT c.* ${base} ${where} ${groupHaving} ORDER BY c.${sortBy} ${sortDir} LIMIT ? OFFSET ?`;
    const dataParams = params.slice();
    dataParams.push(pageSize, offset);
    db.all(dataQuery, dataParams, (err2, rows) => {
      if (err2) return res.status(500).json({ error: "db_error" });

      // For each customer, include addresses count and a flag onlyOneAddress
      const ids = rows.map((r) => r.id);
      if (ids.length === 0) return res.json({ total, page, pageSize, data: [] });

      db.all(
        `SELECT customer_id, COUNT(*) as cnt FROM addresses WHERE customer_id IN (${ids.map(() => "?").join(",")}) GROUP BY customer_id`,
        ids,
        (err3, counts) => {
          const cntMap = {};
          counts.forEach((c) => (cntMap[c.customer_id] = c.cnt));
          const final = rows.map((r) => {
            const cnt = cntMap[r.id] || 0;
            return {
              ...r,
              address_count: cnt,
              onlyOneAddress: cnt === 1,
            };
          });
          res.json({ total, page, pageSize, data: final });
        }
      );
    });
  });
});

// Get single customer (with addresses and transactions)
app.get("/api/customers/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT * FROM customers WHERE id = ?", [id], (err, cust) => {
    if (err) return res.status(500).json({ error: "db_error" });
    if (!cust) return res.status(404).json({ error: "not_found" });
    db.all("SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_primary DESC, created_at DESC", [id], (err2, addrs) => {
      if (err2) return res.status(500).json({ error: "db_error" });
      db.all("SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC", [id], (err3, txs) => {
        if (err3) return res.status(500).json({ error: "db_error" });
        cust.addresses = addrs;
        cust.transactions = txs;
        cust.onlyOneAddress = addrs.length === 1;
        res.json(cust);
      });
    });
  });
});

// Update customer
app.put("/api/customers/:id", (req, res) => {
  const id = req.params.id;
  const payload = req.body || {};
  const errs = validateCustomerPayload(payload, false); // partial allowed
  if (errs.length) return res.status(400).json({ error: "validation_failed", fields: errs });

  // prepare set clause
  const fields = [];
  const params = [];
  ["first_name", "last_name", "phone", "city", "state", "pincode", "email", "account_type"].forEach((k) => {
    if (payload[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(payload[k]);
    }
  });
  if (fields.length === 0) return res.status(400).json({ error: "no_fields" });
  params.push(new Date().toISOString(), id);
  const sql = `UPDATE customers SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`;
  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: "db_error" });
    if (this.changes === 0) return res.status(404).json({ error: "not_found" });
    res.json({ updated: true });
  });
});

// Delete customer (check linked transactions)
app.delete("/api/customers/:id", (req, res) => {
  const id = req.params.id;
  // check transactions
  db.get("SELECT COUNT(*) as c FROM transactions WHERE customer_id = ?", [id], (err, r) => {
    if (err) return res.status(500).json({ error: "db_error" });
    if (r.c > 0) return res.status(400).json({ error: "linked_transactions", count: r.c });
    // safe to delete (addresses cascade)
    db.run("DELETE FROM customers WHERE id = ?", [id], function (er) {
      if (er) return res.status(500).json({ error: "db_error" });
      if (this.changes === 0) return res.status(404).json({ error: "not_found" });
      res.json({ deleted: true });
    });
  });
});

// --- Addresses API ---
// List addresses for a customer
app.get("/api/customers/:id/addresses", (req, res) => {
  const id = req.params.id;
  db.all("SELECT * FROM addresses WHERE customer_id = ? ORDER BY is_primary DESC, created_at DESC", [id], (err, rows) => {
    if (err) return res.status(500).json({ error: "db_error" });
    res.json(rows);
  });
});

// Create address
app.post("/api/customers/:id/addresses", (req, res) => {
  const customerId = req.params.id;
  const payload = req.body || {};
  if (!payload.line1) return res.status(400).json({ error: "line1_required" });

  // check customer exists
  db.get("SELECT id FROM customers WHERE id = ?", [customerId], (err, row) => {
    if (err) return res.status(500).json({ error: "db_error" });
    if (!row) return res.status(404).json({ error: "customer_not_found" });
    const id = uuidv4();
    const now = new Date().toISOString();
    const isPrimary = payload.is_primary ? 1 : 0;
    db.run(
      `INSERT INTO addresses (id, customer_id, line1, line2, city, state, pincode, country, is_primary, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, customerId, payload.line1, payload.line2 || null, payload.city || null, payload.state || null, payload.pincode || null, payload.country || "India", isPrimary, now, now],
      function (err2) {
        if (err2) return res.status(500).json({ error: "db_error" });
        // if marked primary, unset others
        if (isPrimary) {
          db.run("UPDATE addresses SET is_primary = 0 WHERE customer_id = ? AND id != ?", [customerId, id]);
        }
        res.status(201).json({ id });
      }
    );
  });
});

// Update address
app.put("/api/addresses/:id", (req, res) => {
  const id = req.params.id;
  const payload = req.body || {};
  const fields = [];
  const params = [];
  ["line1", "line2", "city", "state", "pincode", "country"].forEach((k) => {
    if (payload[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(payload[k]);
    }
  });
  if (payload.is_primary !== undefined) {
    fields.push(`is_primary = ?`);
    params.push(payload.is_primary ? 1 : 0);
  }
  if (fields.length === 0) return res.status(400).json({ error: "no_fields" });
  params.push(new Date().toISOString(), id);
  const sql = `UPDATE addresses SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`;
  db.run(sql, params, function (err) {
    if (err) return res.status(500).json({ error: "db_error" });
    if (this.changes === 0) return res.status(404).json({ error: "not_found" });
    // if is_primary was set, unset others
    if (payload.is_primary) {
      // find the customer_id
      db.get("SELECT customer_id FROM addresses WHERE id = ?", [id], (e, row) => {
        if (!e && row) {
          db.run("UPDATE addresses SET is_primary = 0 WHERE customer_id = ? AND id != ?", [row.customer_id, id]);
        }
      });
    }
    res.json({ updated: true });
  });
});

// Delete address
app.delete("/api/addresses/:id", (req, res) => {
  const id = req.params.id;
  db.get("SELECT customer_id FROM addresses WHERE id = ?", [id], (err, row) => {
    if (err) return res.status(500).json({ error: "db_error" });
    if (!row) return res.status(404).json({ error: "not_found" });
    db.run("DELETE FROM addresses WHERE id = ?", [id], function (er) {
      if (er) return res.status(500).json({ error: "db_error" });
      // after delete, if customer has only one address left, ensure its is_primary = 1
      const customerId = row.customer_id;
      db.all("SELECT id FROM addresses WHERE customer_id = ?", [customerId], (e2, rows) => {
        if (!e2 && rows.length === 1) {
          db.run("UPDATE addresses SET is_primary = 1 WHERE id = ?", [rows[0].id]);
        }
      });
      res.json({ deleted: true });
    });
  });
});

// --- Simple logging & error middleware ---
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// --- Serve Frontend (single page app) ---
app.get("/", (req, res) => {
  res.type("html").send(HTML_PAGE);
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// ----------------- FRONTEND: React App (served as inline HTML) -----------------
const HTML_PAGE = `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Customer CRUD Demo</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, Roboto, "Segoe UI", Arial; margin:0; background:#f3f4f6; color:#111827; }
    header{background:#0f172a;color:#fff;padding:14px 20px}
    .container{max-width:1100px;margin:20px auto;padding:18px;background:#fff;border-radius:8px;box-shadow:0 6px 20px rgba(2,6,23,0.08)}
    .grid{display:grid;grid-template-columns:1fr 320px;gap:18px}
    input,select,textarea{width:100%;padding:10px;margin-top:6px;border-radius:6px;border:1px solid #e5e7eb}
    button{padding:10px 12px;border-radius:6px;border:none;background:#0ea5a4;color:white;cursor:pointer}
    .muted{color:#6b7280}
    table{width:100%;border-collapse:collapse}
    th,td{padding:8px;border-bottom:1px solid #e6e7eb;text-align:left}
    .card{padding:12px;border:1px solid #e6e7eb;border-radius:8px;background:#fff}
    .small{font-size:13px}
    .flex{display:flex;gap:8px;align-items:center}
    .btn-danger{background:#ef4444}
    .btn-secondary{background:#64748b}
    .chips{display:flex;gap:6px;flex-wrap:wrap}
    .chip{background:#eef2ff;padding:6px 8px;border-radius:999px;font-size:13px}
    nav a{margin-right:12px;color:#bae6fd;text-decoration:none}
    .list-item{padding:10px;border-radius:8px;border:1px solid #eef2ff;margin-bottom:8px}
    .address{background:#f8fafc;padding:8px;border-radius:6px;margin-top:6px}
    .error{color:#dc2626}
  </style>
  <!-- React + ReactDOM + React Router (UMD) + Babel for JSX (dev-only) -->
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-router-dom@6/umd/react-router-dom.development.js"></script>
  <script src="https://unpkg.com/axios/dist/axios.min.js"></script>
</head>
<body>
  <header>
    <div style="max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;align-items:center">
      <div><strong>Customer Manager (Demo)</strong><div class="small">React + Express + SQLite</div></div>
      <nav>
        <a href="/" data-link>List</a>
        <a href="/create" data-link>Create</a>
      </nav>
    </div>
  </header>
  <div id="root" style="max-width:1100px;margin:20px auto;padding:0 14px"></div>

  <script type="text/babel">
    const { useState, useEffect } = React;
    const { BrowserRouter, Routes, Route, Link, useNavigate, useParams, useLocation } = ReactRouterDOM;

    const api = axios.create({ baseURL: '/api' });

    function useQuery() {
      return new URLSearchParams(useLocation().search);
    }

    function ListView(){
      const [data, setData] = useState([]);
      const [page, setPage] = useState(1);
      const [pageSize] = useState(8);
      const [total, setTotal] = useState(0);
      const [filters, setFilters] = useState({ city:'', state:'', pincode:'', search:'', onlyMultiple:false, sortBy:'created_at', sortDir:'DESC' });
      const [loading, setLoading] = useState(false);
      const navigate = useNavigate();

      useEffect(()=> fetchData(), [page, filters]);

      function fetchData(){
        setLoading(true);
        const params = {
          page, pageSize,
          city: filters.city || undefined,
          state: filters.state || undefined,
          pincode: filters.pincode || undefined,
          search: filters.search || undefined,
          onlyMultipleAddresses: filters.onlyMultiple ? 'true' : undefined,
          sortBy: filters.sortBy,
          sortDir: filters.sortDir
        };
        api.get('/customers',{params}).then(r=>{
          setData(r.data.data); setTotal(r.data.total); setLoading(false);
        }).catch(e=>{console.error(e); setLoading(false)});
      }

      function clearFilters(){
        setFilters({city:'',state:'',pincode:'',search:'',onlyMultiple:false, sortBy:'created_at', sortDir:'DESC'});
        setPage(1);
      }

      function delCustomer(id){
        if(!confirm('Delete customer? This will fail if linked transactions exist.')) return;
        api.delete('/customers/'+id).then(()=> { alert('Deleted'); fetchData(); }).catch(err=>{
          alert('Delete failed: '+ (err.response?.data?.error || err.message));
        });
      }

      return <div className="container card">
        <h2>Customers</h2>
        <div style={{display:'flex',gap:12, marginBottom:12}}>
          <div style={{flex:1}}>
            <input placeholder="Search name, email, phone" value={filters.search} onChange={e=>setFilters(s=>({...s,search:e.target.value}))}/>
          </div>
          <div style={{width:140}}>
            <input placeholder="City" value={filters.city} onChange={e=>setFilters(s=>({...s,city:e.target.value}))}/>
          </div>
          <div style={{width:140}}>
            <input placeholder="State" value={filters.state} onChange={e=>setFilters(s=>({...s,state:e.target.value}))}/>
          </div>
          <div style={{width:140}}>
            <input placeholder="Pincode" value={filters.pincode} onChange={e=>setFilters(s=>({...s,pincode:e.target.value}))}/>
          </div>
          <div>
            <label style={{display:'flex',alignItems:'center',gap:6}}><input type="checkbox" checked={filters.onlyMultiple} onChange={e=>setFilters(s=>({...s,onlyMultiple:e.target.checked}))}/>Only Multiple</label>
          </div>
          <div>
            <button onClick={()=>{ setPage(1); fetchData(); }}>Apply</button>
          </div>
          <div>
            <button className="btn-secondary" onClick={clearFilters}>Clear</button>
          </div>
        </div>

        {loading ? <div>Loading...</div> : <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12}}>
            {data.map(c => <div key={c.id} className="list-item">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <strong>{c.first_name} {c.last_name}</strong>
                  <div className="small muted">{c.email || ''} · {c.phone}</div>
                </div>
                <div className="small muted">Addresses: {c.address_count || 0}</div>
              </div>
              <div style={{marginTop:8}} className="flex">
                <button onClick={()=>navigate('/view/'+c.id)}>View</button>
                <button className="btn-secondary" onClick={()=>navigate('/edit/'+c.id)}>Edit</button>
                <button className="btn-danger" onClick={()=>delCustomer(c.id)}>Delete</button>
              </div>
            </div>)}
          </div>
          <div style={{marginTop:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div className="small muted">Total: {total}</div>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page<=1}>Prev</button>
              <div>Page {page}</div>
              <button onClick={()=>setPage(p=>p+1)} disabled={page*pageSize >= total}>Next</button>
            </div>
          </div>
        </>}
      </div>;
    }

    function CustomerForm({isEdit=false}){
      const [state,setState] = useState({first_name:'',last_name:'',phone:'',email:'',city:'',state:'',pincode:'',account_type:''});
      const [error,setError] = useState(null);
      const navigate = useNavigate();
      const params = useParams();

      useEffect(()=>{
        if(isEdit){
          api.get('/customers/'+params.id).then(r=> setState({...r.data})).catch(e=>setError('Failed load'));
        }
      },[]);

      function validate(){
        const errs = [];
        if(!state.first_name) errs.push('first_name');
        if(!state.last_name) errs.push('last_name');
        if(!/^[0-9]{10}$/.test(state.phone||'')) errs.push('phone');
        return errs;
      }

      function submit(e){
        e.preventDefault();
        const errs = validate();
        if(errs.length) { setError('Validation failed: '+errs.join(', ')); return; }
        if(isEdit){
          api.put('/customers/'+params.id, state).then(()=>{ alert('Updated'); navigate('/'); }).catch(e=>setError('Update failed: '+(e.response?.data?.error||e.message)));
        } else {
          api.post('/customers', state).then(r=>{ alert('Created id: '+r.data.id); navigate('/view/'+r.data.id); }).catch(e=>setError('Create failed: '+(e.response?.data?.error||e.message)));
        }
      }

      return <div className="container card">
        <h2>{isEdit? 'Edit Customer' : 'Create Customer'}</h2>
        {error && <div className="error">{error}</div>}
        <form onSubmit={submit}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div>
              <label>First Name</label>
              <input value={state.first_name||''} onChange={e=>setState(s=>({...s,first_name:e.target.value}))}/>
            </div>
            <div>
              <label>Last Name</label>
              <input value={state.last_name||''} onChange={e=>setState(s=>({...s,last_name:e.target.value}))}/>
            </div>
            <div>
              <label>Phone</label>
              <input value={state.phone||''} onChange={e=>setState(s=>({...s,phone:e.target.value}))}/>
            </div>
            <div>
              <label>Email</label>
              <input value={state.email||''} onChange={e=>setState(s=>({...s,email:e.target.value}))}/>
            </div>
            <div>
              <label>City</label>
              <input value={state.city||''} onChange={e=>setState(s=>({...s,city:e.target.value}))}/>
            </div>
            <div>
              <label>State</label>
              <input value={state.state||''} onChange={e=>setState(s=>({...s,state:e.target.value}))}/>
            </div>
            <div>
              <label>Pincode</label>
              <input value={state.pincode||''} onChange={e=>setState(s=>({...s,pincode:e.target.value}))}/>
            </div>
            <div>
              <label>Account Type</label>
              <select value={state.account_type||''} onChange={e=>setState(s=>({...s,account_type:e.target.value}))}>
                <option value="">Select</option><option>Retail</option><option>Wholesale</option>
              </select>
            </div>
          </div>
          <div style={{marginTop:12}}>
            <button type="submit">{isEdit? 'Save' : 'Create'}</button>
            <button className="btn-secondary" type="button" onClick={()=>navigate('/')}>Cancel</button>
          </div>
        </form>
      </div>;
    }

    function CustomerView(){
      const params = useParams();
      const [customer, setCustomer] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [addrForm, setAddrForm] = useState({line1:'',city:'',state:'',pincode:'',country:'India',is_primary:false});

      useEffect(()=> load(), []);
      function load(){ setLoading(true); api.get('/customers/'+params.id).then(r=>{ setCustomer(r.data); setLoading(false); }).catch(e=>{setError('Failed'); setLoading(false)}); }

      function addAddress(){
        if(!addrForm.line1) return alert('line1 required');
        api.post('/customers/'+params.id+'/addresses', addrForm).then(()=>{ setAddrForm({line1:'',city:'',state:'',pincode:'',country:'India',is_primary:false}); load(); }).catch(e=>alert('Add failed'));
      }

      function updateAddress(id, patch){
        api.put('/addresses/'+id, patch).then(()=>load()).catch(e=>alert('Update failed'));
      }
      function deleteAddress(id){
        if(!confirm('Delete address?')) return;
        api.delete('/addresses/'+id).then(()=>load()).catch(e=>alert('Delete failed'));
      }

      if(loading) return <div className="container card">Loading...</div>;
      if(error) return <div className="container card error">{error}</div>;
      if(!customer) return <div className="container card">Not found</div>;

      return <div className="container card">
        <h2>{customer.first_name} {customer.last_name}</h2>
        <div className="small muted">{customer.email} · {customer.phone}</div>
        <div style={{marginTop:12}}>
          <strong>Addresses</strong>
          {customer.addresses.length === 0 && <div className="muted small">No addresses</div>}
          {customer.addresses.map(a => <div key={a.id} className="address">
            <div><b>{a.line1}</b> {a.line2 ? ', '+a.line2 : ''}</div>
            <div className="small muted">{a.city} · {a.state} · {a.pincode} · {a.country}</div>
            <div style={{marginTop:8}} className="flex">
              {!a.is_primary && <button className="btn-secondary" onClick={()=>updateAddress(a.id,{is_primary:true})}>Make Primary</button>}
              <button onClick={()=>{ const newLine = prompt('Edit line1', a.line1); if(newLine) updateAddress(a.id,{line1:newLine}); }}>Edit</button>
              <button className="btn-danger" onClick={()=>deleteAddress(a.id)}>Delete</button>
              {a.is_primary && <span className="chip" style={{marginLeft:8}}>Primary</span>}
            </div>
          </div>)}

          <div style={{marginTop:12}}>
            <h4>Add Address</h4>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
              <input placeholder="Line1" value={addrForm.line1} onChange={e=>setAddrForm(s=>({...s,line1:e.target.value}))}/>
              <input placeholder="Line2" value={addrForm.line2} onChange={e=>setAddrForm(s=>({...s,line2:e.target.value}))}/>
              <input placeholder="City" value={addrForm.city} onChange={e=>setAddrForm(s=>({...s,city:e.target.value}))}/>
              <input placeholder="State" value={addrForm.state} onChange={e=>setAddrForm(s=>({...s,state:e.target.value}))}/>
              <input placeholder="Pincode" value={addrForm.pincode} onChange={e=>setAddrForm(s=>({...s,pincode:e.target.value}))}/>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <label><input type="checkbox" checked={addrForm.is_primary} onChange={e=>setAddrForm(s=>({...s,is_primary:e.target.checked}))}/> Primary</label>
                <button onClick={addAddress}>Add</button>
              </div>
            </div>
          </div>
        </div>

        <div style={{marginTop:12}}>
          <strong>Transactions</strong>
          {customer.transactions.length === 0 ? <div className="muted small">No transactions</div> :
            <table><thead><tr><th>Detail</th><th>Amount</th><th>Date</th></tr></thead><tbody>
              {customer.transactions.map(t=> <tr key={t.id}><td>{t.detail}</td><td>{t.amount}</td><td>{new Date(t.created_at).toLocaleString()}</td></tr>)}
            </tbody></table>
          }
        </div>

        <div style={{marginTop:12}}>
          <Link to="/edit/${params.id.replace("'", "\\'") }"><button>Edit</button></Link>
          <Link to="/"><button className="btn-secondary">Back</button></Link>
        </div>
      </div>;
    }

    function App(){
      return <BrowserRouter>
        <Routes>
          <Route path="/" element={<ListView/>} />
          <Route path="/create" element={<CustomerForm/>} />
          <Route path="/edit/:id" element={<CustomerForm isEdit={true}/>} />
          <Route path="/view/:id" element={<CustomerView/>} />
          <Route path="*" element={<div className="container card">Not Found</div>} />
        </Routes>
      </BrowserRouter>
    }

    ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
  </script>
</body>
</html>
`;