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
const GOOGLE_TOKEN_ENCRYPTION_KEY = process.env.KIA_GOOGLE_TOKEN_ENCRYPTION_KEY || '';
const GOOGLE_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/meetings.space.readonly',
  'https://www.googleapis.com/auth/meetings.space.created'
];
const googleStates = new Map();

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL or KRANOVA_DATABASE_URL must be configured for persistent KIA accounts.');
}

const { Pool } = require('pg');
const { PDFParse } = require('pdf-parse');
const mammoth = require('mammoth');
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(express.json({limit:'15mb'}));
app.use(express.static(path.join(__dirname,'public')));

const sessions = new Map();
const memory = [];
const audit = [];
const users = new Map();

const KIA_DEPARTMENTS = [
  'Technology & Engineering',
  'Intelligence & Research',
  'Product & Innovation',
  'Design & Creative',
  'Business & Operations',
  'Marketing & Communications',
  'Human Intelligence Network (HIN)',
  'Administration'
];

const knowledge = [];
const {buildKnowledgeExcerpt}=require('./knowledge/context');
const notifications=[];
function canManageKnowledge(s){return s?.role==='admin'||s?.role==='department_head';}
function profilePassword(){return crypto.randomBytes(9).toString('base64url')+'-'+crypto.randomBytes(3).toString('hex');}
async function notifyStaff(staffId,type,title,message){const item={id:crypto.randomUUID(),staffId,type,title,message,read:false,createdAt:new Date().toISOString()};notifications.unshift(item);if(notifications.length>1000)notifications.pop();await pool.query('INSERT INTO kia_notifications (id,staff_id,type,title,message,read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[item.id,item.staffId,item.type,item.title,item.message,item.read,item.createdAt]);return item;}
function publicProfile(u){return {id:u.id,name:u.name,email:u.email,phone:u.phone,department:u.department,staffId:u.staffId,role:u.role,status:u.status,createdAt:u.createdAt,approvedAt:u.approvedAt||null};}

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

async function generateStaffId(){
  while(true){
    const {rows}=await pool.query("SELECT nextval('kia_staff_id_seq') AS sequence_number");
    const sequenceNumber=Number(rows[0].sequence_number);
    const staffId=`KT-${new Date().getUTCFullYear()}-${String(sequenceNumber).padStart(4,'0')}`;
    const existing=await pool.query('SELECT 1 FROM kia_users WHERE staff_id=$1 LIMIT 1',[staffId]);
    if(!existing.rows[0]) return staffId;
  }
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
      staff_id TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_at TIMESTAMPTZ,
      profile_password_hash TEXT
    )
  `);
  await pool.query("ALTER TABLE kia_users ALTER COLUMN staff_id DROP NOT NULL");
  await pool.query("ALTER TABLE kia_users ADD COLUMN IF NOT EXISTS profile_password_hash TEXT");
  await pool.query("CREATE SEQUENCE IF NOT EXISTS kia_staff_id_seq");
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
      status TEXT NOT NULL DEFAULT 'approved',
      created_by TEXT,
      approved_by TEXT,
      approved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE kia_knowledge ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'");
  await pool.query("ALTER TABLE kia_knowledge ADD COLUMN IF NOT EXISTS created_by TEXT");
  await pool.query("ALTER TABLE kia_knowledge ADD COLUMN IF NOT EXISTS approved_by TEXT");
  await pool.query("ALTER TABLE kia_knowledge ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_documents (
      id UUID PRIMARY KEY,
      staff_id TEXT NOT NULL,
      title TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS kia_google_connections (
      staff_id TEXT PRIMARY KEY,
      google_sub TEXT NOT NULL,
      email TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      granted_scopes TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_notifications (
      id UUID PRIMARY KEY,
      staff_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT FALSE,
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_hin_profiles (
      id UUID PRIMARY KEY,
      staff_id TEXT NOT NULL UNIQUE,
      expertise TEXT NOT NULL DEFAULT '',
      interests TEXT NOT NULL DEFAULT '',
      availability TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kia_projects (
      id UUID PRIMARY KEY,
      staff_id TEXT NOT NULL,
      name TEXT NOT NULL,
      objective TEXT NOT NULL DEFAULT '',
      context TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadUsers(){
  users.clear();
  const {rows}=await pool.query('SELECT * FROM kia_users ORDER BY created_at DESC');
  for(const u of rows){
    users.set(u.id,{
      id:u.id,name:u.name,email:u.email,phone:u.phone,department:u.department,
      staffId:u.staff_id,passwordHash:u.password_hash,role:u.role,status:u.status,profilePasswordHash:u.profile_password_hash||null,
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
  notifications.length=0;
  const notificationResult=await pool.query('SELECT * FROM kia_notifications ORDER BY created_at DESC LIMIT 1000');
  for(const n of notificationResult.rows)notifications.push({id:n.id,staffId:n.staff_id,type:n.type,title:n.title,message:n.message,read:n.read,createdAt:n.created_at.toISOString()});
  memory.length=0;
  const memoryResult=await pool.query('SELECT * FROM kia_memory ORDER BY created_at DESC LIMIT 1000');
  for(const m of memoryResult.rows) memory.push({id:m.id,staffId:m.staff_id,scope:m.scope,content:m.content,createdAt:m.created_at.toISOString()});
  if(process.env.KIA_KNOWLEDGE_RESET_ONCE==='true'){
    await pool.query('DELETE FROM kia_knowledge');
    console.log('KIA knowledge root reset: all existing root knowledge cleared.');
  }
  knowledge.length=0;
  const knowledgeResult=await pool.query('SELECT * FROM kia_knowledge ORDER BY created_at DESC');
  for(const k of knowledgeResult.rows) knowledge.push({id:k.id,title:k.title,content:k.content,status:k.status||'approved',createdBy:k.created_by||null,approvedBy:k.approved_by||null,approvedAt:k.approved_at?k.approved_at.toISOString():null,createdAt:k.created_at.toISOString()});
  const documentResult=await pool.query('SELECT * FROM kia_documents ORDER BY created_at DESC LIMIT 200');
  for(const d of documentResult.rows) knowledge.push({id:'document:'+d.id,type:'document',staffId:d.staff_id,scope:'private',title:d.title,content:d.content,createdAt:d.created_at.toISOString()});
  const masterKnowledge=require('./knowledge/krativeT3chFresh');
  const masterCreatedAt=new Date().toISOString();
  await pool.query(
    'INSERT INTO kia_knowledge (id,title,content,status,approved_at,created_at) VALUES ($1,$2,$3,$4,NOW(),$5) ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title,content=EXCLUDED.content,status=\'approved\',approved_at=NOW()',
    [masterKnowledge.id,masterKnowledge.title,masterKnowledge.content,'approved',masterCreatedAt]
  );
  const existingMaster=knowledge.find(x=>x.id===masterKnowledge.id);
  if(existingMaster){
    existingMaster.title=masterKnowledge.title;
    existingMaster.content=masterKnowledge.content;
  }else{
    knowledge.unshift({id:masterKnowledge.id,title:masterKnowledge.title,content:masterKnowledge.content,createdAt:masterCreatedAt});
  }
  const defaultPlugins=[
    ['intelligence','KIA Intelligence','Route requests through NOETICA Intelligence and Krative Core.','intelligence'],['memory','KIA Memory','Store and retrieve staff-scoped KIA memory.','productivity'],['knowledge','KIA Knowledge','Read and write the persistent KIA knowledge store.','knowledge'],['audit','KIA Audit','Record and inspect protected KIA activity.','security'],['openai','OpenAI / ChatGPT','Use OpenAI models through the configured OpenAI API connection.','ai'],['claude','Claude','Use Anthropic Claude models through the configured Anthropic API connection.','ai'],['github','GitHub','Read and manage authorized GitHub repositories, issues and pull requests.','development'],['supabase','Supabase','Access authorized Supabase projects and database APIs.','backend'],['gmail','Gmail','Connect approved staff Gmail accounts through Google OAuth.','productivity'],['google-calendar','Google Calendar','Connect approved staff calendars through Google OAuth.','productivity'],['google-drive','Google Drive','Connect approved staff Drive files through Google OAuth.','productivity'],['gemini','Gemini','Use Google Gemini models through the configured Google AI API connection.','ai'],['slack','Slack','Connect authorized Slack workspaces for staff collaboration.','collaboration'],['render','Render','Inspect and operate authorized Render services through the configured Render API connection.','infrastructure'],['google-meet','Google Meet','Create and inspect Google Meet spaces for approved staff through Google OAuth.','productivity']
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
      (id,name,email,phone,department,staff_id,password_hash,role,status,created_at,approved_at,profile_password_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name,email=EXCLUDED.email,phone=EXCLUDED.phone,
      department=EXCLUDED.department,staff_id=EXCLUDED.staff_id,
      password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,
      status=EXCLUDED.status,approved_at=EXCLUDED.approved_at,profile_password_hash=EXCLUDED.profile_password_hash`,
    [u.id,u.name,u.email,u.phone,u.department,u.staffId,u.passwordHash,u.role,u.status,u.createdAt,u.approvedAt||null,u.profilePasswordHash||null]
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

function googleCryptoKey(){
  if(!GOOGLE_TOKEN_ENCRYPTION_KEY) throw new Error('KIA_GOOGLE_TOKEN_ENCRYPTION_KEY is not configured.');
  return crypto.createHash('sha256').update(GOOGLE_TOKEN_ENCRYPTION_KEY).digest();
}
function encryptGoogleToken(value){
  const iv=crypto.randomBytes(12); const cipher=crypto.createCipheriv('aes-256-gcm',googleCryptoKey(),iv);
  const encrypted=Buffer.concat([cipher.update(String(value),'utf8'),cipher.final()]);
  return [iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
function decryptGoogleToken(value){
  const [ivRaw,tagRaw,dataRaw]=String(value||'').split('.');
  if(!ivRaw||!tagRaw||!dataRaw) throw new Error('Invalid encrypted Google token.');
  const decipher=crypto.createDecipheriv('aes-256-gcm',googleCryptoKey(),Buffer.from(ivRaw,'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw,'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw,'base64url')),decipher.final()]).toString('utf8');
}
async function saveGoogleConnection(staffId,googleSub,email,refreshToken,grantedScopes){
  if(!refreshToken) throw new Error('Google did not return a refresh token. Re-authorize Google access with consent.');
  const encrypted=encryptGoogleToken(refreshToken);
  await pool.query(
    `INSERT INTO kia_google_connections (staff_id,google_sub,email,refresh_token_enc,granted_scopes,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
     ON CONFLICT (staff_id) DO UPDATE SET google_sub=EXCLUDED.google_sub,email=EXCLUDED.email,refresh_token_enc=EXCLUDED.refresh_token_enc,granted_scopes=EXCLUDED.granted_scopes,updated_at=NOW()`,
    [staffId,googleSub,email,encrypted,String(grantedScopes||'')]
  );
}
async function getGoogleConnection(staffId){
  const {rows}=await pool.query('SELECT * FROM kia_google_connections WHERE staff_id=$1',[staffId]);
  return rows[0]||null;
}
async function getGoogleAccessToken(staffId){
  const connection=await getGoogleConnection(staffId);
  if(!connection) throw Object.assign(new Error('Google is not connected for this KIA account.'),{statusCode:409});
  const refreshToken=decryptGoogleToken(connection.refresh_token_enc);
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token) throw Object.assign(new Error(data.error_description||'Google access token refresh failed.'),{statusCode:502});
  return {accessToken:data.access_token,connection};
}
function googleApiHeaders(accessToken){return {Authorization:'Bearer '+accessToken,Accept:'application/json'}}

async function createGoogleSession(user,res){
  const t=token();
  const session={staffId:user.staffId,userId:user.id,role:user.role,profileUnlocked:false,createdAt:new Date().toISOString()};
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
    include_granted_scopes:'true',
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
    const grantedScopes=String(tokenData.scope||GOOGLE_SCOPES.join(' '));
    const stateConnector=entry.connector==='google';
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
    if(stateConnector){
      const refreshToken=tokenData.refresh_token;
      const existing=await getGoogleConnection(user.staffId);
      await saveGoogleConnection(user.staffId,String(profile.sub),email,refreshToken|| (existing?decryptGoogleToken(existing.refresh_token_enc):''),grantedScopes);
      record({staffId:user.staffId},'CONNECTOR_ACTION','google_connected',{email,scopes:grantedScopes.split(' ').filter(Boolean)});
      return res.redirect('/?google_connected=1');
    }
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
    const s={staffId:'admin',role:'admin',profileUnlocked:false,createdAt:new Date().toISOString()};
    sessions.set(t,s);
    await saveSession(t,s);
    record(s,'AUTH_LOGIN','admin_login');
    return res.json({token:t,staff:s});
  }

  if(!ACCESS_CODE) return res.status(503).json({error:'KIA access is not configured.'});
  if(typeof accessCode!=='string'||accessCode!==ACCESS_CODE) return res.status(401).json({error:'Invalid staff access code.'});

  const t=token();
  const s={staffId:staffId||'staff',role:'staff',profileUnlocked:false,createdAt:new Date().toISOString()};
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
    const password=typeof req.body?.password==='string'?req.body.password:'';

    if(!name||!email||!phone||!department||!password)
      return res.status(400).json({error:'Name, email, phone, department and password are required.'});
    if(!/^\S+@\S+\.\S+$/.test(email))
      return res.status(400).json({error:'Enter a valid email address.'});
    if(!KIA_DEPARTMENTS.includes(department))
      return res.status(400).json({error:'Select a valid Krative T3ch department.'});
    if(password.length<8)
      return res.status(400).json({error:'Password must be at least 8 characters.'});

    const duplicate=[...users.values()].find(u=>u.email===email);
    if(duplicate) return res.status(409).json({error:'An account with that email already exists.'});

    const user={
      id:crypto.randomUUID(),
      name,email,phone,department,staffId:null,
      passwordHash:await hashPassword(password),
      role:'staff',
      status:'pending',
      createdAt:new Date().toISOString()
    };
    try{
      await saveUser(user);
    }catch(error){
      if(error?.code==='23505'){
        const existing=[...users.values()].find(u=>u.email===email);
        if(existing) return res.status(409).json({error:'An account with that email already exists.'});
      }
      console.error('KIA signup persistence failed:',error.message);
      return res.status(500).json({error:'Unable to create the account. Please try again.'});
    }
    users.set(user.id,user);
    record({staffId:'public-signup'},'AUTH_SIGNUP','staff_signup',{userId:user.id,email,department});
    res.status(201).json({
      success:true,
      message:'Registration submitted. Your account is pending administrator approval. Your Krative T3ch staff ID will be generated after approval.',
      user:publicUser(user)
    });
  }catch(error){
    console.error('KIA signup failed:',error.message);
    res.status(500).json({error:'Unable to create the account. Please try again.'});
  }
});

