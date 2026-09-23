const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
const port = process.env.PORT || 10000;
const useDatabase = Boolean(process.env.DATABASE_URL);
const pool = useDatabase ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

app.use(cors());
app.use(express.json());

const memory = {
  users: [],
  sessions: new Map(),
  courses: [
    {id:1,category:"Technology",title:"Web Development Foundations",description:"Learn the foundations of building for the web.",level:"Beginner"},
    {id:2,category:"Intelligence",title:"Introduction to NOETICA Intelligence",description:"Explore intelligence in the Krative ecosystem.",level:"Foundation"},
    {id:3,category:"Business",title:"Entrepreneurship & Innovation",description:"Turn problems into practical opportunities and projects.",level:"Beginner"},
    {id:4,category:"Creative",title:"Digital Creation",description:"Develop practical skills for creating digital experiences.",level:"Beginner"},
    {id:5,category:"Professional",title:"Communication & Collaboration",description:"Strengthen skills needed to learn and build with others.",level:"All levels"},
    {id:6,category:"Academic",title:"Research Skills",description:"Learn to investigate questions, organize knowledge and communicate findings.",level:"Foundation"}
  ],
  opportunities: [
    {id:1,type:"Jobs",title:"Technology Assistant",category:"Technology",description:"Explore a role and its requirements."},
    {id:2,type:"Freelance",title:"Web Project",category:"Digital",description:"A project-based opportunity for a web creator."},
    {id:3,type:"Internships",title:"Innovation Intern",category:"Innovation",description:"A learning-focused practical placement."},
    {id:4,type:"Scholarships",title:"Learning Support",category:"Education",description:"A scholarship-style opportunity for further learning."}
  ]
};

