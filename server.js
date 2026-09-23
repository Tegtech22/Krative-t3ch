const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
const port = process.env.PORT || 10000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

app.use(cors());
app.use(express.json());

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS courses (
      id BIGSERIAL PRIMARY KEY,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      level TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS opportunities (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const { rows: c } = await pool.query("SELECT COUNT(*)::int AS count FROM courses");
  if (c[0].count === 0) {
    await pool.query(`
      INSERT INTO courses(category,title,description,level) VALUES
      ('Technology','Web Development Foundations','Learn the foundations of building for the web.','Beginner'),
      ('Intelligence','Introduction to NOETICA Intelligence','Explore intelligence in the Krative ecosystem.','Foundation'),
      ('Business','Entrepreneurship & Innovation','Turn problems into practical opportunities and projects.','Beginner'),
      ('Creative','Digital Creation','Develop practical skills for creating digital experiences.','Beginner'),
      ('Professional','Communication & Collaboration','Strengthen skills needed to learn and build with others.','All levels'),
      ('Academic','Research Skills','Learn to investigate questions, organize knowledge and communicate findings.','Foundation')
    `);
  }
  const { rows: o } = await pool.query("SELECT COUNT(*)::int AS count FROM opportunities");
  if (o[0].count === 0) {
    await pool.query(`
      INSERT INTO opportunities(type,title,category,description) VALUES
      ('Jobs','Technology Assistant','Technology','Explore a role and its requirements.'),
      ('Freelance','Web Project','Digital','A project-based opportunity for a web creator.'),
      ('Internships','Innovation Intern','Innovation','A learning-focused practical placement.'),
      ('Scholarships','Learning Support','Education','A scholarship-style opportunity for further learning.')
    `);
  }
}

app.get("/health", async (_req,res) => {
  try { await pool.query("SELECT 1"); res.json({status:"ok",service:"kranova-api",database:"connected"}); }
  catch (e) { res.status(503).json({status:"error",service:"kranova-api",database:"unavailable"}); }
});

app.get("/api/courses", async (_req,res) => {
  const { rows } = await pool.query("SELECT id,category,title,description,level FROM courses ORDER BY id");
  res.json(rows);
});

app.get("/api/opportunities", async (_req,res) => {
  const { rows } = await pool.query("SELECT id,type,title,category,description FROM opportunities ORDER BY id");
  res.json(rows);
});

app.post("/api/users", async (req,res) => {
  const { name, email } = req.body || {};
  if (!name || !email) return res.status(400).json({error:"name and email are required"});
  try {
    const { rows } = await pool.query(
      "INSERT INTO users(name,email) VALUES($1,$2) RETURNING id,name,email,created_at",
      [String(name).trim(),String(email).trim().toLowerCase()]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({error:"email already exists"});
    res.status(500).json({error:"unable to create user"});
  }
});

app.get("/api/users/:id", async (req,res) => {
  const { rows } = await pool.query("SELECT id,name,email,created_at FROM users WHERE id=$1",[req.params.id]);
  if (!rows[0]) return res.status(404).json({error:"user not found"});
  res.json(rows[0]);
});

initDb().then(() => {
  app.listen(port, () => console.log(`Kranova API listening on ${port}`));
}).catch(err => {
  console.error("Database initialization failed:", err);
  process.exit(1);
});