app.post('/api/account-login',async(req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase();
    const password=typeof req.body?.password==='string'?req.body.password:'';
    if(!email||!password) return res.status(400).json({error:'Email and password are required.'});
    const user=[...users.values()].find(u=>u.email===email);

    if(!user||!(await verifyPassword(password,user.passwordHash)))
      return res.status(401).json({error:'Invalid email or password.'});
    if(user.status==='pending') return res.status(403).json({error:'Your account is pending administrator approval. You can log in after an administrator approves it.'});
    if(user.status==='rejected') return res.status(403).json({error:'Your registration was not approved.'});
    if(user.status==='suspended') return res.status(403).json({error:'Your KIA account is suspended. Please contact an administrator.'});
    if(!user.staffId) return res.status(403).json({error:'Your account is approved, but your staff ID has not been issued yet. Please contact an administrator.'});

    const t=token();
    const s={staffId:user.staffId,userId:user.id,role:user.role,profileUnlocked:false,createdAt:new Date().toISOString()};
    sessions.set(t,s);
    await saveSession(t,s);
    record(s,'AUTH_LOGIN','account_login',{userId:user.id});
    res.json({token:t,staff:{...s,name:user.name,email:user.email,department:user.department}});
  }catch(error){
    console.error('KIA account login failed:',error.message);
    res.status(500).json({error:'Unable to complete login. Please try again.'});
  }
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
    return res.json({staff:{...req.session,...(u?publicProfile(u):{})}});
  }
  res.json({staff:req.session});
});

app.get('/api/status',requireAuth,async(req,res)=>{
  const core={configured:Boolean(CORE_API_KEY),reachable:false,status:null,error:null};
  if(core.configured){const check=await checkKiaDependency(CORE_URL+'/health',3,15000);core.reachable=check.reachable;core.status=check.status||null;core.error=check.error||null;}
  res.json({service:'KIA',core,noetica:{configured:Boolean(NOETICA_API_KEY),baseUrl:NOETICA_URL},capabilities:['intelligence','knowledge','memory','reasoning','decision','execution','learning','audit','notifications','profiles'],authentication:{signup:true,approval:true,role:req.session.role},knowledgeAccess:canManageKnowledge(req.session)});
});

