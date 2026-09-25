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

const KRANOVA_KNOWLEDGE = [
  {
    id: "kranova.identity",
    type: "product",
    title: "Kranova",
    content: "Kranova is a Krative T3ch learning and opportunity platform focused on skills, academic learning, courses, practical development, certification, jobs, freelance work, internships, scholarships, community and collaboration.",
    answer: "Kranova is a Krative T3ch learning and opportunity platform. It brings learning, skills development, opportunities, community and collaboration together so people can move from discovering knowledge to learning, creating, teaching, collaborating, working and building.",
    confidence: 0.98
  },
  {
    id: "kranova.relationship",
    type: "architecture",
    title: "Kranova within Krative T3ch",
    content: "Kranova is a platform within the Krative T3ch ecosystem. Learning is its DNA. Its journey is Discover Connect Learn Create Teach Collaborate Work Build. Kranova is separate from the Human Intelligence Network.",
    answer: "Within Krative T3ch, Kranova is the learning-first platform layer. Its journey is Discover → Connect → Learn → Create → Teach → Collaborate → Work → Build. It is a platform for people and is separate from HIN, the Human Intelligence Network.",
    confidence: 0.98
  },
  {
    id: "kranova.intelligence",
    type: "intelligence",
    title: "Kranova Intelligence",
    content: "Kranova Intelligence is the intelligence interface in Kranova. Authenticated requests are routed through the Kranova API to Krative Core for understanding, classification, knowledge retrieval, memory, fusion, reasoning, decision and execution.",
    answer: "Kranova also provides an Intelligence interface. Questions are authenticated by the Kranova API and routed to Krative Core, where the request can pass through the intelligence pipeline for understanding, knowledge retrieval, fusion, reasoning, decision and execution.",
    confidence: 0.96
  },
  {
    id: "krative.positioning",
    type: "ecosystem",
    title: "Krative T3ch",
    content: "Krative T3ch is the technology and innovation ecosystem behind projects such as Kranova, Krative Core and NOETICA Intelligence. Kranova is one platform within that broader ecosystem.",
    answer: "Kranova is one platform within the broader Krative T3ch technology and innovation ecosystem. Krative T3ch provides the wider ecosystem and intelligence architecture, while Kranova focuses on learning, opportunity, human connection and building.",
    confidence: 0.97
  }
];

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
    CREATE TABLE IF NOT EXISTS applications (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,opportunity_id BIGINT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'Applied',applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,opportunity_id));
    CREATE TABLE IF NOT EXISTS enrollments (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),progress INTEGER NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),completed_at TIMESTAMPTZ,UNIQUE(user_id,course_id));
    ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS learning_academies (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      cover_image TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS learning_paths (
      id BIGSERIAL PRIMARY KEY,
      academy_id BIGINT NOT NULL REFERENCES learning_academies(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL DEFAULT 'All levels',
      estimated_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(academy_id,slug)
    );
    CREATE TABLE IF NOT EXISTS course_modules (
      id BIGSERIAL PRIMARY KEY,
      course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(course_id,position)
    );
    CREATE TABLE IF NOT EXISTS learning_path_courses (
      id BIGSERIAL PRIMARY KEY,
      path_id BIGINT NOT NULL REFERENCES learning_paths(id) ON DELETE CASCADE,
      course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      required BOOLEAN NOT NULL DEFAULT true,
      UNIQUE(path_id,course_id),
      UNIQUE(path_id,position)
    );
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS academy_id BIGINT REFERENCES learning_academies(id) ON DELETE SET NULL;
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS slug TEXT;
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS short_description TEXT NOT NULL DEFAULT '';
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS thumbnail TEXT NOT NULL DEFAULT '';
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
    ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT true;
    CREATE UNIQUE INDEX IF NOT EXISTS courses_slug_idx ON courses(slug) WHERE slug IS NOT NULL;
    CREATE TABLE IF NOT EXISTS skills (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS course_skills (
      course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      skill_id BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'foundation',
      PRIMARY KEY(course_id,skill_id)
    );
    CREATE TABLE IF NOT EXISTS user_skills (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      skill_id BIGINT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
      level TEXT NOT NULL DEFAULT 'foundation',
      evidence_count INTEGER NOT NULL DEFAULT 0,
      verified BOOLEAN NOT NULL DEFAULT false,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id,skill_id)
    );
    CREATE TABLE IF NOT EXISTS lesson_activities (
      id BIGSERIAL PRIMARY KEY,
      lesson_id BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      activity_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
      position INTEGER NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(lesson_id,position)
    );
    CREATE TABLE IF NOT EXISTS assessments (
      id BIGSERIAL PRIMARY KEY,
      course_id BIGINT REFERENCES courses(id) ON DELETE CASCADE,
      module_id BIGINT REFERENCES course_modules(id) ON DELETE CASCADE,
      lesson_id BIGINT REFERENCES lessons(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      assessment_type TEXT NOT NULL DEFAULT 'quiz',
      passing_score INTEGER NOT NULL DEFAULT 70,
      attempt_limit INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS assessment_questions (
      id BIGSERIAL PRIMARY KEY,
      assessment_id BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      question_type TEXT NOT NULL DEFAULT 'multiple_choice',
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      correct_answer JSONB NOT NULL DEFAULT 'null'::jsonb,
      points INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL,
      UNIQUE(assessment_id,position)
    );
    CREATE TABLE IF NOT EXISTS assessment_attempts (
      id BIGSERIAL PRIMARY KEY,
      assessment_id BIGINT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score NUMERIC(6,2) NOT NULL DEFAULT 0,
      passed BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS learning_projects (
      id BIGSERIAL PRIMARY KEY,
      academy_id BIGINT REFERENCES learning_academies(id) ON DELETE SET NULL,
      course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      instructions TEXT NOT NULL DEFAULT '',
      difficulty TEXT NOT NULL DEFAULT 'Beginner',
      estimated_hours NUMERIC(6,2) NOT NULL DEFAULT 0,
      skills JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'active',
      created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS project_submissions (
      id BIGSERIAL PRIMARY KEY,
      project_id BIGINT NOT NULL REFERENCES learning_projects(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      submission_url TEXT NOT NULL DEFAULT '',
      repository_url TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'submitted',
      reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
      score NUMERIC(6,2),
      feedback TEXT NOT NULL DEFAULT '',
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS certificates (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      course_id BIGINT REFERENCES courses(id) ON DELETE SET NULL,
      certificate_number TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      verification_code TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS saved_learning (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL,
      resource_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id,resource_type,resource_id)
    );
    CREATE TABLE IF NOT EXISTS badges (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      badge_id BIGINT NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY(user_id,badge_id)
    );
    CREATE TABLE IF NOT EXISTS course_instructors (
      course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'instructor',
      PRIMARY KEY(course_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS learning_paths_academy_idx ON learning_paths(academy_id,status);
    CREATE INDEX IF NOT EXISTS courses_academy_idx ON courses(academy_id,status);
    CREATE INDEX IF NOT EXISTS course_modules_course_idx ON course_modules(course_id,position);
    CREATE INDEX IF NOT EXISTS project_submissions_user_idx ON project_submissions(user_id,submitted_at DESC);
    CREATE INDEX IF NOT EXISTS user_skills_user_idx ON user_skills(user_id,updated_at DESC);
    CREATE TABLE IF NOT EXISTS lessons (id BIGSERIAL PRIMARY KEY,course_id BIGINT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,title TEXT NOT NULL,content TEXT NOT NULL,position INTEGER NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(course_id,position));
    CREATE TABLE IF NOT EXISTS lesson_progress (user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id BIGINT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(user_id,lesson_id));
    CREATE TABLE IF NOT EXISTS posts (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS comments (id BIGSERIAL PRIMARY KEY,post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS connections (id BIGSERIAL PRIMARY KEY,requester_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,receiver_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(requester_id,receiver_id));
    CREATE TABLE IF NOT EXISTS profiles (user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,bio TEXT NOT NULL DEFAULT '',skills TEXT NOT NULL DEFAULT '',learning_goals TEXT NOT NULL DEFAULT '',updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    CREATE TABLE IF NOT EXISTS knowledge (id BIGSERIAL PRIMARY KEY,knowledge_key TEXT UNIQUE,category TEXT NOT NULL,title TEXT NOT NULL,content TEXT NOT NULL,answer TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT '',verified BOOLEAN NOT NULL DEFAULT false,active BOOLEAN NOT NULL DEFAULT true,created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS role_audit (id BIGSERIAL PRIMARY KEY,target_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,old_role TEXT,new_role TEXT NOT NULL,changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS intelligence_threads (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL DEFAULT 'Kranova Intelligence',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS intelligence_messages (id BIGSERIAL PRIMARY KEY,thread_id BIGINT NOT NULL REFERENCES intelligence_threads(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('user','assistant')),content TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS intelligence_memory (id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,memory_type TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'conversation',confidence NUMERIC(4,3) NOT NULL DEFAULT 0.800,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(user_id,memory_type,key));
    CREATE INDEX IF NOT EXISTS intelligence_memory_user_idx ON intelligence_memory(user_id,updated_at DESC);
    CREATE INDEX IF NOT EXISTS intelligence_threads_user_idx ON intelligence_threads(user_id,updated_at DESC);
    CREATE INDEX IF NOT EXISTS intelligence_messages_thread_idx ON intelligence_messages(thread_id,created_at ASC);
    CREATE INDEX IF NOT EXISTS knowledge_active_idx ON knowledge(active,verified);
  `);
  await pool.query("UPDATE users SET role='super_admin' WHERE id=(SELECT id FROM users ORDER BY created_at,id LIMIT 1) AND NOT EXISTS (SELECT 1 FROM users WHERE role IN ('admin','super_admin'))");
  for (const k of KRANOVA_KNOWLEDGE) await pool.query("INSERT INTO knowledge(knowledge_key,category,title,content,answer,source,verified,active) VALUES($1,$2,$3,$4,$5,$6,true,true) ON CONFLICT(knowledge_key) DO UPDATE SET category=EXCLUDED.category,title=EXCLUDED.title,content=EXCLUDED.content,answer=EXCLUDED.answer,verified=true,active=true,updated_at=NOW()",[k.id,k.type,k.title,k.content,k.answer,"Kranova verified foundation"]);
  for (const c of memory.courses) await pool.query("INSERT INTO courses(id,category,title,description,level) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",[c.id,c.category,c.title,c.description,c.level]);
  const academySeed = [
    ["technology","Technology","Build practical technology skills from foundations to advanced practice.","💻","Technology"],
    ["intelligence","Intelligence","Explore intelligence, NOETICA and emerging technology concepts.","◈","Intelligence"],
    ["business","Business","Learn how to understand problems, create value and build opportunities.","◉","Business"],
    ["creative","Creative","Develop practical skills for digital creation, design and communication.","✦","Creative"],
    ["professional","Professional","Strengthen communication, collaboration and workplace capabilities.","◎","Professional"],
    ["academic","Academic","Develop research, investigation and evidence-based learning skills.","⌘","Academic"]
  ];
  for (const a of academySeed) await pool.query("INSERT INTO learning_academies(slug,name,description,icon,category) VALUES($1,$2,$3,$4,$5) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,icon=EXCLUDED.icon,category=EXCLUDED.category,updated_at=NOW()",a);
  await pool.query("UPDATE courses SET academy_id=(SELECT id FROM learning_academies WHERE lower(slug)=lower(regexp_replace(category,'[^a-zA-Z0-9]+','','g')) ORDER BY id LIMIT 1) WHERE academy_id IS NULL AND EXISTS (SELECT 1 FROM learning_academies WHERE lower(slug)=lower(regexp_replace(category,'[^a-zA-Z0-9]+','','g')))");
  await pool.query("UPDATE courses SET slug=lower(regexp_replace(title,'[^a-zA-Z0-9]+','-','g')) WHERE slug IS NULL");
  await pool.query("ALTER TABLE lessons ADD COLUMN IF NOT EXISTS module_id BIGINT REFERENCES course_modules(id) ON DELETE CASCADE");
  const courseRows = await pool.query("SELECT id,title FROM courses ORDER BY id");
  for (const course of courseRows.rows) {
    const existing = await pool.query("SELECT id FROM course_modules WHERE course_id=$1 ORDER BY position,id LIMIT 1",[course.id]);
    if (!existing.rows[0]) await pool.query("INSERT INTO course_modules(course_id,title,description,position) VALUES($1,$2,$3,1)",[course.id,"Course Foundations","Core lessons and foundational learning for this course."]);
    const moduleId=(await pool.query("SELECT id FROM course_modules WHERE course_id=$1 ORDER BY position,id LIMIT 1",[course.id])).rows[0].id;
    await pool.query("UPDATE lessons SET module_id=$1 WHERE course_id=$2 AND module_id IS NULL",[moduleId,course.id]);
  }
  for (const o of memory.opportunities) await pool.query("INSERT INTO opportunities(id,type,title,category,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",[o.id,o.type,o.title,o.category,o.description]);
  const lessonSeed = [
    [1,1,"The web and how it works","Learn the basic relationship between browsers, servers, URLs, HTTP and web pages.",1],
    [2,1,"HTML structure","Learn how HTML gives a web page its structure using elements, headings, links, images and forms.",2],
    [3,1,"CSS and responsive design","Learn how CSS controls presentation, spacing, typography and responsive layouts.",3],
    [4,2,"What is intelligence?","Explore intelligence as the ability to understand information, reason about it and act toward goals.",1],
    [5,2,"NOETICA Intelligence","Understand the role of NOETICA Intelligence within the Krative T3ch ecosystem.",2],
    [6,2,"Human and artificial intelligence","Explore how human intelligence and artificial intelligence can complement one another.",3],
    [7,3,"Finding meaningful problems","Learn how to identify real problems, affected people and useful opportunities.",1],
    [8,3,"From idea to solution","Turn a problem into a practical solution hypothesis and define what needs to be built.",2],
    [9,3,"Testing an opportunity","Learn how to validate assumptions through research, feedback and small experiments.",3],
    [10,4,"Digital creation basics","Understand the building blocks of digital products, content and experiences.",1],
    [11,4,"Designing for people","Learn to organize a digital experience around user needs, clarity and accessibility.",2],
    [12,4,"Create and iterate","Learn a simple cycle of making, reviewing, improving and publishing digital work.",3],
    [13,5,"Clear communication","Learn how to communicate ideas clearly across messages, documents and conversations.",1],
    [14,5,"Working with others","Understand roles, expectations, feedback and shared responsibility in collaboration.",2],
    [15,5,"Resolving collaboration problems","Learn practical ways to surface disagreements, clarify goals and keep work moving.",3],
    [16,6,"Asking a research question","Learn how to turn curiosity into a focused question that can be investigated.",1],
    [17,6,"Finding and evaluating information","Learn how to search for evidence and distinguish useful sources from weak information.",2],
    [18,6,"Communicating findings","Learn how to organize evidence, explain conclusions and communicate limitations.",3]
  ];
  for (const l of lessonSeed) await pool.query("INSERT INTO lessons(id,course_id,title,content,position) VALUES($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING",l);

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

app.get("/api/me/profile", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json({user_id:user.id,name:user.name,email:user.email,bio:"",skills:"",learning_goals:""});
  try{const {rows}=await pool.query("SELECT user_id,bio,skills,learning_goals,updated_at FROM profiles WHERE user_id=$1",[user.id]);res.json({user_id:user.id,name:user.name,email:user.email,...(rows[0]||{bio:"",skills:"",learning_goals:""})});}catch(e){res.status(500).json({error:"unable to load profile"});}
});
app.put("/api/me/profile", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const bio=String(req.body?.bio||"").trim().slice(0,1000),skills=String(req.body?.skills||"").trim().slice(0,500),learningGoals=String(req.body?.learning_goals||"").trim().slice(0,1000);
  if(!pool)return res.json({ok:true,user_id:user.id,bio,skills,learning_goals:learningGoals});
  try{const {rows}=await pool.query("INSERT INTO profiles(user_id,bio,skills,learning_goals) VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE SET bio=EXCLUDED.bio,skills=EXCLUDED.skills,learning_goals=EXCLUDED.learning_goals,updated_at=NOW() RETURNING user_id,bio,skills,learning_goals,updated_at",[user.id,bio,skills,learningGoals]);res.json({ok:true,...rows[0]});}catch(e){res.status(500).json({error:"unable to save profile"});}
});
app.get("/api/community/users", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query("SELECT u.id,u.name,COALESCE(p.bio,'') AS bio,COALESCE(p.skills,'') AS skills FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.id<>$1 ORDER BY u.created_at DESC LIMIT 50",[user.id]);res.json(rows);}catch(e){res.status(500).json({error:"unable to load members"});}
});
app.post("/api/community/connections/:id", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const receiverId=Number(req.params.id);if(!Number.isInteger(receiverId)||receiverId===user.id)return res.status(400).json({error:"invalid member id"});
  if(!pool)return res.status(201).json({ok:true,status:"pending"});
  try{const exists=await pool.query("SELECT id FROM users WHERE id=$1",[receiverId]);if(!exists.rows[0])return res.status(404).json({error:"member not found"});
    const result=await pool.query("INSERT INTO connections(requester_id,receiver_id) VALUES($1,$2) ON CONFLICT(requester_id,receiver_id) DO NOTHING RETURNING id,status",[user.id,receiverId]);
    res.status(result.rows[0]?201:200).json({ok:true,requested:!!result.rows[0],status:result.rows[0]?.status||"pending"});
  }catch(e){res.status(500).json({error:"unable to send connection request"});}
});
app.get("/api/me/connections", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query("SELECT c.id,c.status,c.requester_id,c.receiver_id,u.name FROM connections c JOIN users u ON u.id=CASE WHEN c.requester_id=$1 THEN c.receiver_id ELSE c.requester_id END WHERE c.requester_id=$1 OR c.receiver_id=$1 ORDER BY c.created_at DESC",[user.id]);res.json(rows);}catch(e){res.status(500).json({error:"unable to load connections"});}
});
app.get("/api/intelligence/memory", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query("SELECT id,memory_type,key,value,source,confidence,updated_at FROM intelligence_memory WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 100",[user.id]);res.json(rows);}catch(e){res.status(500).json({error:"unable to load intelligence memory"});}
});

app.delete("/api/intelligence/memory/:id", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.status(404).json({error:"memory not available"});
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid memory id"});
  try{
    const {rows}=await pool.query("DELETE FROM intelligence_memory WHERE id=$1 AND user_id=$2 AND memory_type NOT IN ('learning_course','learning_summary') RETURNING id",[id,user.id]);
    if(!rows[0])return res.status(404).json({error:"memory cannot be removed or was not found"});
    res.json({ok:true});
  }catch(e){res.status(500).json({error:"unable to remove intelligence memory"});}
});
app.get("/api/intelligence/history", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json({thread_id:null,messages:[]});
  try{
    let thread=(await pool.query("SELECT id FROM intelligence_threads WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 1",[user.id])).rows[0];
    if(!thread)thread=(await pool.query("INSERT INTO intelligence_threads(user_id) VALUES($1) RETURNING id",[user.id])).rows[0];
    const {rows}=await pool.query("SELECT id,role,content,created_at FROM intelligence_messages WHERE thread_id=$1 ORDER BY created_at ASC,id ASC LIMIT 100",[thread.id]);
    res.json({thread_id:thread.id,messages:rows});
  }catch(e){console.error("Intelligence history failed:",e);res.status(500).json({error:"unable to load intelligence history"});}
});

app.post("/api/intelligence", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const base=String(process.env.KRATIVE_CORE_BASE_URL||"").replace(/\/$/,""),key=process.env.KRATIVE_CORE_API_KEY||"";
  if(!base||!key)return res.status(503).json({error:"Krative Core integration is not configured"});
  const input=String(req.body?.input||"").trim();if(!input)return res.status(400).json({error:"input is required"});
  try{
    let threadId=Number(req.body?.thread_id)||null;
    if(pool){
      if(threadId){
        const owned=await pool.query("SELECT id FROM intelligence_threads WHERE id=$1 AND user_id=$2",[threadId,user.id]);
        if(!owned.rows[0])threadId=null;
      }
      if(!threadId)threadId=(await pool.query("INSERT INTO intelligence_threads(user_id,title) VALUES($1,$2) RETURNING id",[user.id,"Kranova Intelligence"])).rows[0].id;
    }
    let conversationMemory=[];
    let structuredMemory=[];
    if(pool){
      // Keep Intelligence memory synchronized with the user's real learning activity.
      const learningRows=await pool.query(`
        SELECT c.id,c.title,c.category,c.level,e.enrolled_at,
          COALESCE((SELECT ROUND(COUNT(lp.lesson_id)::numeric * 100 / NULLIF(COUNT(l.id),0))::int
                    FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1
                    WHERE l.course_id=c.id),0) AS progress,
          COALESCE((SELECT COUNT(*)::int FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id
                    WHERE lp.user_id=$1 AND l.course_id=c.id),0) AS completed_lessons,
          COALESCE((SELECT COUNT(*)::int FROM lessons l WHERE l.course_id=c.id),0) AS total_lessons
        FROM enrollments e JOIN courses c ON c.id=e.course_id
        WHERE e.user_id=$1 ORDER BY e.enrolled_at DESC,c.id ASC
      `,[user.id]);
      for(const course of learningRows.rows){
        await pool.query(
          "INSERT INTO intelligence_memory(user_id,memory_type,key,value,source,confidence) VALUES($1,'learning_course',$2,$3,'learning_progress',0.980) ON CONFLICT(user_id,memory_type,key) DO UPDATE SET value=EXCLUDED.value,source='learning_progress',confidence=EXCLUDED.confidence,updated_at=NOW()",
          [user.id,"course:"+course.id,JSON.stringify({title:course.title,category:course.category,level:course.level,progress:Number(course.progress)||0,completed_lessons:Number(course.completed_lessons)||0,total_lessons:Number(course.total_lessons)||0})]
        );
      }
      const activeLearning=learningRows.rows.map(course=>({
        course_id:Number(course.id),
        title:course.title,
        category:course.category,
        level:course.level,
        progress:Number(course.progress)||0,
        completed_lessons:Number(course.completed_lessons)||0,
        total_lessons:Number(course.total_lessons)||0
      }));
      await pool.query(
        "INSERT INTO intelligence_memory(user_id,memory_type,key,value,source,confidence) VALUES($1,'learning_summary','current_progress',$2,'learning_progress',0.990) ON CONFLICT(user_id,memory_type,key) DO UPDATE SET value=EXCLUDED.value,source='learning_progress',confidence=EXCLUDED.confidence,updated_at=NOW()",
        [user.id,JSON.stringify({courses:activeLearning,updated_at:new Date().toISOString()})]
      );
      const memoryRows=await pool.query("SELECT memory_type,key,value,source,confidence FROM intelligence_memory WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 50",[user.id]);
      structuredMemory=memoryRows.rows;
      // Build a compact personalization context so Krative Core can use memory operationally.
      const personalContext=structuredMemory.map(m=>{
        let value=m.value;
        try{const parsed=JSON.parse(value);value=parsed.title?parsed.title+" ("+(parsed.progress??0)+"% complete)":(parsed.courses?parsed.courses.map(x=>x.title+" ("+(x.progress??0)+"%)").join(", "):value);}catch{}
        return {type:m.memory_type,key:m.key,value:String(value).slice(0,300),source:m.source};
      });
      structuredMemory.push({memory_type:"personalization_context",key:"user_context",value:JSON.stringify(personalContext),source:"kranova_memory",confidence:0.980});
      const {rows}=await pool.query("SELECT role,content FROM intelligence_messages WHERE thread_id=$1 ORDER BY created_at DESC,id DESC LIMIT 12",[threadId]);
      conversationMemory=rows.reverse();
    }
    let knowledgeSources=KRANOVA_KNOWLEDGE.filter(k=>k.active!==false).map(k=>({id:k.id,type:k.type,title:k.title,content:k.content,answer:k.answer,confidence:k.confidence||0.95}));
    if(pool){
      try{
        const {rows}=await pool.query("SELECT id,knowledge_key,category,title,content,answer,source,verified,active FROM knowledge WHERE active=true AND verified=true ORDER BY updated_at DESC,id DESC");
        if(rows.length){
          const normalizeText=value=>String(value||"").toLowerCase().replace(/[^a-z0-9\s]/g," ").replace(/\s+/g," ").trim();
          const stopWords=new Set(["the","and","for","with","what","who","how","why","when","where","is","are","can","does","do","on","in","of","to","a","an","this","that","it","tell","me","about","please"]);
          const queryTokens=normalizeText(input).split(" ").filter(t=>t.length>1&&!stopWords.has(t));
          const queryText=normalizeText(input);
          const scored=rows.map(k=>{
            const title=normalizeText(k.title),category=normalizeText(k.category),content=normalizeText(k.content),answer=normalizeText(k.answer);
            const titleTokens=new Set(title.split(" ").filter(Boolean)),categoryTokens=new Set(category.split(" ").filter(Boolean)),contentTokens=new Set(content.split(" ").filter(Boolean)),answerTokens=new Set(answer.split(" ").filter(Boolean));
            let score=0,matched=0;
            for(const token of queryTokens){let hit=false;if(titleTokens.has(token)){score+=10;hit=true;}if(categoryTokens.has(token)){score+=5;hit=true;}if(contentTokens.has(token)){score+=2;hit=true;}if(answerTokens.has(token)){score+=3;hit=true;}if(hit)matched++;}
            if(queryTokens.length>1){const phrase=queryTokens.join(" ");if(title.includes(phrase))score+=24;if(content.includes(phrase))score+=10;if(answer.includes(phrase))score+=12;}
            if(title&&queryText.includes(title))score+=20;
            const coverage=queryTokens.length?matched/queryTokens.length:0;
            if(coverage===1)score+=12;else if(coverage>=0.5)score+=5;
            return {k,score,coverage};
          }).sort((a,b)=>b.score-a.score||b.coverage-a.coverage||Number(b.k.id)-Number(a.k.id));
          const relevant=scored.filter(x=>x.score>0&&(x.coverage>=0.25||x.score>=12)).slice(0,5);
          knowledgeSources=relevant.length?relevant.map(({k,score,coverage})=>({id:k.knowledge_key||String(k.id),type:k.category||"general",title:k.title,content:k.content,answer:k.answer||k.content,confidence:Math.min(0.99,0.90+Math.min(score,9)*0.01),relevance:Math.round(coverage*100)/100})):[]; 
        }
      }catch(knowledgeError){console.warn("Kranova Knowledge Centre retrieval failed; using verified foundation knowledge:",knowledgeError.message);}
    }
    const memoryContext=structuredMemory.map(m=>({content:`${m.memory_type}/${m.key}: ${m.value}`,importance:Number(m.confidence)||0.8,source:m.source}));
    const r=await fetch(base+"/api/v1/intelligence",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({input,context:{source:"kranova",user_id:user.id,knowledgeSources,conversationMemory,shortTermMemory:memoryContext,structuredMemory}})});
    const data=await r.json().catch(()=>({error:"invalid Core response"}));
    if(!r.ok)return res.status(r.status).json(data);
    let reply="";
    const result=data.result||data;
    if(typeof result==="string")reply=result;
    else if(result&&result.answer&&typeof result.answer.text==="string")reply=result.answer.text;
    else if(result&&typeof result.output==="string")reply=result.output;
    else if(result&&typeof result.response==="string")reply=result.response;
    else if(result&&typeof result.message==="string")reply=result.message;
    else reply=JSON.stringify(result);
    if(pool){
      await pool.query("INSERT INTO intelligence_messages(thread_id,role,content) VALUES($1,'user',$2),($1,'assistant',$3)",[threadId,input,reply]);
      await pool.query("UPDATE intelligence_threads SET updated_at=NOW() WHERE id=$1",[threadId]);
      const patterns=[[ /\bmy name is ([a-z][a-z '\-]{1,80}?)(?=\s*[.!?,;]|\s*$)/i,'identity','name'],[ /\bi am learning ([a-z0-9 .,'&\-]{2,100}?)(?=\s*[.!?,;]|\s*$)/i,'learning','current_subject'],[ /\bi(?:'m|’m| am) interested in ([a-z0-9 .,'&\-]{2,100}?)(?=\s*[.!?,;]|\s*$)/i,'interest','topic'],[ /\bmy goal is to ([a-z0-9 .,'&\-]{2,120}?)(?=\s*[.!?,;]|\s*$)/i,'goal','primary_goal'] ];
      for(const [pattern,type,key] of patterns){const m=input.match(pattern);if(m&&m[1])await pool.query("INSERT INTO intelligence_memory(user_id,memory_type,key,value,source,confidence) VALUES($1,$2,$3,$4,'conversation',0.900) ON CONFLICT(user_id,memory_type,key) DO UPDATE SET value=EXCLUDED.value,source='conversation',confidence=EXCLUDED.confidence,updated_at=NOW()",[user.id,type,key,m[1].trim()]);}
    }
    res.status(200).json({...data,thread_id:threadId});
  }catch(e){console.error("Krative Core request failed:",e);res.status(502).json({error:"unable to reach Krative Core"});}
});
app.get("/api/admin/knowledge", async (req,res) => {
  const a=await requireAdmin(req,res); if(a.error)return;
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query("SELECT id,knowledge_key,category,title,content,answer,source,verified,active,created_at,updated_at FROM knowledge ORDER BY updated_at DESC,id DESC");res.json(rows);}catch(e){res.status(500).json({error:"unable to load knowledge"});}
});
app.post("/api/admin/knowledge", async (req,res) => {
  const a=await requireAdmin(req,res); if(a.error)return;
  const category=String(req.body?.category||"general").trim().slice(0,80),title=String(req.body?.title||"").trim().slice(0,200),content=String(req.body?.content||"").trim().slice(0,10000),answer=String(req.body?.answer||content).trim().slice(0,10000),source=String(req.body?.source||"Admin").trim().slice(0,500),key=String(req.body?.knowledge_key||"").trim().slice(0,200)||null;
  if(!title||!content)return res.status(400).json({error:"title and content are required"});
  if(!pool)return res.status(201).json({ok:true});
  try{const {rows}=await pool.query("INSERT INTO knowledge(knowledge_key,category,title,content,answer,source,verified,active,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",[key,category,title,content,answer,source,Boolean(req.body?.verified),req.body?.active!==false,a.user.id]);res.status(201).json(rows[0]);}catch(e){if(e.code==="23505")return res.status(409).json({error:"knowledge key already exists"});res.status(500).json({error:"unable to add knowledge"});}
});
app.put("/api/admin/knowledge/:id", async (req,res) => {
  const a=await requireAdmin(req,res); if(a.error)return;
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid knowledge id"});
  const category=String(req.body?.category||"general").trim(),title=String(req.body?.title||"").trim(),content=String(req.body?.content||"").trim(),answer=String(req.body?.answer||content).trim(),source=String(req.body?.source||"Admin").trim(),key=String(req.body?.knowledge_key||"").trim()||null;
  if(!title||!content)return res.status(400).json({error:"title and content are required"});
  if(!pool)return res.json({ok:true});
  try{const {rows}=await pool.query("UPDATE knowledge SET category=$1,title=$2,content=$3,answer=$4,source=$5,knowledge_key=$6,verified=$7,active=$8,updated_at=NOW() WHERE id=$9 RETURNING *",[category,title,content,answer,source,key,Boolean(req.body?.verified),req.body?.active!==false,id]);if(!rows[0])return res.status(404).json({error:"knowledge not found"});res.json(rows[0]);}catch(e){if(e.code==="23505")return res.status(409).json({error:"knowledge key already exists"});res.status(500).json({error:"unable to update knowledge"});}
});
app.delete("/api/admin/knowledge/:id", async (req,res) => {
  const a=await requireAdmin(req,res);if(a.error)return;
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid knowledge id"});
  if(!pool)return res.json({ok:true});
  try{const r=await pool.query("UPDATE knowledge SET active=false,updated_at=NOW() WHERE id=$1 RETURNING id",[id]);if(!r.rows[0])return res.status(404).json({error:"knowledge not found"});res.json({ok:true,archived:true});}catch(e){res.status(500).json({error:"unable to archive knowledge"});}
});
app.get("/api/admin/users", async (req,res) => {
  const a=await requireAdmin(req,res);if(a.error)return;
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query("SELECT id,name,email,role,created_at FROM users ORDER BY created_at ASC,id ASC");res.json(rows);}catch(e){res.status(500).json({error:"unable to load users"});}
});
app.put("/api/admin/users/:id/role", async (req,res) => {
  const a=await requireAdmin(req,res);if(a.error)return;
  const id=Number(req.params.id),role=String(req.body?.role||"").trim(),allowed=["user","instructor","mentor","knowledge_contributor","moderator","admin","super_admin"];
  if(!Number.isInteger(id)||!allowed.includes(role))return res.status(400).json({error:"invalid user id or role"});
  if(id===a.user.id&&role!=="super_admin"&&a.user.role==="super_admin")return res.status(400).json({error:"super admin cannot remove their own super admin role"});
  if(!pool)return res.json({ok:true,id,role});
  try{const old=await pool.query("SELECT role FROM users WHERE id=$1",[id]);if(!old.rows[0])return res.status(404).json({error:"user not found"});await pool.query("UPDATE users SET role=$1 WHERE id=$2",[role,id]);await pool.query("INSERT INTO role_audit(target_user_id,old_role,new_role,changed_by) VALUES($1,$2,$3,$4)",[id,old.rows[0].role,role,a.user.id]);res.json({ok:true,id,role});}catch(e){res.status(500).json({error:"unable to update role"});}
});
app.get("/api/community/posts", async (_req,res) => {
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query(`
    SELECT p.id,p.content,p.created_at,u.id AS user_id,u.name,
      (SELECT COUNT(*)::int FROM comments c WHERE c.post_id=p.id) AS comment_count
    FROM posts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC LIMIT 50
  `);res.json(rows);}catch(e){res.status(500).json({error:"unable to load posts"});}
});
app.post("/api/community/posts", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const content=String(req.body?.content||"").trim();if(!content||content.length>2000)return res.status(400).json({error:"post must be 1-2000 characters"});
  if(!pool)return res.status(201).json({id:Date.now(),content,user_id:user.id,name:user.name,created_at:new Date().toISOString(),comment_count:0});
  try{const {rows}=await pool.query("INSERT INTO posts(user_id,content) VALUES($1,$2) RETURNING id,content,created_at",[user.id,content]);res.status(201).json({...rows[0],user_id:user.id,name:user.name,comment_count:0});}catch(e){res.status(500).json({error:"unable to create post"});}
});
app.get("/api/community/posts/:id/comments", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid post id"});
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query("SELECT c.id,c.content,c.created_at,u.id AS user_id,u.name FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC",[id]);res.json(rows);}catch(e){res.status(500).json({error:"unable to load comments"});}
});
app.post("/api/community/posts/:id/comments", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const postId=Number(req.params.id),content=String(req.body?.content||"").trim();if(!Number.isInteger(postId)||!content||content.length>1000)return res.status(400).json({error:"valid post id and comment of 1-1000 characters are required"});
  if(!pool)return res.status(201).json({id:Date.now(),post_id:postId,content,user_id:user.id,name:user.name,created_at:new Date().toISOString()});
  try{const post=await pool.query("SELECT id FROM posts WHERE id=$1",[postId]);if(!post.rows[0])return res.status(404).json({error:"post not found"});const {rows}=await pool.query("INSERT INTO comments(post_id,user_id,content) VALUES($1,$2,$3) RETURNING id,content,created_at",[postId,user.id,content]);res.status(201).json({...rows[0],post_id:postId,user_id:user.id,name:user.name});}catch(e){res.status(500).json({error:"unable to create comment"});}
});

/* =========================
   Kranova Learn API
   ========================= */

app.get("/api/learn/academies", async (_req,res) => {
  if(!pool)return res.json([]);
  try{
    const {rows}=await pool.query("SELECT a.id,a.slug,a.name,a.description,a.icon,a.cover_image,a.category,a.status,COUNT(DISTINCT c.id)::int AS course_count,COUNT(DISTINCT p.id)::int AS path_count FROM learning_academies a LEFT JOIN courses c ON c.academy_id=a.id AND c.status='active' LEFT JOIN learning_paths p ON p.academy_id=a.id AND p.status='active' WHERE a.status='active' GROUP BY a.id ORDER BY a.name");
    res.json(rows);
  }catch(e){console.error("Academy lookup failed:",e);res.status(500).json({error:"unable to load academies"});}
});

app.get("/api/learn/academies/:slug", async (req,res) => {
  if(!pool)return res.status(404).json({error:"academy not found"});
  try{
    const a=await pool.query("SELECT id,slug,name,description,icon,cover_image,category,status FROM learning_academies WHERE slug=$1 AND status='active'",[String(req.params.slug).trim()]);
    if(!a.rows[0])return res.status(404).json({error:"academy not found"});
    const [paths,courses]=await Promise.all([
      pool.query("SELECT id,slug,title,description,level,estimated_hours,status FROM learning_paths WHERE academy_id=$1 AND status='active' ORDER BY title",[a.rows[0].id]),
      pool.query("SELECT id,slug,title,short_description,description,level,estimated_minutes,thumbnail,is_free,status FROM courses WHERE academy_id=$1 AND status='active' ORDER BY title",[a.rows[0].id])
    ]);
    res.json({...a.rows[0],paths:paths.rows,courses:courses.rows});
  }catch(e){console.error("Academy detail failed:",e);res.status(500).json({error:"unable to load academy"});}
});

app.get("/api/learn/paths", async (req,res) => {
  if(!pool)return res.json([]);
  try{
    const params=[],where=["p.status='active'"];
    if(req.query.academy_id){const id=Number(req.query.academy_id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid academy id"});params.push(id);where.push("p.academy_id=$"+params.length);}
    const {rows}=await pool.query("SELECT p.id,p.slug,p.title,p.description,p.level,p.estimated_hours,a.id AS academy_id,a.slug AS academy_slug,a.name AS academy_name,COUNT(lpc.course_id)::int AS course_count FROM learning_paths p JOIN learning_academies a ON a.id=p.academy_id LEFT JOIN learning_path_courses lpc ON lpc.path_id=p.id WHERE "+where.join(" AND ")+" GROUP BY p.id,a.id ORDER BY a.name,p.title",params);
    res.json(rows);
  }catch(e){console.error("Learning path lookup failed:",e);res.status(500).json({error:"unable to load learning paths"});}
});

app.get("/api/learn/paths/:id", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid path id"});
  if(!pool)return res.status(404).json({error:"learning path not found"});
  try{
    const p=await pool.query("SELECT p.id,p.slug,p.title,p.description,p.level,p.estimated_hours,a.id AS academy_id,a.slug AS academy_slug,a.name AS academy_name FROM learning_paths p JOIN learning_academies a ON a.id=p.academy_id WHERE p.id=$1 AND p.status='active'",[id]);
    if(!p.rows[0])return res.status(404).json({error:"learning path not found"});
    const courses=await pool.query("SELECT c.id,c.slug,c.title,c.short_description,c.description,c.level,c.estimated_minutes,c.thumbnail,c.is_free,lpc.position,lpc.required FROM learning_path_courses lpc JOIN courses c ON c.id=lpc.course_id WHERE lpc.path_id=$1 AND c.status='active' ORDER BY lpc.position",[id]);
    res.json({...p.rows[0],courses:courses.rows});
  }catch(e){console.error("Learning path detail failed:",e);res.status(500).json({error:"unable to load learning path"});}
});

app.get("/api/learn/courses", async (req,res) => {
  if(!pool)return res.json(memory.courses);
  try{
    const params=[],where=["c.status='active'"];
    if(req.query.academy_id){const id=Number(req.query.academy_id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid academy id"});params.push(id);where.push("c.academy_id=$"+params.length);}
    if(req.query.level){params.push(String(req.query.level));where.push("LOWER(c.level)=LOWER($"+params.length+")");}
    if(req.query.q){params.push("%"+String(req.query.q).trim()+"%");where.push("(c.title ILIKE $"+params.length+" OR c.short_description ILIKE $"+params.length+" OR c.description ILIKE $"+params.length+")");}
    const {rows}=await pool.query("SELECT c.id,c.slug,c.category,c.title,c.short_description,c.description,c.level,c.estimated_minutes,c.thumbnail,c.is_free,a.id AS academy_id,a.slug AS academy_slug,a.name AS academy_name,COUNT(DISTINCT m.id)::int AS module_count,COUNT(DISTINCT l.id)::int AS lesson_count FROM courses c LEFT JOIN learning_academies a ON a.id=c.academy_id LEFT JOIN course_modules m ON m.course_id=c.id LEFT JOIN lessons l ON l.course_id=c.id WHERE "+where.join(" AND ")+" GROUP BY c.id,a.id ORDER BY c.created_at DESC,c.id DESC",params);
    res.json(rows);
  }catch(e){console.error("Learn course lookup failed:",e);res.status(500).json({error:"unable to load courses"});}
});

app.get("/api/learn/courses/:id", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid course id"});
  if(!pool)return res.status(404).json({error:"course not found"});
  try{
    const c=await pool.query("SELECT c.id,c.slug,c.category,c.title,c.short_description,c.description,c.level,c.estimated_minutes,c.thumbnail,c.is_free,c.status,a.id AS academy_id,a.slug AS academy_slug,a.name AS academy_name FROM courses c LEFT JOIN learning_academies a ON a.id=c.academy_id WHERE c.id=$1 AND c.status='active'",[id]);
    if(!c.rows[0])return res.status(404).json({error:"course not found"});
    const [modules,skills,projects]=await Promise.all([
      pool.query("SELECT m.id,m.title,m.description,m.position,COUNT(l.id)::int AS lesson_count FROM course_modules m LEFT JOIN lessons l ON l.module_id=m.id WHERE m.course_id=$1 GROUP BY m.id ORDER BY m.position",[id]),
      pool.query("SELECT s.id,s.slug,s.name,s.description,s.category,cs.level FROM course_skills cs JOIN skills s ON s.id=cs.skill_id WHERE cs.course_id=$1 ORDER BY s.name",[id]),
      pool.query("SELECT id,title,description,difficulty,estimated_hours,status FROM learning_projects WHERE course_id=$1 AND status='active' ORDER BY created_at",[id])
    ]);
    const user=await getAuthUser(req);let enrollment=null;
    if(user){const e=await pool.query("SELECT id,enrolled_at,progress,completed_at FROM enrollments WHERE user_id=$1 AND course_id=$2",[user.id,id]);enrollment=e.rows[0]||null;}
    res.json({...c.rows[0],modules:modules.rows,skills:skills.rows,projects:projects.rows,enrollment});
  }catch(e){console.error("Learn course detail failed:",e);res.status(500).json({error:"unable to load course"});}
});

app.get("/api/learn/courses/:id/modules", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid course id"});
  if(!pool)return res.json([]);
  try{
    const user=await getAuthUser(req);
    const {rows}=await pool.query("SELECT m.id,m.course_id,m.title,m.description,m.position,COUNT(l.id)::int AS lesson_count,COUNT(lp.lesson_id)::int AS completed_lessons FROM course_modules m LEFT JOIN lessons l ON l.module_id=m.id LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1 WHERE m.course_id=$2 GROUP BY m.id ORDER BY m.position",[user?.id||0,id]);
    res.json(rows);
  }catch(e){console.error("Module lookup failed:",e);res.status(500).json({error:"unable to load course modules"});}
});

app.get("/api/learn/modules/:id", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid module id"});
  if(!pool)return res.status(404).json({error:"module not found"});
  try{
    const m=await pool.query("SELECT m.id,m.course_id,m.title,m.description,m.position,c.title AS course_title FROM course_modules m JOIN courses c ON c.id=m.course_id WHERE m.id=$1",[id]);
    if(!m.rows[0])return res.status(404).json({error:"module not found"});
    const user=await getAuthUser(req);
    const lessons=await pool.query("SELECT l.id,l.title,l.position,CASE WHEN lp.lesson_id IS NULL THEN false ELSE true END AS completed,lp.completed_at FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1 WHERE l.module_id=$2 ORDER BY l.position",[user?.id||0,id]);
    res.json({...m.rows[0],lessons:lessons.rows});
  }catch(e){console.error("Module detail failed:",e);res.status(500).json({error:"unable to load module"});}
});

app.get("/api/learn/lessons/:id", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid lesson id"});
  if(!pool)return res.status(404).json({error:"lesson not found"});
  try{
    const user=await getAuthUser(req);
    const l=await pool.query("SELECT l.id,l.course_id,l.module_id,l.title,l.content,l.position,c.title AS course_title,m.title AS module_title,CASE WHEN lp.lesson_id IS NULL THEN false ELSE true END AS completed,lp.completed_at FROM lessons l JOIN courses c ON c.id=l.course_id LEFT JOIN course_modules m ON m.id=l.module_id LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1 WHERE l.id=$2",[user?.id||0,id]);
    if(!l.rows[0])return res.status(404).json({error:"lesson not found"});
    const activities=await pool.query("SELECT id,activity_type,title,content,configuration,position,points FROM lesson_activities WHERE lesson_id=$1 ORDER BY position",[id]);
    res.json({...l.rows[0],activities:activities.rows});
  }catch(e){console.error("Lesson detail failed:",e);res.status(500).json({error:"unable to load lesson"});}
});


app.get("/api/learn/assessments", async (req,res) => {
  if(!pool)return res.json([]);
  try{
    const params=[],where=["a.status='active'"];
    for(const [query,column,label] of [["course_id","a.course_id","course"],["module_id","a.module_id","module"],["lesson_id","a.lesson_id","lesson"]]){
      if(req.query[query]){
        const id=Number(req.query[query]);
        if(!Number.isInteger(id))return res.status(400).json({error:"invalid "+label+" id"});
        params.push(id);where.push(column+"=$"+params.length);
      }
    }
    const {rows}=await pool.query(
      "SELECT a.id,a.course_id,a.module_id,a.lesson_id,a.title,a.description,a.assessment_type,a.passing_score,a.attempt_limit,COUNT(q.id)::int AS question_count FROM assessments a LEFT JOIN assessment_questions q ON q.assessment_id=a.id WHERE "+where.join(" AND ")+" GROUP BY a.id ORDER BY a.created_at,a.id",
      params
    );
    res.json(rows);
  }catch(e){console.error("Assessment lookup failed:",e);res.status(500).json({error:"unable to load assessments"});}
});

app.get("/api/learn/assessments/:id", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid assessment id"});
  if(!pool)return res.status(404).json({error:"assessment not found"});
  try{
    const a=await pool.query("SELECT id,course_id,module_id,lesson_id,title,description,assessment_type,passing_score,attempt_limit,status FROM assessments WHERE id=$1 AND status='active'",[id]);
    if(!a.rows[0])return res.status(404).json({error:"assessment not found"});
    const questions=await pool.query("SELECT id,question,question_type,options,points,position FROM assessment_questions WHERE assessment_id=$1 ORDER BY position",[id]);
    const user=await getAuthUser(req);
    let attempts=[];
    if(user){
      const history=await pool.query("SELECT id,score,passed,started_at,completed_at FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 ORDER BY started_at DESC,id DESC LIMIT 10",[id,user.id]);
      attempts=history.rows;
    }
    res.json({...a.rows[0],questions:questions.rows,attempts});
  }catch(e){console.error("Assessment detail failed:",e);res.status(500).json({error:"unable to load assessment"});}
});

app.get("/api/learn/assessments/:id/attempts", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid assessment id"});
  if(!pool)return res.json([]);
  try{
    const exists=await pool.query("SELECT id FROM assessments WHERE id=$1 AND status='active'",[id]);
    if(!exists.rows[0])return res.status(404).json({error:"assessment not found"});
    const {rows}=await pool.query("SELECT id,score,passed,started_at,completed_at FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2 ORDER BY started_at DESC,id DESC",[id,user.id]);
    res.json(rows);
  }catch(e){console.error("Assessment attempts lookup failed:",e);res.status(500).json({error:"unable to load assessment attempts"});}
});

app.post("/api/learn/assessments/:id/attempts", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid assessment id"});
  const submitted=req.body?.answers;
  if(!submitted || typeof submitted!=="object" || Array.isArray(submitted))return res.status(400).json({error:"answers object is required"});
  if(!pool)return res.status(201).json({ok:true,score:0,passed:false,results:[]});
  try{
    const a=await pool.query("SELECT id,course_id,passing_score,attempt_limit,status FROM assessments WHERE id=$1 AND status='active'",[id]);
    if(!a.rows[0])return res.status(404).json({error:"assessment not found"});
    const assessment=a.rows[0];
    if(assessment.course_id){
      const enrolled=await pool.query("SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2",[user.id,assessment.course_id]);
      if(!enrolled.rows[0])return res.status(403).json({error:"enroll in this course first"});
    }
    if(assessment.attempt_limit!==null){
      const attempts=await pool.query("SELECT COUNT(*)::int AS count FROM assessment_attempts WHERE assessment_id=$1 AND user_id=$2",[id,user.id]);
      if(attempts.rows[0].count>=assessment.attempt_limit)return res.status(409).json({error:"assessment attempt limit reached"});
    }
    const questions=await pool.query("SELECT id,question_type,correct_answer,points,position FROM assessment_questions WHERE assessment_id=$1 ORDER BY position",[id]);
    if(!questions.rows.length)return res.status(400).json({error:"assessment has no questions"});
    const normalize=value=>{
      if(value===null||value===undefined)return "";
      if(Array.isArray(value))return value.map(v=>String(v).trim().toLowerCase()).sort();
      if(typeof value==="object")return JSON.stringify(value);
      return String(value).trim().toLowerCase();
    };
    const sameAnswer=(left,right)=>JSON.stringify(normalize(left))===JSON.stringify(normalize(right));
    let earned=0,total=0;
    const results=questions.rows.map(q=>{
      const points=Math.max(0,Number(q.points)||0);total+=points;
      const answer=submitted[String(q.id)]!==undefined?submitted[String(q.id)]:submitted[q.id];
      const correct=sameAnswer(answer,q.correct_answer);
      if(correct)earned+=points;
      return {question_id:q.id,correct,points:correct?points:0};
    });
    const score=total?Math.round((earned/total)*10000)/100:0;
    const passed=score>=Number(assessment.passing_score||70);
    const attempt=await pool.query("INSERT INTO assessment_attempts(assessment_id,user_id,score,passed,completed_at) VALUES($1,$2,$3,$4,NOW()) RETURNING id,score,passed,started_at,completed_at",[id,user.id,score,passed]);
    res.status(201).json({ok:true,attempt:attempt.rows[0],score,passed,results});
  }catch(e){console.error("Assessment submission failed:",e);res.status(500).json({error:"unable to submit assessment"});}
});

app.get("/api/learn/projects", async (req,res) => {
  if(!pool)return res.json([]);
  try{
    const params=[],where=["p.status='active'"];
    if(req.query.course_id){const id=Number(req.query.course_id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid course id"});params.push(id);where.push("p.course_id=$"+params.length);}
    if(req.query.academy_id){const id=Number(req.query.academy_id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid academy id"});params.push(id);where.push("p.academy_id=$"+params.length);}
    const {rows}=await pool.query("SELECT p.id,p.title,p.description,p.difficulty,p.estimated_hours,p.skills,p.course_id,p.academy_id,c.title AS course_title,a.name AS academy_name FROM learning_projects p LEFT JOIN courses c ON c.id=p.course_id LEFT JOIN learning_academies a ON a.id=p.academy_id WHERE "+where.join(" AND ")+" ORDER BY p.created_at DESC,p.id DESC",params);
    res.json(rows);
  }catch(e){console.error("Project lookup failed:",e);res.status(500).json({error:"unable to load projects"});}
});

app.get("/api/learn/projects/:id", async (req,res) => {
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid project id"});
  if(!pool)return res.status(404).json({error:"project not found"});
  try{
    const p=await pool.query("SELECT p.id,p.title,p.description,p.instructions,p.difficulty,p.estimated_hours,p.skills,p.course_id,p.academy_id,c.title AS course_title,a.name AS academy_name FROM learning_projects p LEFT JOIN courses c ON c.id=p.course_id LEFT JOIN learning_academies a ON a.id=p.academy_id WHERE p.id=$1 AND p.status='active'",[id]);
    if(!p.rows[0])return res.status(404).json({error:"project not found"});
    const user=await getAuthUser(req);let submission=null;
    if(user){const s=await pool.query("SELECT id,title,description,submission_url,repository_url,content,status,score,feedback,submitted_at,reviewed_at FROM project_submissions WHERE project_id=$1 AND user_id=$2 ORDER BY submitted_at DESC LIMIT 1",[id,user.id]);submission=s.rows[0]||null;}
    res.json({...p.rows[0],submission});
  }catch(e){console.error("Project detail failed:",e);res.status(500).json({error:"unable to load project"});}
});

app.post("/api/learn/projects/:id/submissions", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const id=Number(req.params.id);if(!Number.isInteger(id))return res.status(400).json({error:"invalid project id"});
  const title=String(req.body?.title||"").trim(),description=String(req.body?.description||"").trim(),submissionUrl=String(req.body?.submission_url||"").trim(),repositoryUrl=String(req.body?.repository_url||"").trim(),content=String(req.body?.content||"").trim();
  if(!title&&!content&&!submissionUrl&&!repositoryUrl)return res.status(400).json({error:"submission content is required"});
  if(!pool)return res.status(201).json({ok:true,status:"submitted"});
  try{
    const p=await pool.query("SELECT id FROM learning_projects WHERE id=$1 AND status='active'",[id]);if(!p.rows[0])return res.status(404).json({error:"project not found"});
    const {rows}=await pool.query("INSERT INTO project_submissions(project_id,user_id,title,description,submission_url,repository_url,content) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,project_id,title,status,submitted_at",[id,user.id,title,description,submissionUrl,repositoryUrl,content]);
    res.status(201).json({ok:true,...rows[0]});
  }catch(e){console.error("Project submission failed:",e);res.status(500).json({error:"unable to submit project"});}
});

app.get("/api/learn/my-learning", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json({in_progress:[],completed:[],saved:[],certificates:[],badges:[],skills:[]});
  try{
    const [enrolled,saved,certificates,badges,skills]=await Promise.all([
      pool.query("SELECT c.id,c.slug,c.title,c.short_description,c.level,c.estimated_minutes,e.enrolled_at,e.progress,e.completed_at FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=$1 ORDER BY e.enrolled_at DESC",[user.id]),
      pool.query("SELECT resource_type,resource_id,created_at FROM saved_learning WHERE user_id=$1 ORDER BY created_at DESC",[user.id]),
      pool.query("SELECT id,certificate_number,title,course_id,issued_at,expires_at,verification_code,status FROM certificates WHERE user_id=$1 ORDER BY issued_at DESC",[user.id]),
      pool.query("SELECT b.id,b.slug,b.name,b.description,b.category,ub.awarded_at FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=$1 ORDER BY ub.awarded_at DESC",[user.id]),
      pool.query("SELECT s.id,s.slug,s.name,s.description,s.category,us.level,us.evidence_count,us.verified,us.updated_at FROM user_skills us JOIN skills s ON s.id=us.skill_id WHERE us.user_id=$1 ORDER BY us.updated_at DESC",[user.id])
    ]);
    res.json({in_progress:enrolled.rows.filter(x=>Number(x.progress||0)<100),completed:enrolled.rows.filter(x=>Number(x.progress||0)>=100),saved:saved.rows,certificates:certificates.rows,badges:badges.rows,skills:skills.rows});
  }catch(e){console.error("My learning lookup failed:",e);res.status(500).json({error:"unable to load my learning"});}
});

app.post("/api/learn/save", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const resourceType=String(req.body?.resource_type||"").trim(),resourceId=Number(req.body?.resource_id);
  if(!["course","path","project","lesson"].includes(resourceType)||!Number.isInteger(resourceId))return res.status(400).json({error:"valid resource_type and resource_id are required"});
  if(!pool)return res.json({ok:true,saved:true});
  try{await pool.query("INSERT INTO saved_learning(user_id,resource_type,resource_id) VALUES($1,$2,$3) ON CONFLICT(user_id,resource_type,resource_id) DO NOTHING",[user.id,resourceType,resourceId]);res.json({ok:true,saved:true});}
  catch(e){console.error("Save learning failed:",e);res.status(500).json({error:"unable to save learning resource"});}
});

app.delete("/api/learn/save/:resourceType/:resourceId", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  const type=String(req.params.resourceType),id=Number(req.params.resourceId);
  if(!["course","path","project","lesson"].includes(type)||!Number.isInteger(id))return res.status(400).json({error:"invalid saved resource"});
  if(!pool)return res.json({ok:true});
  try{await pool.query("DELETE FROM saved_learning WHERE user_id=$1 AND resource_type=$2 AND resource_id=$3",[user.id,type,id]);res.json({ok:true});}
  catch(e){console.error("Remove saved learning failed:",e);res.status(500).json({error:"unable to remove saved resource"});}
});


app.get("/api/admin/learning/projects/submissions", async (req,res) => {
  const a=await requireAdmin(req,res);if(a.error)return;
  if(!pool)return res.json([]);
  try{
    const status=req.query.status?String(req.query.status).trim():"";
    const params=[];let where="";
    if(status){params.push(status);where="WHERE ps.status=$1";}
    const {rows}=await pool.query("SELECT ps.id,ps.project_id,ps.user_id,ps.title,ps.description,ps.submission_url,ps.repository_url,ps.content,ps.status,ps.score,ps.feedback,ps.submitted_at,ps.reviewed_at,p.title AS project_title,u.name AS user_name,u.email AS user_email FROM project_submissions ps JOIN learning_projects p ON p.id=ps.project_id JOIN users u ON u.id=ps.user_id "+where+" ORDER BY ps.submitted_at DESC,ps.id DESC",params);
    res.json(rows);
  }catch(e){console.error("Project submission admin lookup failed:",e);res.status(500).json({error:"unable to load project submissions"});}
});

app.put("/api/admin/learning/projects/submissions/:id/review", async (req,res) => {
  const a=await requireAdmin(req,res);if(a.error)return;
  const id=Number(req.params.id),status=String(req.body?.status||"").trim();
  if(!Number.isInteger(id)||!["approved","rejected","needs_revision"].includes(status))return res.status(400).json({error:"invalid submission id or status"});
  const score=req.body?.score===null||req.body?.score===undefined?null:Number(req.body.score);
  if(score!==null&&(!Number.isFinite(score)||score<0||score>100))return res.status(400).json({error:"score must be between 0 and 100"});
  const feedback=String(req.body?.feedback||"").trim().slice(0,5000);
  if(!pool)return res.json({ok:true,status,score,feedback});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const s=await client.query("SELECT ps.id,ps.project_id,ps.user_id,p.title AS project_title,p.skills FROM project_submissions ps JOIN learning_projects p ON p.id=ps.project_id WHERE ps.id=$1 FOR UPDATE",[id]);
    if(!s.rows[0]){await client.query("ROLLBACK");return res.status(404).json({error:"submission not found"});}
    const row=s.rows[0];
    await client.query("UPDATE project_submissions SET status=$1,score=$2,feedback=$3,reviewed_by=$4,reviewed_at=NOW() WHERE id=$5",[status,score,feedback,a.user.id,id]);
    if(status==="approved"){
      const skills=Array.isArray(row.skills)?row.skills:[];
      for(const item of skills){
        const slug=typeof item==="string"?item.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""):String(item?.slug||item?.name||"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
        const name=typeof item==="string"?item.trim():String(item?.name||"").trim();
        if(!slug||!name)continue;
        const skill=await client.query("INSERT INTO skills(slug,name,description,category) VALUES($1,$2,$3,$4) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",[slug,name,"Demonstrated through an approved Kranova project submission.","project"]);
        await client.query("INSERT INTO user_skills(user_id,skill_id,level,evidence_count,verified,updated_at) VALUES($1,$2,'practical',1,true,NOW()) ON CONFLICT(user_id,skill_id) DO UPDATE SET evidence_count=user_skills.evidence_count+1,verified=true,level='practical',updated_at=NOW()",[row.user_id,skill.rows[0].id]);
      }
    }
    let certificate=null;
    if(status==="approved"){
      const course=await client.query("SELECT course_id FROM learning_projects WHERE id=$1",[row.project_id]);
      const courseId=course.rows[0]?.course_id||null;
      if(courseId){
        const enrolled=await client.query("SELECT progress FROM enrollments WHERE user_id=$1 AND course_id=$2",[row.user_id,courseId]);
        if(enrolled.rows[0]&&Number(enrolled.rows[0].progress)>=100){
          const existing=await client.query("SELECT id,certificate_number,title,issued_at,verification_code,status FROM certificates WHERE user_id=$1 AND course_id=$2",[row.user_id,courseId]);
          if(existing.rows[0])certificate=existing.rows[0];
          else{
            const verificationCode=crypto.randomBytes(10).toString("hex").toUpperCase();
            const certificateNumber="KRN-"+new Date().getFullYear()+"-"+String(row.user_id).padStart(6,"0")+"-"+crypto.randomBytes(4).toString("hex").toUpperCase();
            const ins=await client.query("INSERT INTO certificates(user_id,course_id,certificate_number,title,verification_code) VALUES($1,$2,$3,$4,$5) RETURNING id,certificate_number,title,issued_at,verification_code,status",[row.user_id,courseId,certificateNumber,row.project_title,verificationCode]);
            certificate=ins.rows[0];
          }
        }
      }
    }
    await client.query("COMMIT");
    res.json({ok:true,status,score,feedback,certificate});
  }catch(e){await client.query("ROLLBACK");console.error("Project submission review failed:",e);res.status(500).json({error:"unable to review project submission"});}
  finally{client.release();}
});

app.get("/api/learn/certificates/verify/:code", async (req,res) => {
  const code=String(req.params.code||"").trim().toUpperCase();
  if(!code) return res.status(400).json({error:"verification code is required"});
  if(!pool) return res.status(404).json({error:"certificate not found"});
  try{
    const {rows}=await pool.query(`
      SELECT c.id,c.certificate_number,c.title,c.issued_at,c.expires_at,c.verification_code,c.status,
             u.name AS learner_name,
             coalesce(co.title,'') AS course_title
      FROM certificates c
      JOIN users u ON u.id=c.user_id
      LEFT JOIN courses co ON co.id=c.course_id
      WHERE c.verification_code=$1
      LIMIT 1
    `,[code]);
    if(!rows[0]) return res.status(404).json({verified:false,error:"certificate not found"});
    const certificate=rows[0];
    const verified=certificate.status==="active" && (!certificate.expires_at || new Date(certificate.expires_at)>new Date());
    res.json({verified,certificate});
  }catch(e){console.error("Certificate verification failed:",e);res.status(500).json({error:"unable to verify certificate"});}
});

app.get("/api/learn/achievements", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json({certificates:[],badges:[],skills:[],projects:[],milestones:{}});
  try{
    const [certificates,badges,skills,projects,milestones]=await Promise.all([
      pool.query("SELECT id,certificate_number,title,course_id,issued_at,expires_at,verification_code,status FROM certificates WHERE user_id=$1 ORDER BY issued_at DESC",[user.id]),
      pool.query("SELECT b.id,b.slug,b.name,b.description,b.category,ub.awarded_at FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id=$1 ORDER BY ub.awarded_at DESC",[user.id]),
      pool.query("SELECT s.id,s.slug,s.name,s.category,us.level,us.evidence_count,us.verified,us.updated_at FROM user_skills us JOIN skills s ON s.id=us.skill_id WHERE us.user_id=$1 ORDER BY us.updated_at DESC",[user.id]),
      pool.query(`
        SELECT ps.id,ps.project_id,lp.title AS project_title,ps.title,ps.description,ps.submission_url,ps.repository_url,
               ps.status,ps.score,ps.feedback,ps.submitted_at,ps.reviewed_at
        FROM project_submissions ps
        JOIN learning_projects lp ON lp.id=ps.project_id
        WHERE ps.user_id=$1 AND ps.status='approved'
        ORDER BY ps.reviewed_at DESC NULLS LAST,ps.submitted_at DESC
      `,[user.id]),
      pool.query("SELECT COUNT(*) FILTER(WHERE progress>0 AND progress<100)::int AS courses_started,COUNT(*) FILTER(WHERE progress=100)::int AS courses_completed FROM enrollments WHERE user_id=$1",[user.id])
    ]);
    res.json({certificates:certificates.rows,badges:badges.rows,skills:skills.rows,projects:projects.rows,milestones:milestones.rows[0]||{courses_started:0,courses_completed:0}});
  }catch(e){console.error("Achievement lookup failed:",e);res.status(500).json({error:"unable to load achievements"});}
});

app.get("/api/learn/overview", async (req,res) => {
  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json({continue_learning:[],recommended:[],progress:{},next_step:null});
  try{
    const [continueLearning,recommended,progress,nextStep,academies,projects]=await Promise.all([
      pool.query("SELECT c.id,c.slug,c.title,c.short_description,c.level,c.estimated_minutes,e.progress,e.enrolled_at FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=$1 AND e.progress<100 ORDER BY e.enrolled_at DESC LIMIT 6",[user.id]),
      pool.query("SELECT c.id,c.slug,c.title,c.short_description,c.level,c.estimated_minutes,c.category FROM courses c WHERE c.status='active' AND NOT EXISTS(SELECT 1 FROM enrollments e WHERE e.user_id=$1 AND e.course_id=c.id) ORDER BY c.created_at DESC,c.id DESC LIMIT 6",[user.id]),
      pool.query("SELECT COUNT(*)::int AS enrolled,COUNT(*) FILTER(WHERE progress>0 AND progress<100)::int AS in_progress,COUNT(*) FILTER(WHERE progress=100)::int AS completed,COALESCE(ROUND(AVG(progress))::int,0) AS average_progress FROM enrollments WHERE user_id=$1",[user.id]),
      pool.query("SELECT c.id,c.slug,c.title,e.progress FROM enrollments e JOIN courses c ON c.id=e.course_id WHERE e.user_id=$1 AND e.progress<100 ORDER BY e.enrolled_at DESC LIMIT 1",[user.id]),
      pool.query("SELECT a.id,a.slug,a.name,a.description,a.icon,a.category,COUNT(DISTINCT c.id)::int AS course_count FROM learning_academies a LEFT JOIN courses c ON c.academy_id=a.id AND c.status='active' WHERE a.status='active' GROUP BY a.id ORDER BY a.name LIMIT 6"),
      pool.query("SELECT id,title,description,difficulty,estimated_hours,course_id,academy_id FROM learning_projects WHERE status='active' ORDER BY created_at DESC,id DESC LIMIT 6")
    ]);
    res.json({continue_learning:continueLearning.rows,recommended:recommended.rows,progress:progress.rows[0]||{},next_step:nextStep.rows[0]||null,academies:academies.rows,projects:projects.rows});
  }catch(e){console.error("Learn overview failed:",e);res.status(500).json({error:"unable to load learning overview"});}
});

app.get("/api/opportunities", async (_req,res) => {
  if (!pool) return res.json(memory.opportunities);
  const { rows } = await pool.query("SELECT id,type,title,category,description FROM opportunities ORDER BY id"); res.json(rows);
});

app.get("/api/opportunities/:id", async (req,res) => {
  const id=Number(req.params.id); if(!Number.isInteger(id)) return res.status(400).json({error:"invalid opportunity id"});
  if(!pool){const o=memory.opportunities.find(x=>x.id===id);return o?res.json(o):res.status(404).json({error:"opportunity not found"});}
  try{const {rows}=await pool.query("SELECT id,type,title,category,description FROM opportunities WHERE id=$1",[id]);if(!rows[0])return res.status(404).json({error:"opportunity not found"});res.json(rows[0]);}
  catch(e){res.status(500).json({error:"unable to load opportunity"});}
});

app.post("/api/opportunities/:id/apply", async (req,res) => {
  const user=await getAuthUser(req); if(!user)return res.status(401).json({error:"authentication required"});
  const opportunityId=Number(req.params.id); if(!Number.isInteger(opportunityId))return res.status(400).json({error:"invalid opportunity id"});
  if(!pool)return res.status(201).json({ok:true,opportunity_id:opportunityId,status:"Applied"});
  try{
    const exists=await pool.query("SELECT id FROM opportunities WHERE id=$1",[opportunityId]);
    if(!exists.rows[0])return res.status(404).json({error:"opportunity not found"});
    const result=await pool.query("INSERT INTO applications(user_id,opportunity_id) VALUES($1,$2) ON CONFLICT(user_id,opportunity_id) DO NOTHING RETURNING id,status,applied_at",[user.id,opportunityId]);
    res.status(result.rows[0]?201:200).json({ok:true,opportunity_id:opportunityId,applied:!!result.rows[0],...(result.rows[0]||{status:"Applied"})});
  }catch(e){console.error("Application failed:",e);res.status(500).json({error:"unable to apply"});}
});

app.get("/api/me/applications", async (req,res) => {
  const user=await getAuthUser(req); if(!user)return res.status(401).json({error:"authentication required"});
  if(!pool)return res.json([]);
  try{const {rows}=await pool.query(`
    SELECT a.id,a.opportunity_id,o.type,o.title,o.category,o.description,a.status,a.applied_at
    FROM applications a JOIN opportunities o ON o.id=a.opportunity_id
    WHERE a.user_id=$1 ORDER BY a.applied_at DESC
  `,[user.id]);res.json(rows);}
  catch(e){res.status(500).json({error:"unable to load applications"});}
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
async function requireAdmin(req,res){
  const user=await getAuthUser(req);
  if(!user)return {error:true,user:null};
  if(!['admin','super_admin'].includes(user.role)){res.status(403).json({error:"admin access required"});return {error:true,user};}
  return {error:false,user};
}
async function getAuthUser(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  const tokenHash = hashToken(token);
  if (pool) {
    const { rows } = await pool.query(`
      SELECT u.id,u.name,u.email,u.role,u.created_at
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


app.get("/api/courses/:id/lessons", async (req,res) => {
  const courseId = Number(req.params.id);
  if (!Number.isInteger(courseId)) return res.status(400).json({error:"invalid course id"});
  if (!pool) return res.json([]);
  try {
    const {rows}=await pool.query(`
      SELECT l.id,l.course_id,l.title,l.content,l.position,
             CASE WHEN lp.lesson_id IS NULL THEN false ELSE true END AS completed,
             lp.completed_at
      FROM lessons l
      LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1
      WHERE l.course_id=$2 ORDER BY l.position
    `,[(await getAuthUser(req))?.id || 0,courseId]);
    res.json(rows);
  } catch(e) { console.error("Lesson lookup failed:",e); res.status(500).json({error:"unable to load lessons"}); }
});

app.post("/api/lessons/:id/complete", async (req,res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({error:"authentication required"});
  const lessonId=Number(req.params.id);
  if (!Number.isInteger(lessonId)) return res.status(400).json({error:"invalid lesson id"});
  if (!pool) return res.json({ok:true,lesson_id:lessonId,progress:100});
  try {
    const lesson=await pool.query("SELECT id,course_id FROM lessons WHERE id=$1",[lessonId]);
    if(!lesson.rows[0]) return res.status(404).json({error:"lesson not found"});
    const courseId=lesson.rows[0].course_id;
    const enrollment=await pool.query("SELECT id FROM enrollments WHERE user_id=$1 AND course_id=$2",[user.id,courseId]);
    if(!enrollment.rows[0]) return res.status(403).json({error:"enroll in this course first"});
    await pool.query("INSERT INTO lesson_progress(user_id,lesson_id) VALUES($1,$2) ON CONFLICT(user_id,lesson_id) DO NOTHING",[user.id,lessonId]);
    const counts=await pool.query(`
      SELECT COUNT(*)::int AS total,
             COUNT(lp.lesson_id)::int AS completed
      FROM lessons l
      LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1
      WHERE l.course_id=$2
    `,[user.id,courseId]);
    const total=counts.rows[0].total, completed=counts.rows[0].completed;
    const progress=total ? Math.round((completed/total)*100) : 0;
    const updated=await pool.query("UPDATE enrollments SET progress=$1,completed_at=CASE WHEN $1=100 THEN COALESCE(completed_at,NOW()) ELSE NULL END WHERE user_id=$2 AND course_id=$3 RETURNING progress,completed_at",[progress,user.id,courseId]);
    res.json({ok:true,lesson_id:lessonId,course_id:courseId,progress,completed:progress===100,completed_at:updated.rows[0]?.completed_at||null});
  } catch(e) { console.error("Lesson completion failed:",e); res.status(500).json({error:"unable to complete lesson"}); }
});

app.patch("/api/courses/:id/progress", async (req,res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({error:"authentication required"});
  const courseId=Number(req.params.id), progress=Number(req.body && req.body.progress);
  if (!Number.isInteger(courseId)||!Number.isInteger(progress)||progress<0||progress>100) return res.status(400).json({error:"progress must be an integer from 0 to 100"});
  if (!pool) return res.json({ok:true,course_id:courseId,progress,completed:progress===100});
  try {
    const {rows}=await pool.query("UPDATE enrollments SET progress=$1,completed_at=CASE WHEN $1=100 THEN COALESCE(completed_at,NOW()) ELSE NULL END WHERE user_id=$2 AND course_id=$3 RETURNING course_id,progress,completed_at",[progress,user.id,courseId]);
    if(!rows[0]) return res.status(404).json({error:"enrollment not found"});
    res.json({ok:true,...rows[0],completed:rows[0].progress===100});
  } catch(e){console.error("Progress update failed:",e);res.status(500).json({error:"unable to update progress"});}
});

app.get("/api/me/enrollments", async (req,res) => {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({error:"authentication required"});
  try {
    if (!pool) return res.json([]);
    const {rows}=await pool.query(`
      SELECT c.id,c.category,c.title,c.description,c.level,e.enrolled_at,
        COALESCE((SELECT ROUND(COUNT(lp.lesson_id)::numeric * 100 / NULLIF(COUNT(l.id),0))::int
                  FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1
                  WHERE l.course_id=c.id),0) AS progress,
        CASE WHEN COALESCE((SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id),0)>0
                  AND COALESCE((SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON l.id=lp.lesson_id WHERE lp.user_id=$1 AND l.course_id=c.id),0)
                  = (SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id)
             THEN e.completed_at ELSE NULL END AS completed_at
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
      user = { id: memory.users.length + 1, name: cleanName, email: cleanEmail, role: memory.users.length===0 ? "super_admin" : "user", password_hash: passwordHash, password_salt: salt, created_at: new Date().toISOString() };
      memory.users.push(user);
    }
    const token = await createSession(user.id);
    res.status(201).json({ user: { id:user.id,name:user.name,email:user.email,role:user.role||"user",created_at:user.created_at }, token });
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
