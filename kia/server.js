const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ACCESS_CODE = process.env.KIA_ACCESS_CODE || '';
const CORE_URL = (process.env.KRATIVE_CORE_BASE_URL || 'https://krative-core.onrender.com').replace(/\/$/, '');
const CORE_API_KEY = process.env.KRATIVE_CORE_API_KEY || '';
const NOETICA_URL = (process.env.NOETICA_BASE_URL || 'https://noetica-intelligence.onrender.com').replace(/\/$/, '');
const NOETICA_API_KEY = process.env.NOETICA_API_KEY || '';
const DATABASE_URL = process.env.DATABASE_URL || process.env.KRANOVA_DATABASE_URL || '';
const E2E_TEST_TOKEN = process.env.KIA_E2E_TEST_TOKEN || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'https://kia-krative-intelligence-assistant.onrender.com/api/auth/google/callback';
const googleStates = new Map();

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL or KRANOVA_DATABASE_URL must be configured for persistent KIA accounts.');
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

const sessions = new Map();
const memory = [];
const audit = [];
const users = new Map();

const knowledge = [];

function token(){ return crypto.randomBytes(32).toString('hex'); }

function getSession(req){
  const raw=req.headers.authorization||'';
  if(!raw.startsWith('Bearer ')) return null;
  return sessions.get(raw.slice(7))||null;
}

function requireAuth(req,res,next){
  const s=getSession(req);
  if(!s) return res.status(401).json({error:'Unauthorized.'});
  req.session=s;
  next();
}

function requireAdmin(req,res,next){
  if(req.session?.role!=='admin') return res.status(403).json({error:'Administrator approval required.'});
  next();
}

function record(s,eventType,action,metadata={}){
  const item={
    id:crypto.randomUUID(),
    staffId:s?s.staffId:'unknown',
    eventType,
    action,
    metadata,
    createdAt:new Date().toISOString()
  };
  audit.unshift(item);
  if(audit.length>200) audit.pop();
  void pool.query(
    'INSERT INTO kia_audit (id,staff_id,event_type,action,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [item.id,item.staffId,item.eventType,item.action,JSON.stringify(item.metadata),item.createdAt]
  ).catch(error=>console.error('KIA audit persistence failed:',error.message));
}

function hashPassword(password){
  return new Promise((resolve,reject)=>{
    const salt=crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password,salt,64,(err,key)=>{
      if(err) return reject(err);
      resolve(salt+':'+key.toString('hex'));
    });
  });
}

function verifyPassword(password,stored){
  return new Promise((resolve,reject)=>{
    const [salt,hex]=String(stored||'').split(':');
    if(!salt||!hex) return resolve(false);
    crypto.scrypt(password,salt,64,(err,key)=>{
      if(err) return reject(err);
      const expected=Buffer.from(hex,'hex');
      resolve(expected.length===key.length && crypto.timingSafeEqual(expected,key));
    });
  });
}

function publicUser(u){
  return {
    id:u.id,
    name:u.name,
    email:u.email,
    phone:u.phone,
    department:u.department,
    staffId:u.staffId,
    role:u.role,
    status:u.status,
    createdAt:u.createdAt,
    approvedAt:u.approvedAt||null
  };
}