app.get('/api/admin/metrics',requireAuth,requireAdmin,async(req,res)=>{
  const list=[...users.values()],recent=Date.now()-86400000;
  res.json({metrics:{totalStaff:list.length,approved:list.filter(x=>x.status==='approved').length,pending:list.filter(x=>x.status==='pending').length,rejected:list.filter(x=>x.status==='rejected').length,suspended:list.filter(x=>x.status==='suspended').length,departmentHeads:list.filter(x=>x.role==='department_head').length,activeSessions:sessions.size,auditLast24h:audit.filter(x=>new Date(x.createdAt).getTime()>=recent).length,coreConfigured:Boolean(CORE_API_KEY),noeticaConfigured:Boolean(NOETICA_API_KEY)}});
});
app.get('/api/admin/knowledge',requireAuth,requireAdmin,(req,res)=>res.json({items:knowledge.filter(x=>x.status==='pending')}));
app.post('/api/admin/knowledge/:id/approve',requireAuth,requireAdmin,async(req,res)=>{
  const item=knowledge.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Knowledge item not found.'});
  item.status='approved';item.approvedBy=req.session.staffId;item.approvedAt=new Date().toISOString();
  await pool.query('UPDATE kia_knowledge SET status=$1,approved_by=$2,approved_at=$3 WHERE id=$4',[item.status,item.approvedBy,item.approvedAt,item.id]);
  record(req.session,'KNOWLEDGE_APPROVAL','approve_knowledge',{knowledgeId:item.id});
  if(item.createdBy)await notifyStaff(item.createdBy,'knowledge','Knowledge approved','Your knowledge item is now active in KIA.');
  res.json({success:true,item});
});
app.post('/api/admin/knowledge/:id/reject',requireAuth,requireAdmin,async(req,res)=>{
  const item=knowledge.find(x=>x.id===req.params.id);if(!item)return res.status(404).json({error:'Knowledge item not found.'});
  item.status='rejected';await pool.query('UPDATE kia_knowledge SET status=$1 WHERE id=$2',['rejected',item.id]);
  record(req.session,'KNOWLEDGE_APPROVAL','reject_knowledge',{knowledgeId:item.id});
  if(item.createdBy)await notifyStaff(item.createdBy,'knowledge','Knowledge rejected','Your knowledge item was not approved.');
  res.json({success:true,item});
});
app.post('/api/admin/users/:id/status',requireAuth,requireAdmin,async(req,res)=>{
  const u=users.get(req.params.id);if(!u)return res.status(404).json({error:'User not found.'});
  const status=String(req.body?.status||'').trim();if(!['approved','suspended','rejected'].includes(status))return res.status(400).json({error:'Invalid staff status.'});
  if(status==='approved'&&!u.staffId)u.staffId=await generateStaffId();u.status=status;if(status==='approved')u.approvedAt=u.approvedAt||new Date().toISOString();
  await saveUser(u);record(req.session,'STAFF_STATUS','change_staff_status',{userId:u.id,status});
  if(u.staffId)await notifyStaff(u.staffId,'account','Account status updated','Your KIA account status is now '+status+'.');
  res.json({success:true,user:publicUser(u)});
});
app.post('/api/admin/users/:id/role',requireAuth,requireAdmin,async(req,res)=>{
  const u=users.get(req.params.id);if(!u)return res.status(404).json({error:'User not found.'});
  const role=String(req.body?.role||'').trim();if(!['staff','department_head'].includes(role))return res.status(400).json({error:'Only staff and department head roles can be assigned.'});
  if(u.status!=='approved')return res.status(409).json({error:'Approve the account before assigning a department head role.'});
  u.role=role;await saveUser(u);record(req.session,'ROLE_CHANGE','change_staff_role',{userId:u.id,role});
  if(u.staffId)await notifyStaff(u.staffId,'account','Role updated','Your KIA role is now '+role.replace('_',' ')+'.');
  res.json({success:true,user:publicUser(u)});
});
app.post('/api/admin/users/:id/reset-profile-password',requireAuth,requireAdmin,async(req,res)=>{const u=users.get(req.params.id);if(!u)return res.status(404).json({error:'User not found.'});const generated=profilePassword();u.profilePasswordHash=await hashPassword(generated);await saveUser(u);record(req.session,'PROFILE_SECURITY','admin_reset_profile_password',{userId:u.id});if(u.staffId)await notifyStaff(u.staffId,'security','Profile password reset','An administrator generated a new profile password for your account.');res.json({success:true,generatedPassword:generated});});
app.post('/api/admin/notify',requireAuth,requireAdmin,async(req,res)=>{
  const type=String(req.body?.type||'admin').trim().slice(0,40),title=String(req.body?.title||'').trim().slice(0,160),message=String(req.body?.message||'').trim().slice(0,1000),target=String(req.body?.target||'all').trim();
  if(!title||!message)return res.status(400).json({error:'Title and message are required.'});
  const recipients=[...users.values()].filter(u=>u.staffId&&u.status==='approved'&&(target==='all'||u.department===target));
  for(const u of recipients)await notifyStaff(u.staffId,type,title,message);
  record(req.session,'NOTIFICATION_ADMIN','broadcast_notification',{target,recipientCount:recipients.length});
  res.json({success:true,recipientCount:recipients.length});
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
  if(!u.staffId) u.staffId=await generateStaffId();
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
function requiresWebSearch(input){
  const text=String(input||'').toLowerCase();
  return /\b(today|tonight|tomorrow|yesterday|latest|recent|currently|current|now|this week|this month|this year|breaking|news|price|prices|exchange rate|weather|forecast|stock|stocks|election|poll|schedule|score|results|release date|as of|look up|search the web|search online|verify online|check online)\b/.test(text);
}
function normalizeDocumentText(value){
  return String(value||'').replace(/\\r\\n/g,'\\n').replace(/[\\t ]+/g,' ').replace(/\\n{3,}/g,'\\n\\n').trim().slice(0,150000);
}
function documentSearch(staffId,input){
  const terms=String(input||'').toLowerCase().split(/\\W+/).filter(x=>x.length>3).slice(0,12);
  return knowledge
    .filter(x=>x.type==='document' && (x.staffId===staffId || x.scope==='shared'))
    .map(x=>({x,score:terms.reduce((n,t)=>n+(x.content.toLowerCase().includes(t)?1:0),0)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,5)
    .map(x=>x.x);
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
  const knowledgeHits=knowledge.filter(x=>x.type==='document'||x.status==='approved').map(x=>({...x,_score:score(x.title+' '+x.content)})).filter(x=>x._score>0).sort((a,b)=>b._score-a._score).slice(0,5);
  const companyQuery=/\b(krative|krative t3ch|our company|our products|our architecture|our system|our brand|noetica|krative core|kif|uis|hin|klgi)\b/i.test(normalized);
  const master=knowledge.find(x=>x.id==='krative-t3ch-master');
  if(companyQuery && master && !knowledgeHits.some(x=>x.id===master.id)){
    knowledgeHits.unshift({...master,_score:999});
  }
  return {memories,knowledge:knowledgeHits.slice(0,6)};
}
function isCleanKiaAnswer(value,input){
  const text=typeof value==='string'?value.trim():'';
  if(!text) return false;

  const prompt=String(input||'');
  const oneSentence=/\bone sentence\b/i.test(prompt);

  // Never surface a retrieved knowledge document as the final answer.
  if(text.length>5000) return false;
  if(/^\s*#{1,6}\s/m.test(text) || /^\s*[-*]\s/m.test(text)) return false;
  if(/\bthis is the authoritative company knowledge source for kia\b/i.test(text)) return false;

  if(oneSentence){
    if(text.length>600) return false;
    const sentences=text.split(/[.!?]+(?:\s|$)/).map(x=>x.trim()).filter(Boolean);
    if(sentences.length>2) return false;
  }

  return true;
}

function buildKiaResponse(data,input=''){
  const result=data&&data.result!==undefined?data.result:data;
  if(typeof result==='string') return result.trim();
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

  // NOETICA's structured response is authoritative. Prefer its message
  // before generic fields that may contain raw Core/context payloads.
  const preferred=[
    response?.message,
    response?.answer,
    response?.content,
    result.answer,
    intelligence?.answer,
    result.output,
    result.message,
    result.text,
    result.content
  ];

  const clean=preferred.find(x=>isCleanKiaAnswer(x,input));
  if(clean) return clean.trim();

  const fallback=preferred.find(x=>typeof x==='string'&&x.trim());
  if(fallback) return fallback.trim();

  return 'I received no usable intelligence result.';
}

async function checkKiaDependency(url,retries=3,timeoutMs=15000){
  let lastError=null;
  for(let attempt=0;attempt<retries;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const response=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json'}});
      const contentType=(response.headers.get('content-type')||'').toLowerCase();
      const raw=await response.text();
      let payload=null;
      if(raw.trim() && contentType.includes('application/json')){
        try{payload=JSON.parse(raw);}catch(error){lastError=new Error('Invalid JSON from dependency health endpoint.');}
      }else if(raw.trim()){
        lastError=new Error('Dependency health returned non-JSON HTTP '+response.status+' content-type='+contentType+'.');
      }

      if(payload && typeof payload==='object'){
        const serviceOk=payload.status==='ok';
        const liveOk=payload.live===true;
        const reachable=Boolean(serviceOk||liveOk);
        return {
          reachable,
          status:response.status,
          contentType,
          payload,
          error:reachable?null:(payload.error||payload.code||'Dependency health is degraded.')
        };
      }

      if(response.status>=200 && response.status<300 && !raw.trim()){
        lastError=new Error('Dependency health returned an empty response.');
      }else if(response.status>=500 && attempt<retries-1){
        lastError=new Error('Dependency health returned HTTP '+response.status+'.');
      }else{
        lastError=lastError||new Error('Dependency health returned HTTP '+response.status+'.');
      }
    }catch(error){
      lastError=error;
    }finally{clearTimeout(timer);}
    if(attempt<retries-1) await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));
  }
  return {reachable:false,error:lastError?.message||'unreachable'};
}
async function warmKiaIntelligenceDependencies(){
  const results=await Promise.all([
    checkKiaDependency(CORE_URL+'/health/live',2,8000),
    checkKiaDependency(NOETICA_URL+'/health/live',2,8000)
  ]);
  return {core:results[0],noetica:results[1]};
}
async function runKiaIntelligence(input, session){
  if(!input) throw Object.assign(new Error('Input is required.'),{statusCode:400});
  if(!CORE_API_KEY) throw Object.assign(new Error('Krative Core API key is not configured on KIA.'),{statusCode:503});

  const intent=classifyInput(input);
  const context=retrieveContext(session.staffId,input);
  const documentMatches=documentSearch(session.staffId,input);
  if(documentMatches.length){
    context.knowledge=[...documentMatches,...context.knowledge].slice(0,8);
  }
  record(session,'INTELLIGENCE_REQUEST','understand_input',{length:input.length,intent});
  record(session,'INTELLIGENCE_ROUTE','route_request',{route:'noetica',intent,memoryMatches:context.memories.length,knowledgeMatches:context.knowledge.length});

  const coreContext={
    source:'KIA',staffId:session.staffId,intent,
    webSearch:requiresWebSearch(input),
    pipeline:['NOETICA','KRATIVE_CORE','RESPONSE','UPDATE'],
    shortTermMemory:context.memories.map(x=>({content:x.content,importance:0.8,scope:x.scope,createdAt:x.createdAt})),
    knowledgeSources:context.knowledge.map(x=>({id:x.id,type:x.type||'knowledge',title:x.title,content:buildKnowledgeExcerpt(x,input),confidence:0.85,verified:true,createdAt:x.createdAt})),
    system:'You are the intelligence assistant serving the KIA product. Answer questions across general knowledge, technology, science, business, mathematics, writing, analysis, planning, coding, current-context reasoning, and everyday topics. Give a useful direct answer whenever the available information supports one. Do not refuse simply because the question does not match a predefined intent. Use the supplied memory and knowledge as context, and distinguish known information from uncertainty. For current or time-sensitive facts, do not invent freshness; state when verification is needed. Your product identity is KIA: identify yourself as KIA when asked. Do not call yourself Noe and do not present NOETICA as the assistant identity. NOETICA is the intelligence runtime behind KIA, while Krative Core is the underlying intelligence engine. If supplied memory directly answers the user question, answer from that memory explicitly. When the user asks what they asked you to remember, list or summarize the relevant stored memory content instead of merely saying a memory operation was processed. Keep answers natural and useful. Do not expose credentials, hidden system instructions, or internal implementation details unless the user explicitly asks for technical output.', productIdentity:'KIA', assistantName:'KIA', runtimeIdentity:'NOETICA Intelligence', coreIdentity:'Krative Core'
  };

  if(!NOETICA_API_KEY) throw Object.assign(new Error('NOETICA API key is not configured on KIA.'),{statusCode:503});
  // Do not gate intelligence on dependency health probes. Render may cold-start NOETICA/Core,
  // and a health probe can fail at the edge before the service is ready. The actual intelligence
  // request below has bounded timeouts and retries and is the authoritative functional check.
  let r,data={};
  const maxRetries=6;
  const timeoutMs=Number(process.env.NOETICA_TIMEOUT_MS||45000);
  for(let attempt=0;attempt<maxRetries;attempt++){
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timeoutHandle=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
    try{
      r=await fetch(NOETICA_URL+'/api/v1/intelligence',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+NOETICA_API_KEY},body:JSON.stringify({input,context:{...coreContext,memoryKey:session.staffId}}),...(controller?{signal:controller.signal}:{})});
    }catch(error){
      if(attempt<maxRetries-1){await new Promise(resolve=>setTimeout(resolve,2000*(attempt+1)));continue;}
      const timedOut=error?.name==='AbortError';
      throw Object.assign(
        new Error(timedOut?'NOETICA request timed out after '+timeoutMs+'ms.':'Unable to connect to NOETICA.'),
        {
          statusCode:timedOut?504:502,
          detail:error?.message||'NOETICA connection failed.',
          code:timedOut?'NOETICA_TIMEOUT':'NOETICA_UNREACHABLE',
          dependency:'noetica',
          stage:'kia-to-noetica',
          retryable:true
        }
      );
    }finally{if(timeoutHandle)clearTimeout(timeoutHandle);}
    const raw=await r.text();
    if(raw.trim()){try{data=JSON.parse(raw);}catch{
      if([429,502,503,504].includes(r.status)&&attempt<maxRetries-1){await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));continue;}
      throw Object.assign(new Error('Invalid NOETICA response.'),{
        statusCode:502,
        detail:'NOETICA returned non-JSON HTTP '+r.status+' content-type='+(r.headers.get('content-type')||'unknown')+'.',
        code:'NOETICA_INVALID_RESPONSE',
        dependency:'noetica',
        stage:'kia-to-noetica',
        retryable:[429,502,503,504].includes(r.status)
      });
    }}
    if([429,502,503,504].includes(r.status)&&attempt<maxRetries-1){await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));continue;}
    break;
  }
  if(!r?.ok){
    record(session,'INTELLIGENCE_ERROR','noetica_response_error',{status:r?.status||0});
    const message=data?.error||data?.message||data?.result?.response?.message||'NOETICA request failed.';
    const statusCode=r?.status||502;
    throw Object.assign(new Error(message),{
      statusCode,
      detail:data?.error||data?.message||data?.result?.response?.message||r?.statusText||'NOETICA request failed.',
      code:data?.code||('NOETICA_HTTP_'+statusCode),
      retryable:[429,502,503,504].includes(statusCode),
      dependency:'noetica',
      stage:'kia-to-noetica'
    });
  }

  const response=buildKiaResponse(data,input);
  record(session,'INTELLIGENCE_RESPONSE','noetica_response',{
    status:r.status,intent,
    usedMemory:context.memories.length,
    usedKnowledge:context.knowledge.length,
    route:'NOETICA→Krative Core'
  });
  return {success:true,response,intent,context:{memoryMatches:context.memories.length,knowledgeMatches:context.knowledge.length},noetica:data};
}

