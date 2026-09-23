const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ACCESS_CODE = process.env.KIA_ACCESS_CODE || '';
const CORE_URL = (process.env.KRATIVE_CORE_BASE_URL || 'https://krative-core.onrender.com').replace(/\/$/, '');
const CORE_API_KEY = process.env.KRATIVE_CORE_API_KEY || '';

app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

const sessions = new Map();
const memory = [];
const audit = [];
const users = new Map();

const knowledge = [{
  id:'kia-core',
  title:'KIA Intelligence Foundation',
  content:'KIA is Krative T3ch private staff intelligence assistant. It is aligned with NOETICA Intelligence and uses Krative Core when connected.',
  createdAt:new Date().toISOString()
}];

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
  audit.unshift({
    id:crypto.randomUUID(),
    staffId:s?s.staffId:'unknown',
    eventType,
    action,
    metadata,
    createdAt:new Date().toISOString()
  });
  if(audit.length>200) audit.pop();
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

app.get('/health',(req,res)=>res.json({
  status:'ok',
  service:'kia',
  coreConfigured:Boolean(CORE_API_KEY),
  coreBaseUrl:CORE_URL,
  signupEnabled:true
}));

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
    record(s,'AUTH_LOGIN','admin_login');
    return res.json({token:t,staff:s});
  }

  if(!ACCESS_CODE) return res.status(503).json({error:'KIA access is not configured.'});
  if(typeof accessCode!=='string'||accessCode!==ACCESS_CODE) return res.status(401).json({error:'Invalid staff access code.'});

  const t=token();
  const s={staffId:staffId||'staff',role:'staff',createdAt:new Date().toISOString()};
  sessions.set(t,s);
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
  record(s,'AUTH_LOGIN','account_login',{userId:user.id});
  res.json({token:t,staff:{...s,name:user.name,email:user.email,department:user.department}});
});

app.post('/api/logout',requireAuth,(req,res)=>{
  record(req.session,'AUTH_LOGOUT','staff_logout');
  sessions.delete(req.headers.authorization.slice(7));
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

app.post('/api/admin/users/:id/approve',requireAuth,requireAdmin,(req,res)=>{
  const u=users.get(req.params.id);
  if(!u) return res.status(404).json({error:'User not found.'});
  u.status='approved';
  u.approvedAt=new Date().toISOString();
  record(req.session,'AUTH_APPROVAL','approve_staff',{userId:u.id});
  res.json({success:true,user:publicUser(u)});
});

app.post('/api/admin/users/:id/reject',requireAuth,requireAdmin,(req,res)=>{
  const u=users.get(req.params.id);
  if(!u) return res.status(404).json({error:'User not found.'});
  u.status='rejected';
  record(req.session,'AUTH_REJECTION','reject_staff',{userId:u.id});
  res.json({success:true,user:publicUser(u)});
});

app.post('/api/chat',requireAuth,async(req,res)=>{
  const input=typeof(req.body&&req.body.input)==='string'?req.body.input.trim():'';
  if(!input) return res.status(400).json({error:'Input is required.'});
  if(!CORE_API_KEY) return res.status(503).json({error:'Krative Core API key is not configured on KIA.'});
  record(req.session,'INTELLIGENCE_REQUEST','process_input',{length:input.length});
  try{
    const r=await fetch(CORE_URL+'/api/v1/intelligence',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+CORE_API_KEY},
      body:JSON.stringify({input,context:{source:'KIA',staffId:req.session.staffId}})
    });
    const data=await r.json();
    record(req.session,'INTELLIGENCE_RESPONSE','core_response',{status:r.status});
    res.status(r.status).json(data);
  }catch(error){
    record(req.session,'INTELLIGENCE_ERROR','core_request_failed',{message:error.message});
    res.status(502).json({error:'Krative Core is unreachable.'});
  }
});

app.get('/api/memory',requireAuth,(req,res)=>res.json({items:memory.filter(x=>x.staffId===req.session.staffId||x.scope==='shared')}));
app.post('/api/memory',requireAuth,(req,res)=>{
  const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';
  if(!content) return res.status(400).json({error:'Memory content is required.'});
  const item={id:crypto.randomUUID(),staffId:req.session.staffId,scope:req.body&&req.body.scope==='shared'?'shared':'private',content,createdAt:new Date().toISOString()};
  memory.unshift(item);
  record(req.session,'MEMORY_WRITE','store_memory',{memoryId:item.id,scope:item.scope});
  res.status(201).json(item);
});
app.get('/api/knowledge',requireAuth,(req,res)=>res.json({items:knowledge}));
app.post('/api/knowledge',requireAuth,(req,res)=>{
  const title=typeof(req.body&&req.body.title)==='string'?req.body.title.trim():'';
  const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';
  if(!title||!content) return res.status(400).json({error:'Title and content are required.'});
  const item={id:crypto.randomUUID(),title,content,createdAt:new Date().toISOString()};
  knowledge.unshift(item);
  record(req.session,'KNOWLEDGE_WRITE','add_knowledge',{knowledgeId:item.id});
  res.status(201).json(item);
});
app.get('/api/audit',requireAuth,(req,res)=>res.json({items:audit}));

app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log('KIA listening on '+PORT));