async function initDb() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password_hash TEXT,password_salt TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_salt TEXT;
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS courses (id BIGSERIAL PRIMARY KEY,category TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,level TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS opportunities (id BIGSERIAL PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS enrollments (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,course_id));
  `);
  for (const c of memory.courses) await pool.query("INSERT INTO courses(id,category,title,description,level) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",[c.id,c.category,c.title,c.description,c.level]);
  for (const o of memory.opportunities) await pool.query("INSERT INTO opportunities(id,type,title,category,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",[o.id,o.type,o.title,o.category,o.description]);
}

app.get("/health", async (_req,res) => {
  if (!pool) return res.json({status:"ok",service:"kranova-api",database:"not_connected",mode:"backend_ready"});
  try { await pool.query("SELECT 1"); res.json({status:"ok",service:"kranova-api",database:"connected"}); }
  catch { res.status(503).json({status:"error",service:"kranova-api",database:"unavailable"}); }
});

app.get("/api/courses", async (_req,res) => {
  if (!pool) return res.json(memory.courses);
  const { rows } = await pool.query("SELECT id,category,title,description,level FROM courses ORDER BY id"); res.json(rows);
});

app.get("/api/opportunities", async (_req,res) => {
  if (!pool) return res.json(memory.opportunities);
  const { rows } = await pool.query("SELECT id,type,title,category,description FROM opportunities ORDER BY id"); res.json(rows);
});

app.post("/api/users", async (req,res) => {
  const {name,email}=req.body||{};
  if (!name || !email) return res.status(400).json({error:"name and email are required"});
  if (!pool) {
    const user={id:memory.users.length+1,name:String(name).trim(),email:String(email).trim().toLowerCase(),created_at:new Date().toISOString()};
    if(memory.users.some(u=>u.email===user.email)) return res.status(409).json({error:"email already exists"});
    memory.users.push(user); return res.status(201).json(user);
  }
  try {
    const {rows}=await pool.query("INSERT INTO users(name,email) VALUES($1,$2) RETURNING id,name,email,created_at",[String(name).trim(),String(email).trim().toLowerCase()]);
    res.status(201).json(rows[0]);
  } catch(e) { if(e.code==="23505") return res.status(409).json({error:"email already exists"}); res.status(500).json({error:"unable to create user"}); }
});


function normalizeEmail(email) { return String(email || "").trim().toLowerCase(); }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function hashPassword(password, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derived) => err ? reject(err) : resolve(derived.toString("hex"))));
}
async function verifyPassword(password, salt, expectedHash) {
  const actual = await hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expectedHash, "hex"));
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
  if (pool) await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)", [tokenHash, userId, expiresAt]);
  else memory.sessions.set(tokenHash, { userId, expires_at: expiresAt.toISOString() });
  return token;
}
async function getAuthUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = hashToken(token);
  if (pool) {
    const { rows } = await pool.query(`
      SELECT u.id,u.name,u.email,u.created_at
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at > NOW()
    `, [tokenHash]);
    return rows[0] || null;
  }
  const session = memory.sessions.get(tokenHash);
  if (!session || new Date(session.expires_at) <= new Date()) return null;
  return memory.users.find(u => u.id === session.userId) || null;
}

app.post("/api/courses/:id/enroll", async (req,res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error:"authentication required" });
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId)) return res.status(400).json({ error:"invalid course id" });
  try {
    if (pool) {
      const course = await pool.query("SELECT id,title FROM courses WHERE id=$1",[courseId]);
      if (!course.rows[0]) return res.status(404).json({error:"course not found"});
      const result = await pool.query("INSERT INTO enrollments(user_id,course_id) VALUES($1,$2) ON CONFLICT(user_id,course_id) DO NOTHING RETURNING id,enrolled_at",[user.id,courseId]);
      return res.status(result.rows[0] ? 201 : 200).json({ok:true,course_id:courseId,enrolled:!!result.rows[0]});
    }
    return res.status(201).json({ok:true,course_id:courseId,enrolled:true});
  } catch(e) { console.error("Enrollment failed:",e); res.status(500).json({error:"unable to enroll"}); }
});

app.get("/api/me/enrollments", async (req,res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({error:"authentication required"});
  try {
    if (!pool) return res.json([]);
    const {rows}=await pool.query(`
      SELECT c.id,c.category,c.title,c.description,c.level,e.enrolled_at
      FROM enrollments e JOIN courses c ON c.id=e.course_id
      WHERE e.user_id=$1 ORDER BY e.enrolled_at DESC
    `,[user.id]);
    res.json(rows);
  } catch(e) { console.error("Enrollment lookup failed:",e); res.status(500).json({error:"unable to load enrollments"}); }
});

app.post("/api/auth/signup", async (req,res) => {
  const { name, email, password } = req.body || {};
  const cleanName = String(name || "").trim();
  const cleanEmail = normalizeEmail(email);
  if (cleanName.length < 2 || !cleanEmail.includes("@") || String(password || "").length < 8)
    return res.status(400).json({ error: "name, valid email, and password of at least 8 characters are required" });
  const salt = crypto.randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(String(password), salt);
  try {
    let user;
    if (pool) {
      const { rows } = await pool.query(
        "INSERT INTO users(name,email,password_hash,password_salt) VALUES($1,$2,$3,$4) RETURNING id,name,email,created_at",
        [cleanName, cleanEmail, passwordHash, salt]
      );
      user = rows[0];
    } else {
      if (memory.users.some(u => u.email === cleanEmail)) return res.status(409).json({ error: "email already exists" });
      user = { id: memory.users.length + 1, name: cleanName, email: cleanEmail, password_hash: passwordHash, password_salt: salt, created_at: new Date().toISOString() };
      memory.users.push(user);
    }
    const token = await createSession(user.id);
    res.status(201).json({ user: { id:user.id,name:user.name,email:user.email,created_at:user.created_at }, token });
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "email already exists" });
    console.error("Signup failed:", e);
    res.status(500).json({ error: "unable to create account" });
  }
});

app.post("/api/auth/login", async (req,res) => {
  const cleanEmail = normalizeEmail(req.body && req.body.email);
  const password = String((req.body && req.body.password) || "");
  if (!cleanEmail || !password) return res.status(400).json({ error: "email and password are required" });
  try {
    let user;
    if (pool) {
      const { rows } = await pool.query("SELECT id,name,email,password_hash,password_salt,created_at FROM users WHERE email=$1", [cleanEmail]);
      user = rows[0];
    } else {
      user = memory.users.find(u => u.email === cleanEmail);
    }
    if (!user || !user.password_hash || !user.password_salt || !(await verifyPassword(password, user.password_salt, user.password_hash)))
      return res.status(401).json({ error: "invalid email or password" });
    const token = await createSession(user.id);
    res.json({ user:{id:user.id,name:user.name,email:user.email,created_at:user.created_at}, token });
  } catch (e) {
    console.error("Login failed:", e);
    res.status(500).json({ error: "unable to sign in" });
  }
});

app.get("/api/auth/me", async (req,res) => {
  try {
    const user = await getAuthUser(req);
    if (!user) return res.status(401).json({ error: "authentication required" });
    res.json({ user });
  } catch (e) {
    console.error("Auth check failed:", e);
    res.status(500).json({ error: "unable to verify session" });
  }
});

app.post("/api/auth/logout", async (req,res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) {
    const tokenHash = hashToken(token);
    if (pool) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash]);
    else memory.sessions.delete(tokenHash);
  }
  res.json({ ok:true });
});

app.get("/api/users/:id", async (req,res) => {
  if (!pool) { const u=memory.users.find(x=>x.id===Number(req.params.id)); return u?res.json(u):res.status(404).json({error:"user not found"}); }
  const {rows}=await pool.query("SELECT id,name,email,created_at FROM users WHERE id=$1",[req.params.id]);
  if(!rows[0]) return res.status(404).json({error:"user not found"}); res.json(rows[0]);
});

initDb().then(()=>app.listen(port,()=>console.log(`Kranova API listening on ${port}; database=${useDatabase?"postgres":"memory"}`))).catch(err=>{console.error("Database initialization failed:",err);process.exit(1)});