async function initDatabase(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_users (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      department TEXT NOT NULL,
      staff_id TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_sessions (
      token TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      user_id UUID,
      role TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_memory (
      id UUID PRIMARY KEY,
      staff_id TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'private',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_knowledge (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_connectors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_audit (
      id UUID PRIMARY KEY,
      staff_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      action TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadUsers(){
  users.clear();
  const {rows}=await pool.query('SELECT * FROM kia_users ORDER BY created_at DESC');
  for(const u of rows){
    users.set(u.id,{
      id:u.id,name:u.name,email:u.email,phone:u.phone,department:u.department,
      staffId:u.staff_id,passwordHash:u.password_hash,role:u.role,status:u.status,
      createdAt:u.created_at.toISOString(),approvedAt:u.approved_at?u.approved_at.toISOString():null
    });
  }
}

async function loadPersistentState(){
  sessions.clear();
  const sessionResult=await pool.query('SELECT * FROM kia_sessions');
  for(const s of sessionResult.rows){
    sessions.set(s.token,{staffId:s.staff_id,...(s.user_id?{userId:s.user_id}:{}),role:s.role,createdAt:s.created_at.toISOString()});
  }
  memory.length=0;
  const memoryResult=await pool.query('SELECT * FROM kia_memory ORDER BY created_at DESC LIMIT 1000');
  for(const m of memoryResult.rows) memory.push({id:m.id,staffId:m.staff_id,scope:m.scope,content:m.content,createdAt:m.created_at.toISOString()});
  knowledge.length=0;
  const knowledgeResult=await pool.query('SELECT * FROM kia_knowledge ORDER BY created_at DESC');
  for(const k of knowledgeResult.rows) knowledge.push({id:k.id,title:k.title,content:k.content,createdAt:k.created_at.toISOString()});
  if(!knowledge.length){
    const seed={id:'kia-core',title:'KIA Intelligence Foundation',content:'KIA is Krative T3ch private staff intelligence assistant. It is aligned with NOETICA Intelligence and uses Krative Core when connected.',createdAt:new Date().toISOString()};
    await pool.query('INSERT INTO kia_knowledge (id,title,content,created_at) VALUES ($1,$2,$3,$4)',[seed.id,seed.title,seed.content,seed.createdAt]);
    knowledge.push(seed);
  }
  const defaultPlugins=[
    ['intelligence','KIA Intelligence','Route requests through NOETICA Intelligence and Krative Core.','intelligence'],['memory','KIA Memory','Store and retrieve staff-scoped KIA memory.','productivity'],['knowledge','KIA Knowledge','Read and write the persistent KIA knowledge store.','knowledge'],['audit','KIA Audit','Record and inspect protected KIA activity.','security'],['openai','OpenAI / ChatGPT','Use OpenAI models through the configured OpenAI API connection.','ai'],['claude','Claude','Use Anthropic Claude models through the configured Anthropic API connection.','ai'],['github','GitHub','Read and manage authorized GitHub repositories, issues and pull requests.','development'],['supabase','Supabase','Access authorized Supabase projects and database APIs.','backend'],['gmail','Gmail','Connect approved staff Gmail accounts through Google OAuth.','productivity'],['google-calendar','Google Calendar','Connect approved staff calendars through Google OAuth.','productivity'],['google-drive','Google Drive','Connect approved staff Drive files through Google OAuth.','productivity'],['gemini','Gemini','Use Google Gemini models through the configured Google AI API connection.','ai'],['slack','Slack','Connect authorized Slack workspaces for staff collaboration.','collaboration'],['render','Render','Inspect and operate authorized Render services through the configured Render API connection.','infrastructure']
  ];
  for(const [id,name,description,category] of defaultPlugins){
    await pool.query('INSERT INTO kia_plugins (id,name,description,category,enabled) VALUES ($1,$2,$3,$4,TRUE) ON CONFLICT (id) DO NOTHING',[id,name,description,category]);
  }
  const defaultConnectors=[['core','Krative Core','Live intelligence engine connection used by KIA.'],['noetica','NOETICA Intelligence','Live intelligence runtime connection used by KIA.'],['google','Google Account','Google OAuth connector for approved staff sign-in.'],['github','GitHub','Authorized GitHub account or GitHub App connection.'],['supabase','Supabase','Authorized Supabase project connection.'],['openai','OpenAI / ChatGPT','OpenAI API connection used by KIA plugins and intelligence agents.'],['claude','Claude','Anthropic API connection used by KIA plugins and intelligence agents.'],['gemini','Gemini','Google AI API connection used by KIA plugins and intelligence agents.'],['slack','Slack','Authorized Slack workspace connection.'],['render','Render','Authorized Render API connection.']];
  for(const [id,name,description] of defaultConnectors){
    await pool.query('INSERT INTO kia_connectors (id,name,description,enabled) VALUES ($1,$2,$3,TRUE) ON CONFLICT (id) DO NOTHING',[id,name,description]);
  }
  audit.length=0;
  const auditResult=await pool.query('SELECT * FROM kia_audit ORDER BY created_at DESC LIMIT 200');
  for(const a of auditResult.rows) audit.push({id:a.id,staffId:a.staff_id,eventType:a.event_type,action:a.action,metadata:a.metadata,createdAt:a.created_at.toISOString()});
}

async function saveSession(t,s){
  await pool.query('INSERT INTO kia_sessions (token,staff_id,user_id,role,created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (token) DO UPDATE SET staff_id=EXCLUDED.staff_id,user_id=EXCLUDED.user_id,role=EXCLUDED.role,created_at=EXCLUDED.created_at',[t,s.staffId,s.userId||null,s.role,s.createdAt]);
}

async function deleteSession(t){ await pool.query('DELETE FROM kia_sessions WHERE token=$1',[t]); }

async function saveMemory(item){
  await pool.query('INSERT INTO kia_memory (id,staff_id,scope,content,created_at) VALUES ($1,$2,$3,$4,$5)',[item.id,item.staffId,item.scope,item.content,item.createdAt]);
}

async function saveKnowledge(item){
  await pool.query('INSERT INTO kia_knowledge (id,title,content,created_at) VALUES ($1,$2,$3,$4)',[item.id,item.title,item.content,item.createdAt]);
}

async function saveUser(u){
  await pool.query(
    `INSERT INTO kia_users
      (id,name,email,phone,department,staff_id,password_hash,role,status,created_at,approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,
      department=EXCLUDED.department,staff_id=EXCLUDED.staff_id,
      password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,
      status=EXCLUDED.status,approved_at=EXCLUDED.approved_at`,
    [u.id,u.name,u.email,u.phone,u.department,u.staffId,u.passwordHash,u.role,u.status,u.createdAt,u.approvedAt||null]
  );
}

app.get('/health',(req,res)=>res.json({
  status:'ok',
  service:'kia',
  coreConfigured:Boolean(CORE_API_KEY),
  coreBaseUrl:CORE_URL,
  noeticaConfigured:Boolean(NOETICA_URL),
  noeticaKeyConfigured:Boolean(NOETICA_API_KEY),
  noeticaBaseUrl:NOETICA_URL,
  signupEnabled:true
}));

async function createGoogleSession(user,res){
  const t=token();
  const session={staffId:user.staffId,userId:user.id,role:user.role,createdAt:new Date().toISOString()};
  sessions.set(t,session);
  await saveSession(t,session);
  record(session,'AUTH_LOGIN','google_login',{userId:user.id,provider:'google'});
  res.redirect('/?google_token='+encodeURIComponent(t));
}

app.get('/api/auth/google',(req,res)=>{
  if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET)
    return res.status(503).send('Google Sign-In is not configured on KIA.');
  const state=crypto.randomBytes(24).toString('hex');
  googleStates.set(state,{createdAt:Date.now()});
  setTimeout(()=>googleStates.delete(state),10*60*1000);
  const params=new URLSearchParams({
    client_id:GOOGLE_CLIENT_ID,
    redirect_uri:GOOGLE_REDIRECT_URI,
    response_type:'code',
    scope:'openid email profile',
    access_type:'offline',
    prompt:'select_account',
    state
  });
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?'+params.toString());
});

app.get('/api/auth/google/callback',async(req,res)=>{
  const state=String(req.query.state||'');
  const entry=googleStates.get(state);
  googleStates.delete(state);
  if(!entry||Date.now()-entry.createdAt>10*60*1000) return res.status(400).send('Invalid or expired Google sign-in state.');
  const code=String(req.query.code||'');
  if(!code) return res.status(400).send('Google sign-in was cancelled or failed.');
  try{
    const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({
        code,
        client_id:GOOGLE_CLIENT_ID,
        client_secret:GOOGLE_CLIENT_SECRET,
        redirect_uri:GOOGLE_REDIRECT_URI,
        grant_type:'authorization_code'
      })
    });
    const tokenData=await tokenResponse.json();
    if(!tokenResponse.ok||!tokenData.access_token) throw new Error(tokenData.error_description||'Google token exchange failed.');
    const profileResponse=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{
      headers:{Authorization:'Bearer '+tokenData.access_token}
    });
    const profile=await profileResponse.json();
    if(!profileResponse.ok||!profile.sub||!profile.email) throw new Error('Google did not return a usable account.');
    const email=String(profile.email).trim().toLowerCase();
    let user=[...users.values()].find(u=>u.email===email);
    if(!user){
      user={
        id:crypto.randomUUID(),
        name:String(profile.name||profile.email.split('@')[0]).slice(0,120),
        email,
        phone:'',
        department:'Unassigned',
        staffId:'google-'+String(profile.sub).slice(0,40),
        passwordHash:await hashPassword(crypto.randomBytes(32).toString('hex')),
        role:'staff',
        status:'pending',
        createdAt:new Date().toISOString()
      };
      await saveUser(user);
      users.set(user.id,user);
      record({staffId:user.staffId},'AUTH_SIGNUP','google_signup',{userId:user.id,email,provider:'google'});
      return res.redirect('/?google_error='+encodeURIComponent('Your Google account was registered, but administrator approval is required before you can use KIA.'));
    }
    if(user.status!=='approved')
      return res.redirect('/?google_error='+encodeURIComponent(user.status==='pending'?'Your KIA account is pending administrator approval.':'Your KIA account is not approved.'));
    return createGoogleSession(user,res);
  }catch(error){
    console.error('Google sign-in failed:',error.message);
    return res.redirect('/?google_error='+encodeURIComponent('Google Sign-In failed. Please try again.'));
  }
});

// Legacy/admin access. Use staffId "admin" with the existing KIA access code for administrator access.
app.post('/api/login',async(req,res)=>{
  const staffId=String(req.body&&req.body.staffId||'').trim().slice(0,80);
  const accessCode=req.body&&req.body.accessCode;

  if(staffId.toLowerCase()==='admin'){
    if(!ACCESS_CODE) return res.status(503).json({error:'KIA access is not configured.'});
    if(typeof accessCode!=='string'||accessCode!==ACCESS_CODE) return res.status(401).json({error:'Invalid administrator credentials.'});
    const t=token();
    const s={staffId:'admin',role:'admin',createdAt:new Date().toISOString()};
    sessions.set(t,s);
    await saveSession(t,s);
    record(s,'AUTH_LOGIN','admin_login');
    return res.json({token:t,staff:s});
  }

  if(!ACCESS_CODE) return res.status(503).json({error:'KIA access is not configured.'});
  if(typeof accessCode!=='string'||accessCode!==ACCESS_CODE) return res.status(401).json({error:'Invalid staff access code.'});

  const t=token();
  const s={staffId:staffId||'staff',role:'staff',createdAt:new Date().toISOString()};
  sessions.set(t,s);
  await saveSession(t,s);
  record(s,'AUTH_LOGIN','legacy_staff_login');
  res.json({token:t,staff:s});
});

app.post('/api/signup',async(req,res)=>{
  try{
    const name=String(req.body?.name||'').trim().slice(0,120);
    const email=String(req.body?.email||'').trim().toLowerCase().slice(0,160);
    const phone=String(req.body?.phone||'').trim().slice(0,40);
    const department=String(req.body?.department||'').trim().slice(0,100);
    const staffId=String(req.body?.staffId||'').trim().slice(0,80);
    const password=typeof req.body?.password==='string'?req.body.password:'';

    if(!name||!email||!phone||!department||!staffId||!password)
      return res.status(400).json({error:'Name, email, phone, department, staff ID and password are required.'});
    if(!/^\S+@\S+\.\S+$/.test(email))
      return res.status(400).json({error:'Enter a valid email address.'});
    if(password.length<8)
      return res.status(400).json({error:'Password must be at least 8 characters.'});

    const duplicate=[...users.values()].find(u=>u.email===email||u.staffId.toLowerCase()===staffId.toLowerCase());
    if(duplicate) return res.status(409).json({error:'An account with that email or staff ID already exists.'});

    const user={
      id:crypto.randomUUID(),
      name,email,phone,department,staffId,
      passwordHash:await hashPassword(password),
      role:'staff',
      status:'pending',
      createdAt:new Date().toISOString()
    };
    await saveUser(user);
    users.set(user.id,user);
    record({staffId:'public-signup'},'AUTH_SIGNUP','staff_signup',{userId:user.id,email,department});
    res.status(201).json({
      success:true,
      message:'Registration submitted. Your account is pending administrator approval.',
      user:publicUser(user)
    });
  }catch(error){
    res.status(500).json({error:'Unable to create the account.'});
  }
});

app.post('/api/account-login',async(req,res)=>{
  const email=String(req.body?.email||'').trim().toLowerCase();
  const password=typeof req.body?.password==='string'?req.body.password:'';
  const user=[...users.values()].find(u=>u.email===email);

  if(!user||!(await verifyPassword(password,user.passwordHash)))
    return res.status(401).json({error:'Invalid email or password.'});
  if(user.status==='pending') return res.status(403).json({error:'Your account is pending administrator approval.'});
  if(user.status==='rejected') return res.status(403).json({error:'Your registration was not approved.'});

  const t=token();
  const s={staffId:user.staffId,userId:user.id,role:user.role,createdAt:new Date().toISOString()};
  sessions.set(t,s);
  await saveSession(t,s);
  record(s,'AUTH_LOGIN','account_login',{userId:user.id});
  res.json({token:t,staff:{...s,name:user.name,email:user.email,department:user.department}});
});

app.post('/api/logout',requireAuth,async(req,res)=>{
  record(req.session,'AUTH_LOGOUT','staff_logout');
  const sessionToken=req.headers.authorization.slice(7);
  sessions.delete(sessionToken);
  await deleteSession(sessionToken);
  res.json({success:true});
});

app.get('/api/session',requireAuth,(req,res)=>{
  if(req.session.userId){
    const u=users.get(req.session.userId);
    return res.json({staff:{...req.session,...(u?{name:u.name,email:u.email,department:u.department}: {})}});
  }
  res.json({staff:req.session});
});

app.get('/api/status',requireAuth,async(req,res)=>{
  let core={configured:Boolean(CORE_API_KEY),reachable:false};
  try{const r=await fetch(CORE_URL+'/health');core.reachable=r.ok}catch{}
  res.json({
    service:'KIA',
    core,
    capabilities:['understanding','classification','knowledge','memory','reasoning','decision','execution','learning','audit'],
    authentication:{signup:true,approval:true,role:req.session.role}
  });
});

app.get('/api/admin/pending',requireAuth,requireAdmin,(req,res)=>{
  res.json({items:[...users.values()].filter(u=>u.status==='pending').map(publicUser)});
});

app.get('/api/admin/users',requireAuth,requireAdmin,(req,res)=>{
  res.json({items:[...users.values()].map(publicUser)});
});

app.post('/api/admin/users/:id/approve',requireAuth,requireAdmin,async(req,res)=>{
  const u=users.get(req.params.id);
  if(!u) return res.status(404).json({error:'User not found.'});
  u.status='approved';
  u.approvedAt=new Date().toISOString();
  try{
    await saveUser(u);
  }catch(error){
    return res.status(500).json({error:'Unable to save approval.'});
  }
  record(req.session,'AUTH_APPROVAL','approve_staff',{userId:u.id});
  res.json({success:true,user:publicUser(u)});
});

app.post('/api/admin/users/:id/reject',requireAuth,requireAdmin,async(req,res)=>{
  const u=users.get(req.params.id);
  if(!u) return res.status(404).json({error:'User not found.'});
  u.status='rejected';
  try{
    await saveUser(u);
  }catch(error){
    return res.status(500).json({error:'Unable to save rejection.'});
  }
  record(req.session,'AUTH_REJECTION','reject_staff',{userId:u.id});
  res.json({success:true,user:publicUser(u)});
});

function extractMemoryRequest(input){
  const text=String(input||'').trim();
  const match=text.match(/^remember(?:\s+that)?\s+(.+)$/i);
  if(!match) return null;
  const content=match[1].trim().replace(/[.!?]+$/,'').trim();
  return content.length>=3?content:null;
}

function classifyInput(input){
  const text=input.toLowerCase();
  if(/\b(what|who|when|where|which|how|why)\b/.test(text)) return 'question';
  if(/\b(plan|roadmap|strategy|steps|build|develop|implement)\b/.test(text)) return 'planning';
  if(/\b(compare|versus|vs|difference|evaluate|assess)\b/.test(text)) return 'analysis';
  if(/\b(decide|decision|should we|recommend|choose)\b/.test(text)) return 'decision_support';
  if(/\b(create|write|draft|design|generate)\b/.test(text)) return 'creation';
  return 'conversation';
}
function retrieveContext(staffId,input){
  const normalized=String(input||'').toLowerCase().trim();
  const explicitMemoryRecall=/\b(what did i ask you to remember|what do you remember|what have you remembered|show me what you remember|recall what i asked you to remember)\b/.test(normalized);
  const terms=normalized.split(/\W+/).filter(x=>x.length>3).slice(0,12);
  const score=(text)=>terms.reduce((n,t)=>n+(text.toLowerCase().includes(t)?1:0),0);
  const staffMemories=memory.filter(x=>x.staffId===staffId||x.scope==='shared');
  const memories=explicitMemoryRecall
    ? staffMemories.slice(0,5).map(x=>({...x,_score:1}))
    : staffMemories.map(x=>({...x,_score:score(x.content)})).filter(x=>x._score>0).sort((a,b)=>b._score-a._score).slice(0,5);
  const knowledgeHits=knowledge.map(x=>({...x,_score:score(x.title+' '+x.content)})).filter(x=>x._score>0).sort((a,b)=>b._score-a._score).slice(0,5);
  return {memories,knowledge:knowledgeHits};
}
function buildKiaResponse(data){
  const result=data&&data.result!==undefined?data.result:data;
  if(typeof result==='string') return result;
  if(!result) return 'I received no usable intelligence result.';

  const response =
    result.response &&
    typeof result.response === 'object'
      ? result.response
      : null;

  const intelligence =
    result.intelligence &&
    typeof result.intelligence === 'object'
      ? result.intelligence
      : null;

  const candidates=[
    result.answer,
    result.output,
    result.message,
    result.text,
    result.content,
    response?.message,
    response?.answer,
    response?.content,
    intelligence?.answer
  ];

  const text=candidates.find(x=>typeof x==='string'&&x.trim());
  if(text) return text;

  return JSON.stringify(result,null,2);
}

async function runKiaIntelligence(input, session){
  if(!input) throw Object.assign(new Error('Input is required.'),{statusCode:400});
  if(!CORE_API_KEY) throw Object.assign(new Error('Krative Core API key is not configured on KIA.'),{statusCode:503});

  const intent=classifyInput(input);
  const context=retrieveContext(session.staffId,input);
  record(session,'INTELLIGENCE_REQUEST','understand_input',{length:input.length,intent});
  record(session,'INTELLIGENCE_ROUTE','route_request',{route:'noetica',intent,memoryMatches:context.memories.length,knowledgeMatches:context.knowledge.length});

  const coreContext={
    source:'KIA',staffId:session.staffId,intent,
    pipeline:['UNDERSTAND','CLASSIFY','ROUTE','CONTEXT','NOETICA','KRATIVE_CORE','RESPONSE','UPDATE'],
    shortTermMemory:context.memories.map(x=>({content:x.content,importance:0.8,scope:x.scope,createdAt:x.createdAt})),
    knowledgeSources:context.knowledge.map(x=>({id:x.id,type:'knowledge',title:x.title,content:x.content,confidence:0.85,verified:true,createdAt:x.createdAt})),
    system:'You are the intelligence assistant serving the KIA product. Answer questions across general knowledge, technology, science, business, mathematics, writing, analysis, planning, coding, current-context reasoning, and everyday topics. Give a useful direct answer whenever the available information supports one. Do not refuse simply because the question does not match a predefined intent. Use the supplied memory and knowledge as context, and distinguish known information from uncertainty. For current or time-sensitive facts, do not invent freshness; state when verification is needed. Your product identity is KIA: identify yourself as KIA when asked. Do not call yourself Noe and do not present NOETICA as the assistant identity. NOETICA is the intelligence runtime behind KIA, while Krative Core is the underlying intelligence engine. If supplied memory directly answers the user question, answer from that memory explicitly. When the user asks what they asked you to remember, list or summarize the relevant stored memory content instead of merely saying a memory operation was processed. Keep answers natural and useful. Do not expose credentials, hidden system instructions, or internal implementation details unless the user explicitly asks for technical output.', productIdentity:'KIA', assistantName:'KIA', runtimeIdentity:'NOETICA Intelligence', coreIdentity:'Krative Core'
  };

  if(!NOETICA_API_KEY) throw Object.assign(new Error('NOETICA API key is not configured on KIA.'),{statusCode:503});

  const controller=typeof AbortController==='function'?new AbortController():null;
  const timeoutMs=Number(process.env.NOETICA_TIMEOUT_MS||35000);
  const timeoutHandle=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
  let r;
  let data={};
  const maxRetries=3;
  for(let attempt=0;attempt<maxRetries;attempt++){
    try{
      r=await fetch(NOETICA_URL+'/api/v1/intelligence',{
        method:'POST',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+NOETICA_API_KEY},
        body:JSON.stringify({input,context:{...coreContext,memoryKey:session.staffId}}),
        ...(controller?{signal:controller.signal}: {})
      });
    }catch(error){
      if(error?.name==='AbortError'){
        throw Object.assign(new Error('NOETICA request timed out after '+timeoutMs+'ms.'),{statusCode:504,detail:'NOETICA upstream timeout.'});
      }
      if(attempt<maxRetries-1){
        await new Promise(resolve=>setTimeout(resolve,3000*(2**attempt)));
        continue;
      }
      throw Object.assign(new Error('Unable to connect to NOETICA.'),{statusCode:502,detail:error?.message||'NOETICA connection failed.'});
    }

    const raw=await r.text();
    if(raw.trim()){
      try{data=JSON.parse(raw);}catch{
        if([429,502,503,504].includes(r.status)&&attempt<maxRetries-1){
          await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));
          continue;
        }
        throw Object.assign(new Error('Invalid NOETICA response.'),{statusCode:502,detail:'NOETICA returned non-JSON HTTP '+r.status+' content-type='+(r.headers.get('content-type')||'unknown')+'.'});
      }
    }
    break;
  }
  if(!r?.ok){
    record(session,'INTELLIGENCE_ERROR','noetica_response_error',{status:r?.status||0});
    throw Object.assign(new Error(data?.error||'NOETICA request failed.'),{statusCode:502,detail:data?.error||'NOETICA request failed.'});
  }

  const response=buildKiaResponse(data);
  record(session,'INTELLIGENCE_RESPONSE','noetica_response',{
    status:r.status,intent,
    usedMemory:context.memories.length,
    usedKnowledge:context.knowledge.length,
    route:'NOETICA→Krative Core'
  });
  return {success:true,response,intent,context:{memoryMatches:context.memories.length,knowledgeMatches:context.knowledge.length},noetica:data};
}