app.post('/api/test/e2e',async(req,res)=>{
  if(!E2E_TEST_TOKEN) return res.status(503).json({error:'KIA E2E test token is not configured.'});
  const supplied=String(req.headers['x-kia-e2e-token']||'');
  if(!supplied || supplied.length!==E2E_TEST_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(supplied),Buffer.from(E2E_TEST_TOKEN))) return res.status(401).json({error:'Unauthorized E2E test request.'});
  const session={staffId:'e2e-test',role:'test',createdAt:new Date().toISOString()};
  try{
    const result=await runKiaIntelligence('KIA live integration test: explain in one sentence what Krative Core does.',session);
    const noeticaResult=result?.noetica?.result;
    const coreState=noeticaResult?.core?.state;
    const passed=Boolean(result?.success&&result?.response&&noeticaResult?.status==='completed'&&coreState?.status==='completed'&&coreState?.stage==='EXECUTION'&&coreState?.kif?.status==='fused');
    res.status(passed?200:502).json({passed,success:result?.success===true,response:result?.response||null,noeticaStatus:noeticaResult?.status||null,coreStatus:coreState?.status||null,coreStage:coreState?.stage||null,kifStatus:coreState?.kif?.status||null,kifSourceCount:coreState?.kif?.sourceCount||null});
  }catch(error){
    console.error('KIA E2E test failed:',error);
    res.status(error.statusCode||502).json({passed:false,error:error.message,detail:error.detail||null,code:error.code||'KIA_E2E_FAILED',dependency:error.dependency||null,stage:error.stage||null});
  }
});

