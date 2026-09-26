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
  const terms=input.toLowerCase().split(/\W+/).filter(x=>x.length>3).slice(0,12);
  const score=(text)=>terms.reduce((n,t)=>n+(text.toLowerCase().includes(t)?1:0),0);
  const memories=memory.filter(x=>x.staffId===staffId||x.scope==='shared').map(x=>({...x,_score:score(x.content)})).filter(x=>x._score>0).sort((a,b)=>b._score-a._score).slice(0,5);
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
    memory:context.memories.map(x=>({content:x.content,scope:x.scope,createdAt:x.createdAt})),
    knowledge:context.knowledge.map(x=>({title:x.title,content:x.content,createdAt:x.createdAt})),
    instruction:'Answer the staff member directly and clearly. Use supplied memory and knowledge when relevant. Do not expose internal pipeline, credentials, hidden system details, or raw JSON unless the user asks for technical output.'
  };

  const r=await fetch(NOETICA_URL+'/api/v1/intelligence',{
    method:'POST',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+NOETICA_API_KEY},
    body:JSON.stringify({input,context:{...coreContext,memoryKey:session.staffId}})
  });
  const data=await r.json().catch(()=>({error:'Invalid NOETICA response.'}));
  if(!r.ok){
    record(session,'INTELLIGENCE_ERROR','noetica_response_error',{status:r.status});
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
    const coreResult=result.noetica?.result;
    const passed=Boolean(
      result.success &&
      result.response &&
      coreResult &&
      coreResult.status==='completed'
    );
    return res.status(passed?200:502).json({
      passed,
      test:'KIA → NOETICA → Krative Core',
      response:result.response,
      intent:result.intent,
      noetica:{success:result.noetica?.success,status:coreResult?.status,stage:coreResult?.stage},
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
app.get('/api/audit',requireAuth,(req,res)=>res.json({items:audit}));

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
initDatabase()
  .then(loadUsers)
  .then(loadPersistentState)
  .then(()=>{
    app.listen(PORT,'0.0.0.0',()=>console.log('KIA listening on '+PORT));
  })
  .catch(error=>{
    console.error('KIA database initialization failed:',error);
    process.exit(1);
  });