app.post('/api/chat',requireAuth,async(req,res)=>{
  const input=typeof(req.body&&req.body.input)==='string'?req.body.input.trim():'';
  try{
    const memoryContent=extractMemoryRequest(input);
    if(memoryContent){
      const item={id:crypto.randomUUID(),staffId:req.session.staffId,scope:'private',content:memoryContent,createdAt:new Date().toISOString()};
      await saveMemory(item);
      memory.unshift(item);
      record(req.session,'MEMORY_WRITE','store_memory',{memoryId:item.id,scope:item.scope,source:'natural_language'});
      const result=await runKiaIntelligence(input,req.session);
      return res.json({...result,memoryStored:true,storedMemory:memoryContent});
    }
    const result=await runKiaIntelligence(input,req.session);
    return res.json(result);
  }catch(error){
    const status=error.statusCode||502;
    return res.status(status).json({error:status===502?'NOETICA/Core intelligence request failed.':error.message,intent:input?classifyInput(input):undefined,detail:error.detail});
  }
});

app.post('/api/test/e2e',async(req,res)=>{
  if(!E2E_TEST_TOKEN || req.headers['x-kia-e2e-token']!==E2E_TEST_TOKEN)
    return res.status(404).json({error:'Not found.'});

  const input=typeof req.body?.input==='string'&&req.body.input.trim()
    ? req.body.input.trim()
    : 'E2E integration test: explain in one sentence what Krative Core does.';
  const session={staffId:'e2e-test',role:'test',createdAt:new Date().toISOString()};
  try{
    const result=await runKiaIntelligence(input,session);
    const noeticaResult=result.noetica?.result;
    const coreResult=noeticaResult?.core?.state;
    const passed=Boolean(
      result.success &&
      result.response &&
      noeticaResult?.status==='completed' &&
      coreResult?.status==='completed' &&
      coreResult?.stage==='EXECUTION' &&
      coreResult?.kif?.status==='fused'
    );
    return res.status(passed?200:502).json({
      passed,
      test:'KIA → NOETICA → Krative Core',
      response:result.response,
      intent:result.intent,
      noetica:{success:result.noetica?.success,status:noeticaResult?.status,stage:noeticaResult?.stage},
      core:{status:coreResult?.status,stage:coreResult?.stage,kifStatus:coreResult?.kif?.status,kifSourceCount:coreResult?.kif?.sourceCount},
      context:result.context
    });
  }catch(error){
    return res.status(502).json({passed:false,test:'KIA → NOETICA → Krative Core',error:error.message});
  }
});