async function runConfiguredPluginSmokeTests(){
  const input='KIA plugin smoke test: reply with OK.';
  const tests=[];
  const run=async(id,fn)=>{
    const started=Date.now();
    try{const output=await fn();tests.push({id,status:'passed',detail:output||'ok',ms:Date.now()-started});}
    catch(error){tests.push({id,status:'failed',detail:error.message,ms:Date.now()-started});}
  };
  if(process.env.OPENAI_API_KEY) await run('openai',async()=>{
    const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.KIA_OPENAI_PLUGIN_MODEL||'gpt-5.6-luna',input})});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error?.message||'HTTP '+r.status); return d.output_text?'response received':'no output text';
  });
  if(process.env.ANTHROPIC_API_KEY) await run('claude',async()=>{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','Content-Type':'application/json'},body:JSON.stringify({model:process.env.KIA_CLAUDE_PLUGIN_MODEL||'claude-sonnet-5',max_tokens:32,messages:[{role:'user',content:input}]})});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error?.message||'HTTP '+r.status); return Array.isArray(d.content)?'response received':'no content';
  });
  if(process.env.GITHUB_TOKEN) await run('github',async()=>{
    const r=await fetch('https://api.github.com/user',{headers:{Authorization:'Bearer '+process.env.GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'KIA-Krative-T3ch'}});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.message||'HTTP '+r.status); return 'authenticated as '+(d.login||'user');
  });
  if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY) await run('supabase',async()=>{
    const base=process.env.SUPABASE_URL.replace(/\/$/,''); const r=await fetch(base+'/rest/v1/',{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY}});
    if(!r.ok) throw new Error('HTTP '+r.status); return 'REST API reachable';
  });
  if(process.env.GEMINI_API_KEY) await run('gemini',async()=>{
    const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+encodeURIComponent(process.env.GEMINI_API_KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:input}]}]})});
    const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error(d.error?.message||'HTTP '+r.status); return d.candidates?.length?'response received':'no candidates';
  });
  if(process.env.SLACK_BOT_TOKEN) await run('slack',async()=>{
    const r=await fetch('https://slack.com/api/auth.test',{headers:{Authorization:'Bearer '+process.env.SLACK_BOT_TOKEN}});
    const d=await r.json().catch(()=>({})); if(!r.ok||!d.ok) throw new Error(d.error||'HTTP '+r.status); return 'authenticated as '+(d.user_id||'bot');
  });
  if(process.env.RENDER_API_KEY) await run('render',async()=>{
    const r=await fetch('https://api.render.com/v1/services?limit=1',{headers:{Authorization:'Bearer '+process.env.RENDER_API_KEY,'Accept':'application/json'}});
    if(!r.ok) throw new Error('HTTP '+r.status); return 'Render API reachable';
  });
  console.log(JSON.stringify({type:'KIA_PLUGIN_SMOKE_TEST',tests,skipped:['gmail','google-calendar','google-drive'],note:'Google services require OAuth authorization.'}));
}

