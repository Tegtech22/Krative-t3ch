const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 10000;
const useDatabase = Boolean(process.env.DATABASE_URL);
const pool = useDatabase ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;

app.use(cors());
app.use(express.json());

const memory = {
  users: [],
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
    CREATE TABLE IF NOT EXISTS users (id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS courses (id BIGSERIAL PRIMARY KEY,category TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,level TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS opportunities (id BIGSERIAL PRIMARY KEY,type TEXT NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
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

app.get("/api/users/:id", async (req,res) => {
  if (!pool) { const u=memory.users.find(x=>x.id===Number(req.params.id)); return u?res.json(u):res.status(404).json({error:"user not found"}); }
  const {rows}=await pool.query("SELECT id,name,email,created_at FROM users WHERE id=$1",[req.params.id]);
  if(!rows[0]) return res.status(404).json({error:"user not found"}); res.json(rows[0]);
});

initDb().then(()=>app.listen(port,()=>console.log(`Kranova API listening on ${port}; database=${useDatabase?"postgres":"memory"}`))).catch(err=>{console.error("Database initialization failed:",err);process.exit(1)});