app.get('/api/memory',requireAuth,(req,res)=>res.json({items:memory.filter(x=>x.staffId===req.session.staffId||x.scope==='shared')}));
app.post('/api/memory',requireAuth,async(req,res)=>{
  const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';
  if(!content) return res.status(400).json({error:'Memory content is required.'});
  const item={id:crypto.randomUUID(),staffId:req.session.staffId,scope:req.body&&req.body.scope==='shared'?'shared':'private',content,createdAt:new Date().toISOString()};
  await saveMemory(item);
  memory.unshift(item);
  record(req.session,'MEMORY_WRITE','store_memory',{memoryId:item.id,scope:item.scope});
  res.status(201).json(item);
});
app.get('/api/knowledge',requireAuth,(req,res)=>res.json({items:knowledge}));
app.post('/api/knowledge',requireAuth,async(req,res)=>{
  const title=typeof(req.body&&req.body.title)==='string'?req.body.title.trim():'';
  const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';
  if(!title||!content) return res.status(400).json({error:'Title and content are required.'});
  const item={id:crypto.randomUUID(),title,content,createdAt:new Date().toISOString()};
  await saveKnowledge(item);
  knowledge.unshift(item);
  record(req.session,'KNOWLEDGE_WRITE','add_knowledge',{knowledgeId:item.id});
  res.status(201).json(item);
});
app.get('/api/plugins',requireAuth,async(req,res)=>{
  const {rows}=await pool.query('SELECT id,name,description,category,enabled FROM kia_plugins ORDER BY name');
  const configured={intelligence:Boolean(NOETICA_API_KEY&&CORE_API_KEY),memory:true,knowledge:true,audit:true,openai:Boolean(process.env.OPENAI_API_KEY),claude:Boolean(process.env.ANTHROPIC_API_KEY),github:Boolean(process.env.GITHUB_TOKEN),supabase:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY),gmail:Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET),'google-calendar':Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET),'google-drive':Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET),gemini:Boolean(process.env.GEMINI_API_KEY),slack:Boolean(process.env.SLACK_BOT_TOKEN),render:Boolean(process.env.RENDER_API_KEY)};
  res.json({items:rows.map(x=>{const ready=Boolean(configured[x.id]);return {...x,status:!x.enabled?'disabled':ready?'active':'not_configured',configured:ready,actions:x.enabled&&ready?['run']:[]};})});
});
app.put('/api/plugins/:id',requireAuth,requireAdmin,async(req,res)=>{
  const enabled=Boolean(req.body?.enabled);
  const {rows}=await pool.query('UPDATE kia_plugins SET enabled=$1,updated_at=NOW() WHERE id=$2 RETURNING id,name,enabled',[enabled,req.params.id]);
  if(!rows[0]) return res.status(404).json({error:'Plugin not found.'});
  record(req.session,'PLUGIN_UPDATE',enabled?'enable_plugin':'disable_plugin',{pluginId:req.params.id,enabled});
  res.json({success:true,plugin:rows[0]});
});
app.post('/api/plugins/:id/run',requireAuth,async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM kia_plugins WHERE id=$1',[req.params.id]);
  const plugin=rows[0];
  if(!plugin) return res.status(404).json({error:'Plugin not found.'});
  if(!plugin.enabled) return res.status(409).json({error:'Plugin is disabled.'});
  if(plugin.id==='intelligence'){
    const input=typeof req.body?.input==='string'&&req.body.input.trim()?req.body.input.trim():'Plugin health test: confirm KIA intelligence is operational in one sentence.';
    const result=await runKiaIntelligence(input,req.session);
    record(req.session,'PLUGIN_EXECUTION','run_plugin',{pluginId:plugin.id});
    return res.json({success:true,plugin:plugin.id,output:result.response,intent:result.intent});
  }
  if(plugin.id==='memory') return res.json({success:true,plugin:plugin.id,output:'Memory plugin is active. Use the Memory section or /api/memory to store and retrieve staff-scoped memory.'});
  if(plugin.id==='knowledge') return res.json({success:true,plugin:plugin.id,output:'Knowledge plugin is active. Use the Knowledge Centre or /api/knowledge to manage persistent knowledge.'});
  if(plugin.id==='audit') return res.json({success:true,plugin:plugin.id,output:'Audit plugin is active. Protected KIA actions are being recorded in the audit system.'});
  const input=typeof req.body?.input==='string'&&req.body.input.trim()?req.body.input.trim():'KIA plugin connectivity test.';
  if(plugin.id==='openai'){
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.KIA_OPENAI_PLUGIN_MODEL||'gpt-5.6-luna',input})}); const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'OpenAI plugin request failed.'}); return res.json({success:true,plugin:plugin.id,output:d.output_text||'OpenAI returned no text.'});
  }
  if(plugin.id==='claude'){
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:process.env.KIA_CLAUDE_PLUGIN_MODEL||'claude-sonnet-5',max_tokens:512,messages:[{role:'user',content:input}]})}); const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Claude plugin request failed.'}); return res.json({success:true,plugin:plugin.id,output:(d.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('')||'Claude returned no text.'});
  }
  if(plugin.id==='github'){
    const r=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'KIA-Krative-T3ch'}}); const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.message||'GitHub plugin request failed.'}); return res.json({success:true,plugin:plugin.id,output:'GitHub connected as '+(d.login||'authorized user')+'.'});
  }
  if(plugin.id==='supabase'){
    const base=(process.env.SUPABASE_URL||'').replace(/\/$/,''); const r=await fetch(base+'/rest/v1/',{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY}}); if(!r.ok)return res.status(502).json({error:'Supabase plugin request failed with HTTP '+r.status+'.'}); return res.json({success:true,plugin:plugin.id,output:'Supabase connection is active and the REST API is reachable.'});
  }
  if(plugin.id==='gemini'){
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+encodeURIComponent(process.env.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:input}]}]})}); const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Gemini plugin request failed.'}); return res.json({success:true,plugin:plugin.id,output:d.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join('')||'Gemini returned no text.'});
  }
  if(['gmail','google-calendar','google-drive'].includes(plugin.id))return res.status(409).json({error:'Connect Google in the Connectors section before running this Google service plugin.'});
  if(plugin.id==='slack')return res.status(409).json({error:'Slack plugin requires an authorized workspace token.'});
  if(plugin.id==='render')return res.status(409).json({error:'Render plugin requires an authorized Render API key.'});
  return res.status(400).json({error:'Plugin action is not implemented.'});
});
app.get('/api/connectors',requireAuth,async(req,res)=>{
  const {rows}=await pool.query('SELECT id,name,description,enabled FROM kia_connectors ORDER BY name');
  const items=[];
  for(const x of rows){
    let status=x.enabled?'configured':'disabled',detail='',action=null,actionLabel=null;
    if(x.id==='core'){
      try{const r=await fetch(CORE_URL+'/health');status=x.enabled&&r.ok?'connected':'unreachable';detail=r.ok?'Core health check passed.':'Core health check failed.';}catch(e){status='unreachable';detail='Core health check failed.';}
    }else if(x.id==='noetica'){
      try{const r=await fetch(NOETICA_URL+'/health');status=x.enabled&&r.ok?'connected':'unreachable';detail=r.ok?'NOETICA health check passed.':'NOETICA health check failed.';}catch(e){status='unreachable';detail='NOETICA health check failed.';}
    }else if(x.id==='google'){status=GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET?'ready':'not_configured';detail=status==='ready'?'Google OAuth is configured; staff authorization is required to connect.':'Google OAuth credentials are not configured.';action=status==='ready';actionLabel='Connect Google';
    }else if(x.id==='github'){status=process.env.GITHUB_TOKEN?'connected':'not_configured';detail=status==='connected'?'GitHub token is configured.':'Set GITHUB_TOKEN.';
    }else if(x.id==='supabase'){status=process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY?'connected':'not_configured';detail=status==='connected'?'Supabase API is configured.':'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.';
    }else if(x.id==='openai'){status=process.env.OPENAI_API_KEY?'connected':'not_configured';detail=status==='connected'?'OpenAI API is configured.':'Set OPENAI_API_KEY.';
    }else if(x.id==='claude'){status=process.env.ANTHROPIC_API_KEY?'connected':'not_configured';detail=status==='connected'?'Anthropic API is configured.':'Set ANTHROPIC_API_KEY.';
    }else if(x.id==='gemini'){status=process.env.GEMINI_API_KEY?'connected':'not_configured';detail=status==='connected'?'Gemini API is configured.':'Set GEMINI_API_KEY.';
    }else if(x.id==='slack'){status=process.env.SLACK_BOT_TOKEN?'connected':'not_configured';detail=status==='connected'?'Slack token is configured.':'Set SLACK_BOT_TOKEN.';
    }else if(x.id==='render'){status=process.env.RENDER_API_KEY?'connected':'not_configured';detail=status==='connected'?'Render API is configured.':'Set RENDER_API_KEY.';
    }
    items.push({...x,status,detail,action,actionLabel});
  }
  res.json({items});
});
app.post('/api/connectors/:id/action',requireAuth,async(req,res)=>{
  if(req.params.id==='google'){
    if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET) return res.status(503).json({error:'Google connector is not configured.'});
    const state=crypto.randomBytes(24).toString('hex');
    googleStates.set(state,{createdAt:Date.now(),connector:'google',staffId:req.session.staffId});
    setTimeout(()=>googleStates.delete(state),10*60*1000);
    const params=new URLSearchParams({client_id:GOOGLE_CLIENT_ID,redirect_uri:GOOGLE_REDIRECT_URI,response_type:'code',scope:'openid email profile',access_type:'offline',prompt:'select_account',state});
    record(req.session,'CONNECTOR_ACTION','connect_google',{connectorId:'google'});
    return res.json({success:true,redirect:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString()});
  }
  if(req.params.id==='core'||req.params.id==='noetica'||['github','supabase','openai','claude','gemini','slack','render'].includes(req.params.id)){
    record(req.session,'CONNECTOR_ACTION','health_check',{connectorId:req.params.id});
    return res.json({success:true,message:'Connector status check completed. Refresh the Connectors section to see the live status.'});
  }
  return res.status(404).json({error:'Connector not found.'});
});
app.get('/api/audit',requireAuth,(req,res)=>res.json({items:audit}));

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
initDatabase()
  .then(loadUsers)
  .then(loadPersistentState)
  .then(()=>{
    app.listen(PORT,'0.0.0.0',()=>{
      console.log('KIA listening on '+PORT);
      if(process.env.KIA_STARTUP_E2E_TEST==='true'){
        const session={staffId:'startup-e2e',role:'test',createdAt:new Date().toISOString()};
        const warm=(url)=>fetch(url,{signal:typeof AbortSignal?.timeout==='function'?AbortSignal.timeout(20000):undefined}).catch(()=>null);
        Promise.all([warm(NOETICA_URL+'/health'),warm(CORE_URL+'/health')])
          .then(()=>new Promise(resolve=>setTimeout(resolve,5000)))
          .then(()=>runKiaIntelligence('KIA startup integration test: explain in one sentence what Krative Core does.',session))
          .then(result=>{
            const noeticaResult=result.noetica?.result;
            const coreResult=noeticaResult?.core?.state;
            const passed=Boolean(result.success&&result.response&&noeticaResult?.status==='completed'&&coreResult?.status==='completed'&&coreResult?.stage==='EXECUTION'&&coreResult?.kif?.status==='fused');
            console.log(JSON.stringify({
              type:'KIA_STARTUP_E2E',passed,
              noeticaSuccess:result.noetica?.success===true,
              coreStatus:coreResult?.status||null,
              coreStage:coreResult?.stage||null,
              kifStatus:coreResult?.kif?.status||null,
              kifSourceCount:coreResult?.kif?.sourceCount||null
            }));
          })
          .catch(error=>console.error(JSON.stringify({type:'KIA_STARTUP_E2E',passed:false,error:error.message,detail:error.detail||null})));
      }
    });
  })
  .catch(error=>{
    console.error('KIA database initialization failed:',error);
    process.exit(1);
  });