app.post('/api/documents',requireAuth,async(req,res)=>{
  const title=typeof req.body?.title==='string'&&req.body.title.trim()?req.body.title.trim().slice(0,200):'Untitled document';
  const mimeType=typeof req.body?.mimeType==='string'?req.body.mimeType.slice(0,120):'text/plain';
  const raw=typeof req.body?.content==='string'?req.body.content:'';
  const encoded=typeof req.body?.data==='string'?req.body.data:'';
  let content=normalizeDocumentText(raw);
  if(!content && encoded){
    let buffer;
    try{ buffer=Buffer.from(encoded,'base64'); }catch(error){ return res.status(400).json({error:'Invalid document encoding.',code:'DOCUMENT_ENCODING_INVALID'}); }
    if(buffer.length>10*1024*1024) return res.status(413).json({error:'Document is too large. Maximum size is 10 MB.',code:'DOCUMENT_TOO_LARGE'});
    try{
      if(mimeType==='application/pdf' || /\\.pdf$/i.test(title)){
        const parser=new PDFParse({data:buffer});
        const result=await parser.getText();
        content=normalizeDocumentText(result.text);
        await parser.destroy();
      }else if(mimeType==='application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\\.docx$/i.test(title)){
        const result=await mammoth.extractRawText({buffer});
        content=normalizeDocumentText(result.value);
      }else{
        content=normalizeDocumentText(buffer.toString('utf8'));
      }
    }catch(error){
      return res.status(422).json({error:'Could not extract readable text from this document.',code:'DOCUMENT_EXTRACTION_FAILED',detail:error.message});
    }
  }
  if(!content) return res.status(400).json({error:'Document content is required.',code:'DOCUMENT_CONTENT_REQUIRED'});
  if(content.length<20) return res.status(400).json({error:'Document content is too short.',code:'DOCUMENT_TOO_SHORT'});
  const id=crypto.randomUUID();
  const item={id,staffId:req.session.staffId,title,mimeType,sizeBytes:Buffer.byteLength(content,'utf8'),content,createdAt:new Date().toISOString()};
  await pool.query(
    'INSERT INTO kia_documents (id,staff_id,title,mime_type,size_bytes,content,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id,item.staffId,item.title,item.mimeType,item.sizeBytes,item.content,item.createdAt]
  );
  knowledge.push({id:'document:'+id,type:'document',staffId:item.staffId,scope:'private',title:item.title,content:item.content,createdAt:item.createdAt});
  record(req.session,'DOCUMENT_INGEST','store_document',{documentId:id,title:item.title,mimeType:item.mimeType,sizeBytes:item.sizeBytes});
  res.json({success:true,document:{id,title:item.title,mimeType:item.mimeType,sizeBytes:item.sizeBytes,createdAt:item.createdAt}});
});

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
    return res.status(status).json({
      error:status===502?'NOETICA/Core intelligence request failed.':error.message,
      intent:input?classifyInput(input):undefined,
      detail:error.detail||error.message,
      code:error.code||'INTELLIGENCE_REQUEST_FAILED',
      dependency:error.dependency||'unknown',
      stage:error.stage||'unknown',
      retryable:Boolean(error.retryable)
    });
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
    const responseText=String(result.response||'').trim();
    const requestedOneSentence=/\bone sentence\b/i.test(input);
    const sentenceCount=responseText
      .split(/[.!?]+(?:\s|$)/)
      .map(x=>x.trim())
      .filter(Boolean)
      .length;
    const responseQuality=Boolean(
      responseText &&
      responseText.length<=600 &&
      !/^\s*#{1,6}\s/m.test(responseText) &&
      !/^\s*[-*]\s/m.test(responseText) &&
      !/\bthis is the authoritative company knowledge source for kia\b/i.test(responseText) &&
      (!requestedOneSentence || sentenceCount<=2)
    );
    const passed=Boolean(
      result.success &&
      responseQuality &&
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

app.post('/api/profile/bootstrap',requireAuth,async(req,res)=>{
  const u=users.get(req.session.userId);if(!u)return res.status(404).json({error:'Account not found.'});
  if(u.profilePasswordHash)return res.json({initialized:true});
  const generated=profilePassword();u.profilePasswordHash=await hashPassword(generated);await saveUser(u);
  record(req.session,'PROFILE_SECURITY','generate_profile_password');
  res.json({initialized:false,generatedPassword:generated,message:'Save this generated profile password. It will only be shown once.'});
});
app.post('/api/profile/unlock',requireAuth,async(req,res)=>{
  const u=users.get(req.session.userId);if(!u)return res.status(404).json({error:'Account not found.'});
  const password=typeof req.body?.password==='string'?req.body.password:'';
  if(!u.profilePasswordHash)return res.status(409).json({error:'Profile security has not been initialized.'});
  if(!(await verifyPassword(password,u.profilePasswordHash)))return res.status(401).json({error:'Invalid profile password.'});
  req.session.profileUnlocked=true;record(req.session,'PROFILE_SECURITY','unlock_profile');
  res.json({success:true,profile:publicProfile(u)});
});
app.get('/api/profile',requireAuth,async(req,res)=>{
  const u=users.get(req.session.userId);if(!u)return res.status(404).json({error:'Account not found.'});
  if(!req.session.profileUnlocked)return res.status(423).json({error:'Profile is locked.'});
  res.json({profile:publicProfile(u)});
});
app.put('/api/profile',requireAuth,async(req,res)=>{
  const u=users.get(req.session.userId);if(!u)return res.status(404).json({error:'Account not found.'});
  if(!req.session.profileUnlocked)return res.status(423).json({error:'Profile is locked.'});
  const name=String(req.body?.name||u.name).trim().slice(0,120),phone=String(req.body?.phone||u.phone).trim().slice(0,40);
  if(!name||!phone)return res.status(400).json({error:'Name and phone are required.'});
  u.name=name;u.phone=phone;await saveUser(u);record(req.session,'PROFILE_UPDATE','update_profile',{fields:['name','phone']});
  res.json({success:true,profile:publicProfile(u)});
});
app.post('/api/profile/lock',requireAuth,(req,res)=>{req.session.profileUnlocked=false;record(req.session,'PROFILE_SECURITY','lock_profile');res.json({success:true});});
app.get('/api/notifications',requireAuth,(req,res)=>{const items=notifications.filter(x=>x.staffId===req.session.staffId).slice(0,100);res.json({items,unread:items.filter(x=>!x.read).length});});
app.post('/api/notifications/:id/read',requireAuth,async(req,res)=>{const item=notifications.find(x=>x.id===req.params.id&&x.staffId===req.session.staffId);if(!item)return res.status(404).json({error:'Notification not found.'});item.read=true;await pool.query('UPDATE kia_notifications SET read=TRUE WHERE id=$1',[item.id]);res.json({success:true});});
app.post('/api/notifications/read-all',requireAuth,async(req,res)=>{notifications.filter(x=>x.staffId===req.session.staffId&&!x.read).forEach(x=>x.read=true);await pool.query('UPDATE kia_notifications SET read=TRUE WHERE staff_id=$1',[req.session.staffId]);res.json({success:true});});
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
app.get('/api/knowledge',requireAuth,(req,res)=>{if(!canManageKnowledge(req.session))return res.status(403).json({error:'Knowledge Centre is restricted to administrators and approved department heads.'});const items=req.session.role==='admin'?knowledge:knowledge.filter(x=>x.createdBy===req.session.staffId||x.status==='approved');res.json({items});});
app.post('/api/knowledge',requireAuth,async(req,res)=>{if(!canManageKnowledge(req.session))return res.status(403).json({error:'Knowledge Centre is restricted to administrators and approved department heads.'});
  const title=typeof(req.body&&req.body.title)==='string'?req.body.title.trim():'';
  const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';
  if(!title||!content) return res.status(400).json({error:'Title and content are required.'});
  const status=req.session.role==='admin'?'approved':'pending';
  const item={id:crypto.randomUUID(),title,content,status,createdBy:req.session.staffId,approvedBy:req.session.role==='admin'?req.session.staffId:null,approvedAt:req.session.role==='admin'?new Date().toISOString():null,createdAt:new Date().toISOString()};
  await pool.query('INSERT INTO kia_knowledge (id,title,content,status,created_by,approved_by,approved_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',[item.id,item.title,item.content,item.status,item.createdBy,item.approvedBy,item.approvedAt,item.createdAt]);
  knowledge.unshift(item);
  record(req.session,'KNOWLEDGE_WRITE','add_knowledge',{knowledgeId:item.id,status:item.status});
  if(item.status==='pending')await notifyStaff('admin','knowledge','Knowledge awaiting approval','A new knowledge item was submitted and is pending approval.');
  res.status(201).json(item);
});
app.put('/api/knowledge/:id',requireAuth,async(req,res)=>{
  if(!canManageKnowledge(req.session))return res.status(403).json({error:'Knowledge Centre is restricted to administrators and approved department heads.'});
  const item=knowledge.find(x=>x.id===req.params.id);
  if(!item||item.type==='document')return res.status(404).json({error:'Knowledge item not found.'});
  if(req.session.role!=='admin'&&item.createdBy!==req.session.staffId)return res.status(403).json({error:'You can only edit knowledge you submitted.'});
  const title=typeof req.body?.title==='string'?req.body.title.trim():'';
  const content=typeof req.body?.content==='string'?req.body.content.trim():'';
  if(!title||!content)return res.status(400).json({error:'Title and content are required.'});
  const status=req.session.role==='admin'?'approved':'pending';
  item.title=title;item.content=content;item.status=status;
  item.approvedBy=status==='approved'?req.session.staffId:null;
  item.approvedAt=status==='approved'?new Date().toISOString():null;
  await pool.query('UPDATE kia_knowledge SET title=$1,content=$2,status=$3,approved_by=$4,approved_at=$5 WHERE id=$6',[item.title,item.content,item.status,item.approvedBy,item.approvedAt,item.id]);
  record(req.session,'KNOWLEDGE_WRITE','edit_knowledge',{knowledgeId:item.id,status:item.status});
  if(status==='pending'&&item.createdBy)await notifyStaff('admin','knowledge','Knowledge awaiting approval','An edited knowledge item is pending approval.');
  res.json({success:true,item});
});
app.get('/api/plugins',requireAuth,async(req,res)=>{
  const {rows}=await pool.query('SELECT id,name,description,category,enabled FROM kia_plugins ORDER BY name');
  const configured={intelligence:Boolean(NOETICA_API_KEY&&CORE_API_KEY),memory:true,knowledge:true,audit:true,openai:Boolean(process.env.OPENAI_API_KEY),claude:Boolean(process.env.ANTHROPIC_API_KEY),github:Boolean(process.env.GITHUB_TOKEN),supabase:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY),gmail:Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET),'google-calendar':Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET),'google-drive':Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET),gemini:Boolean(process.env.GEMINI_API_KEY),slack:Boolean(process.env.SLACK_BOT_TOKEN),render:Boolean(process.env.RENDER_API_KEY),'google-meet':Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET)};
  const visibleRows=req.session.role==='admin'||req.session.role==='department_head'?rows:rows.filter(x=>x.id!=='knowledge');
  res.json({items:visibleRows.map(x=>{const ready=Boolean(configured[x.id]);return {...x,status:!x.enabled?'disabled':ready?'active':'not_configured',configured:ready,actions:x.enabled&&ready?['run']:[]};})});
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
  if(plugin.id==='knowledge'){if(!canManageKnowledge(req.session))return res.status(403).json({error:'Knowledge plugin is restricted to administrators and approved department heads.'});return res.json({success:true,plugin:plugin.id,output:'Knowledge submitted by department heads remains pending until administrator approval.'});}
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
  if(plugin.id==='gmail'){
    try{
      const {accessToken}=await getGoogleAccessToken(req.session.staffId);
      const r=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10',{headers:googleApiHeaders(accessToken)});
      const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Gmail API request failed.'});
      return res.json({success:true,plugin:plugin.id,output:`Gmail connected. Found ${d.resultSizeEstimate||0} matching messages.`,messages:d.messages||[]});
    }catch(error){return res.status(error.statusCode||502).json({error:error.message});}
  }
  if(plugin.id==='google-calendar'){
    try{
      const {accessToken}=await getGoogleAccessToken(req.session.staffId);
      const r=await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&singleEvents=true&orderBy=startTime',{headers:googleApiHeaders(accessToken)});
      const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Google Calendar API request failed.'});
      return res.json({success:true,plugin:plugin.id,output:`Google Calendar connected. Found ${(d.items||[]).length} upcoming events.`,events:d.items||[]});
    }catch(error){return res.status(error.statusCode||502).json({error:error.message});}
  }
  if(plugin.id==='google-drive'){
    try{
      const {accessToken}=await getGoogleAccessToken(req.session.staffId);
      const r=await fetch("https://www.googleapis.com/drive/v3/files?pageSize=20&orderBy=modifiedTime%20desc&fields=files(id,name,mimeType,modifiedTime,webViewLink)",{headers:googleApiHeaders(accessToken)});
      const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Google Drive API request failed.'});
      return res.json({success:true,plugin:plugin.id,output:`Google Drive connected. Found ${(d.files||[]).length} recent files.`,files:d.files||[]});
    }catch(error){return res.status(error.statusCode||502).json({error:error.message});}
  }
  if(plugin.id==='google-meet'){
    try{
      const {accessToken}=await getGoogleAccessToken(req.session.staffId);
      const action=String(req.body?.action||'create').toLowerCase();
      if(action==='list'){
        const r=await fetch('https://meet.googleapis.com/v2/spaces',{headers:googleApiHeaders(accessToken)});
        const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Google Meet API request failed.'});
        return res.json({success:true,plugin:plugin.id,output:`Google Meet connected. Found ${(d.spaces||[]).length} meeting spaces.`,spaces:d.spaces||[]});
      }
      const r=await fetch('https://meet.googleapis.com/v2/spaces',{method:'POST',headers:{...googleApiHeaders(accessToken),'Content-Type':'application/json'},body:JSON.stringify({})});
      const d=await r.json().catch(()=>({})); if(!r.ok)return res.status(502).json({error:d.error?.message||'Google Meet space creation failed.'});
      record(req.session,'PLUGIN_ACTION','create_google_meet',{space:d.name||null});
      return res.json({success:true,plugin:plugin.id,output:d.meetingUri?`Google Meet created: ${d.meetingUri}`:'Google Meet space created.',space:d});
    }catch(error){return res.status(error.statusCode||502).json({error:error.message});}
  }
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
      const check=await checkKiaDependency(CORE_URL+'/health',3,12000);status=x.enabled&&check.reachable?'connected':'unreachable';detail=check.reachable?'Core health check passed.':('Core health check failed: '+(check.error||'unreachable'));
    }else if(x.id==='noetica'){
      const check=await checkKiaDependency(NOETICA_URL+'/health',3,12000);status=x.enabled&&check.reachable?'connected':'unreachable';detail=check.reachable?'NOETICA health check passed.':('NOETICA health check failed: '+(check.error||'unreachable'));
    }else if(x.id==='google'){const connected=GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET&&GOOGLE_TOKEN_ENCRYPTION_KEY?await getGoogleConnection(req.session.staffId):null;status=connected?'connected':(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET&&GOOGLE_TOKEN_ENCRYPTION_KEY?'ready':'not_configured');detail=connected?'Google account is authorized for Gmail, Calendar, Drive and Meet scopes.':status==='ready'?'Google OAuth is configured; staff authorization is required to connect.':'Google OAuth credentials or token encryption key are not configured.';action=status==='ready';actionLabel='Connect Google';
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
    if(!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!GOOGLE_TOKEN_ENCRYPTION_KEY) return res.status(503).json({error:'Google connector is not fully configured. Set Google OAuth credentials and KIA_GOOGLE_TOKEN_ENCRYPTION_KEY.'});
    const state=crypto.randomBytes(24).toString('hex');
    googleStates.set(state,{createdAt:Date.now(),connector:'google',staffId:req.session.staffId});
    setTimeout(()=>googleStates.delete(state),10*60*1000);
    const params=new URLSearchParams({client_id:GOOGLE_CLIENT_ID,redirect_uri:GOOGLE_REDIRECT_URI,response_type:'code',scope:GOOGLE_SCOPES.join(' '),access_type:'offline',include_granted_scopes:'true',prompt:'consent',state});
    record(req.session,'CONNECTOR_ACTION','connect_google',{connectorId:'google'});
    return res.json({success:true,redirect:'https://accounts.google.com/o/oauth2/v2/auth?'+params.toString()});
  }
  if(req.params.id==='core'||req.params.id==='noetica'||['github','supabase','openai','claude','gemini','slack','render'].includes(req.params.id)){
    record(req.session,'CONNECTOR_ACTION','health_check',{connectorId:req.params.id});
    return res.json({success:true,message:'Connector status check completed. Refresh the Connectors section to see the live status.'});
  }
  return res.status(404).json({error:'Connector not found.'});
});
app.get('/api/google/status',requireAuth,async(req,res)=>{
  const connection=await getGoogleConnection(req.session.staffId);
  res.json({configured:Boolean(GOOGLE_CLIENT_ID&&GOOGLE_CLIENT_SECRET&&GOOGLE_TOKEN_ENCRYPTION_KEY),connected:Boolean(connection),email:connection?.email||null,scopes:connection?.granted_scopes?connection.granted_scopes.split(' ').filter(Boolean):[]});
});
app.post('/api/google/disconnect',requireAuth,async(req,res)=>{
  await pool.query('DELETE FROM kia_google_connections WHERE staff_id=$1',[req.session.staffId]);
  record(req.session,'CONNECTOR_ACTION','google_disconnected',{connectorId:'google'});
  res.json({success:true});
});
app.get('/api/hin',requireAuth,async(req,res)=>{
  const {rows}=await pool.query(`
    SELECT h.staff_id,h.expertise,h.interests,h.availability,h.bio,u.name,u.email,u.department,u.role
    FROM kia_hin_profiles h JOIN kia_users u ON u.staff_id=h.staff_id
    WHERE u.status='approved' ORDER BY u.name
  `);
  res.json({items:rows.map(x=>({...x,staffId:x.staff_id})),me:rows.find(x=>x.staff_id===req.session.staffId)||null});
});
app.put('/api/hin',requireAuth,async(req,res)=>{
  const expertise=String(req.body?.expertise||'').trim().slice(0,2000);
  const interests=String(req.body?.interests||'').trim().slice(0,2000);
  const availability=String(req.body?.availability||'').trim().slice(0,500);
  const bio=String(req.body?.bio||'').trim().slice(0,3000);
  await pool.query(`
    INSERT INTO kia_hin_profiles (id,staff_id,expertise,interests,availability,bio,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT (staff_id) DO UPDATE SET expertise=EXCLUDED.expertise,interests=EXCLUDED.interests,availability=EXCLUDED.availability,bio=EXCLUDED.bio,updated_at=NOW()
  `,[crypto.randomUUID(),req.session.staffId,expertise,interests,availability,bio]);
  record(req.session,'HIN_PROFILE_UPDATE','update_hin_profile',{});
  res.json({success:true});
});
app.get('/api/projects',requireAuth,async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM kia_projects WHERE staff_id=$1 ORDER BY updated_at DESC',[req.session.staffId]);
  res.json({items:rows});
});
app.post('/api/projects',requireAuth,async(req,res)=>{
  const name=String(req.body?.name||'').trim().slice(0,160);
  const objective=String(req.body?.objective||'').trim().slice(0,3000);
  const context=String(req.body?.context||'').trim().slice(0,6000);
  if(!name||!objective)return res.status(400).json({error:'Project name and objective are required.'});
  const id=crypto.randomUUID();
  await pool.query('INSERT INTO kia_projects (id,staff_id,name,objective,context,status) VALUES ($1,$2,$3,$4,$5,$6)',[id,req.session.staffId,name,objective,context,'active']);
  record(req.session,'PROJECT_CREATE','create_project',{projectId:id});
  res.status(201).json({success:true,project:{id,staffId:req.session.staffId,name,objective,context,status:'active'}});
});
app.put('/api/projects/:id',requireAuth,async(req,res)=>{
  const name=String(req.body?.name||'').trim().slice(0,160);
  const objective=String(req.body?.objective||'').trim().slice(0,3000);
  const context=String(req.body?.context||'').trim().slice(0,6000);
  const status=String(req.body?.status||'active').trim().slice(0,40);
  if(!name||!objective)return res.status(400).json({error:'Project name and objective are required.'});
  const {rows}=await pool.query('UPDATE kia_projects SET name=$1,objective=$2,context=$3,status=$4,updated_at=NOW() WHERE id=$5 AND staff_id=$6 RETURNING *',[name,objective,context,status,req.params.id,req.session.staffId]);
  if(!rows[0])return res.status(404).json({error:'Project not found.'});
  record(req.session,'PROJECT_UPDATE','update_project',{projectId:req.params.id});
  res.json({success:true,project:rows[0]});
});
app.post('/api/projects/:id/analyze',requireAuth,async(req,res)=>{
  const {rows}=await pool.query('SELECT * FROM kia_projects WHERE id=$1 AND staff_id=$2',[req.params.id,req.session.staffId]);
  const p=rows[0]; if(!p)return res.status(404).json({error:'Project not found.'});
  const input=`Project Intelligence request for "${p.name}". Objective: ${p.objective}. Context: ${p.context||'None provided'}. Analyze the project, identify priorities, risks, next actions and decision points. Return a concise actionable plan.`;
  try{
    const result=await runKiaIntelligence(input,req.session);
    record(req.session,'PROJECT_INTELLIGENCE','analyze_project',{projectId:p.id});
    res.json(result);
  }catch(error){
    res.status(error.statusCode||502).json({error:'Project intelligence request failed.',detail:error.detail||error.message,code:error.code||'PROJECT_INTELLIGENCE_FAILED'});
  }
});
app.get('/api/audit',requireAuth,(req,res)=>{const items=(req.session.role==='admin'?audit:audit.filter(x=>x.staffId===req.session.staffId)).map(x=>{const u=[...users.values()].find(v=>v.staffId===x.staffId);return {...x,user:u?{name:u.name,email:u.email,department:u.department,staffId:u.staffId,role:u.role}:null};});res.json({items});});



