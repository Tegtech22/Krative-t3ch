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
app.get("/api/intelligence/memory", async (req,res) => {\n  const user=await getAuthUser(req);if(!user)return res.status(401).json({error:"authentication required"});\n  if(!pool)return res.json([]);\n  try{const {rows}=await pool.query("SELECT id,memory_type,key,value,source,confidence,updated_at FROM intelligence_memory WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 100",[user.id]);res.json(rows);}catch(e){res.status(500).json({error:"unable to load intelligence memory"});}\n});\n\napp.get("/api/intelligence/history", async (req,res) => {
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
      const memoryRows=await pool.query("SELECT memory_type,key,value,source,confidence FROM intelligence_memory WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 50",[user.id]);
      structuredMemory=memoryRows.rows;
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
    const r=await fetch(base+"/api/v1/intelligence",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({input,context:{source:"kranova",user_id:user.id,knowledgeSources,conversationMemory,structuredMemory}})});
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
      const patterns=[[ /\bmy name is ([a-z][a-z '\-]{1,80})/i,'identity','name'],[ /\bi am learning ([a-z0-9 .,'&\-]{2,100})/i,'learning','current_subject'],[ /\bi(?:'m| am) interested in ([a-z0-9 .,'&\-]{2,100})/i,'interest','topic'],[ /\bmy goal is to ([a-z0-9 .,'&\-]{2,120})/i,'goal','primary_goal'] ];
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