/*
 * KIA MCP interface
 * Streamable HTTP JSON-RPC endpoint for authorized KIA tooling.
 * Read/diagnostic tools only in v0.1.0; mutations remain behind KIA's normal
 * authenticated application APIs until explicit MCP authorization is added.
 */
const KIA_MCP_API_KEY = process.env.KIA_MCP_API_KEY || '';
const KIA_MCP_PROTOCOL_VERSION = '2026-07-28';

function mcpJsonRpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function mcpError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}
function mcpAuthorized(req) {
  if (!KIA_MCP_API_KEY) return false;
  const auth = String(req.headers.authorization || '');
  return auth === 'Bearer ' + KIA_MCP_API_KEY;
}
function mcpTool(name, description, inputSchema) {
  return { name, description, inputSchema };
}
function mcpTools() {
  return [
    mcpTool(
      'kia_health',
      'Return KIA service configuration and dependency health for Krative Core and NOETICA.',
      { type: 'object', properties: {}, additionalProperties: false }
    ),
    mcpTool(
      'kia_intelligence',
      'Send an intelligence request through KIA to NOETICA and Krative Core. KIA remains the orchestration layer; it does not create a separate intelligence engine.',
      {
        type: 'object',
        properties: {
          input: { type: 'string', minLength: 1, description: 'The user request to process through KIA intelligence.' },
          staff_id: { type: 'string', description: 'Optional staff identifier for audit attribution.' }
        },
        required: ['input'],
        additionalProperties: false
      }
    ),
    mcpTool(
      'kia_connectors',
      'Return the current live connector status for KIA, including Krative Core, NOETICA and configured integrations.',
      { type: 'object', properties: {}, additionalProperties: false }
    ),
    mcpTool(
      'kia_knowledge',
      'Return approved KIA knowledge available to the authenticated MCP caller. Pending or rejected knowledge is never returned.',
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional text filter.' }
        },
        additionalProperties: false
      }
    ),
    mcpTool(
      'kia_audit',
      'Return KIA audit activity. The MCP interface exposes only recent activity and never exposes secrets or access tokens.',
      {
        type: 'object',
        properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } },
        additionalProperties: false
      }
    )
  ];
}

async function mcpHealth() {
  const core = await checkKiaDependency(CORE_URL + '/health', 3, 12000);
  const noetica = await checkKiaDependency(NOETICA_URL + '/health', 3, 12000);
  return {
    service: 'kia',
    status: core.reachable && noetica.reachable ? 'ok' : 'degraded',
    core: { configured: Boolean(CORE_API_KEY), baseUrl: CORE_URL, reachable: core.reachable, error: core.error || null },
    noetica: { configured: Boolean(NOETICA_API_KEY), baseUrl: NOETICA_URL, reachable: noetica.reachable, error: noetica.error || null },
    timestamp: new Date().toISOString()
  };
}

async function mcpCallTool(name, args) {
  if (name === 'kia_health') return await mcpHealth();

  if (name === 'kia_intelligence') {
    const input = typeof args?.input === 'string' ? args.input.trim() : '';
    if (!input) throw new Error('input is required.');
    const session = {
      staffId: typeof args?.staff_id === 'string' && args.staff_id.trim() ? args.staff_id.trim() : 'mcp',
      role: 'staff',
      createdAt: new Date().toISOString()
    };
    const result = await runKiaIntelligence(input, session);
    return {
      success: Boolean(result?.success),
      response: result?.response || null,
      intent: result?.intent || null,
      pipeline: {
        noeticaStatus: result?.noetica?.result?.status || null,
        coreStatus: result?.noetica?.result?.core?.state?.status || null,
        coreStage: result?.noetica?.result?.core?.state?.stage || null,
        kifStatus: result?.noetica?.result?.core?.state?.kif?.status || null
      }
    };
  }

  if (name === 'kia_connectors') {
    return await mcpHealth();
  }

  if (name === 'kia_knowledge') {
    const query = typeof args?.query === 'string' ? args.query.trim().toLowerCase() : '';
    const approved = knowledge
      .filter(item => item.status === 'approved' && item.type !== 'document')
      .filter(item => !query || String(item.title || '').toLowerCase().includes(query) || String(item.content || '').toLowerCase().includes(query))
      .map(item => ({
        id: item.id,
        title: item.title,
        content: item.content,
        status: item.status,
        createdAt: item.createdAt
      }));
    return { items: approved };
  }

  if (name === 'kia_audit') {
    const limit = Math.min(100, Math.max(1, Number(args?.limit || 25)));
    return {
      items: audit.slice(0, limit).map(item => ({
        id: item.id,
        staffId: item.staffId,
        eventType: item.eventType,
        action: item.action,
        metadata: item.metadata,
        createdAt: item.createdAt
      }))
    };
  }

  throw new Error('Unknown KIA MCP tool: ' + name);
}

app.post('/mcp', async (req, res) => {
  if (!mcpAuthorized(req)) return res.status(401).json(mcpError(null, -32001, 'Unauthorized KIA MCP request.'));
  const requestedVersion = String(req.headers['mcp-protocol-version'] || req.body?._meta?.['io.modelcontextprotocol/protocolVersion'] || '');
  if (requestedVersion && requestedVersion !== KIA_MCP_PROTOCOL_VERSION) {
    return res.status(400).json(mcpError(req.body?.id ?? null, -32002, 'Unsupported MCP protocol version.', { supported: [KIA_MCP_PROTOCOL_VERSION] }));
  }

  const message = req.body;
  if (!message || Array.isArray(message) || message.jsonrpc !== '2.0') {
    return res.status(400).json(mcpError(message?.id ?? null, -32600, 'Invalid JSON-RPC request.'));
  }

  const id = message.id ?? null;
  const headerProtocol = String(req.headers['mcp-protocol-version'] || '');
  const headerMethod = String(req.headers['mcp-method'] || '');
  const headerName = String(req.headers['mcp-name'] || '');
  const isModern = requestedVersion === KIA_MCP_PROTOCOL_VERSION || headerProtocol === KIA_MCP_PROTOCOL_VERSION;

  if (isModern) {
    if (headerProtocol !== KIA_MCP_PROTOCOL_VERSION) {
      return res.status(400).json(mcpError(id, -32020, 'Mcp-Protocol-Version must match the 2026-07-28 protocol version.'));
    }
    if (headerMethod && headerMethod !== String(message.method || '')) {
      return res.status(400).json(mcpError(id, -32020, 'Mcp-Method does not match the JSON-RPC method.'));
    }
    if (!headerMethod) {
      return res.status(400).json(mcpError(id, -32020, 'Mcp-Method is required for 2026-07-28 requests.'));
    }
    if (message.method === 'tools/call') {
      const expectedName = String(message.params?.name || '');
      if (!headerName || headerName !== expectedName) {
        return res.status(400).json(mcpError(id, -32020, 'Mcp-Name does not match tools/call params.name.'));
      }
    } else if (headerName) {
      return res.status(400).json(mcpError(id, -32020, 'Mcp-Name is only valid when routing a named MCP operation.'));
    }
  }

  try {
    if (message.method === 'server/discover') {
      return res.json(mcpJsonRpc(id, {
        protocolVersion: KIA_MCP_PROTOCOL_VERSION,
        serverInfo: { name: 'krative-kia', version: '0.1.0' },
        capabilities: { tools: { listChanged: false } }
      }));
    }

    if (message.method === 'initialize') {
      return res.json(mcpJsonRpc(id, {
        protocolVersion: KIA_MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'krative-kia', version: '0.1.0' }
      }));
    }

    if (message.method === 'tools/list') {
      return res.json(mcpJsonRpc(id, {
        tools: mcpTools(),
        _meta: { ttlMs: 30000, cacheScope: 'private' }
      }));
    }

    if (message.method === 'tools/call') {
      const name = message.params?.name;
      const args = message.params?.arguments || {};
      const result = await mcpCallTool(name, args);
      return res.json(mcpJsonRpc(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false,
        _meta: { serverInfo: { name: 'krative-kia', version: '0.1.0' } }
      }));
    }

    if (message.method === 'ping') return res.json(mcpJsonRpc(id, {}));

    return res.status(404).json(mcpError(id, -32601, 'Method not found.'));
  } catch (error) {
    console.error('KIA MCP request failed:', error);
    return res.status(200).json(mcpJsonRpc(id, {
      content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
      isError: true
    }));
  }
});

app.get('/mcp', (req, res) => {
  if (!mcpAuthorized(req)) return res.status(401).json({ error: 'Unauthorized KIA MCP request.' });
  res.status(405).json({ error: 'KIA MCP uses POST /mcp.' });
});

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
        runConfiguredPluginSmokeTests().catch(error=>console.error(JSON.stringify({type:'KIA_PLUGIN_SMOKE_TEST',tests:[],error:error.message})));
      }
    });
  })
  .catch(error=>{
    console.error('KIA database initialization failed:',error);
    process.exit(1);
  });
