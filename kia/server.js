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
const sessions=new Map(); const memory=[]; const audit=[];
const knowledge=[{id:'kia-core',title:'KIA Intelligence Foundation',content:'KIA is Krative T3ch private staff intelligence assistant. It is aligned with NOETICA Intelligence and uses Krative Core when connected.',createdAt:new Date().toISOString()}];
function token(){return crypto.randomBytes(32).toString('hex')}
function getSession(req){const raw=req.headers.authorization||'';if(!raw.startsWith('Bearer '))return null;return sessions.get(raw.slice(7))||null}
function requireAuth(req,res,next){const s=getSession(req);if(!s)return res.status(401).json({error:'Unauthorized.'});req.session=s;next()}
function record(s,eventType,action,metadata={}){audit.unshift({id:crypto.randomUUID(),staffId:s?s.staffId:'unknown',eventType,action,metadata,createdAt:new Date().toISOString()});if(audit.length>200)audit.pop()}
app.get('/health',(req,res)=>res.json({status:'ok',service:'kia',coreConfigured:Boolean(CORE_API_KEY),coreBaseUrl:CORE_URL}));
app.post('/api/login',(req,res)=>{if(!ACCESS_CODE)return res.status(503).json({error:'KIA access is not configured.'});const staffId=String(req.body&&req.body.staffId||'staff').slice(0,80);const accessCode=req.body&&req.body.accessCode;if(typeof accessCode!=='string'||accessCode!==ACCESS_CODE)return res.status(401).json({error:'Invalid staff credentials.'});const t=token();const s={staffId,role:'staff',createdAt:new Date().toISOString()};sessions.set(t,s);record(s,'AUTH_LOGIN','staff_login');res.json({token:t,staff:s})});
app.post('/api/logout',requireAuth,(req,res)=>{record(req.session,'AUTH_LOGOUT','staff_logout');sessions.delete(req.headers.authorization.slice(7));res.json({success:true})});
app.get('/api/session',requireAuth,(req,res)=>res.json({staff:req.session}));
app.get('/api/status',requireAuth,async(req,res)=>{let core={configured:Boolean(CORE_API_KEY),reachable:false};try{const r=await fetch(CORE_URL+'/health');core.reachable=r.ok}catch{}res.json({service:'KIA',core,capabilities:['understanding','classification','knowledge','memory','reasoning','decision','execution','learning','audit']})});
app.post('/api/chat',requireAuth,async(req,res)=>{const input=typeof(req.body&&req.body.input)==='string'?req.body.input.trim():'';if(!input)return res.status(400).json({error:'Input is required.'});if(!CORE_API_KEY)return res.status(503).json({error:'Krative Core API key is not configured on KIA.'});record(req.session,'INTELLIGENCE_REQUEST','process_input',{length:input.length});try{const r=await fetch(CORE_URL+'/api/v1/intelligence',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+CORE_API_KEY},body:JSON.stringify({input,context:{source:'KIA',staffId:req.session.staffId}})});const data=await r.json();record(req.session,'INTELLIGENCE_RESPONSE','core_response',{status:r.status});res.status(r.status).json(data)}catch(error){record(req.session,'INTELLIGENCE_ERROR','core_request_failed',{message:error.message});res.status(502).json({error:'Krative Core is unreachable.'})}});
app.get('/api/memory',requireAuth,(req,res)=>res.json({items:memory.filter(x=>x.staffId===req.session.staffId||x.scope==='shared')}));
app.post('/api/memory',requireAuth,(req,res)=>{const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';if(!content)return res.status(400).json({error:'Memory content is required.'});const item={id:crypto.randomUUID(),staffId:req.session.staffId,scope:req.body&&req.body.scope==='shared'?'shared':'private',content,createdAt:new Date().toISOString()};memory.unshift(item);record(req.session,'MEMORY_WRITE','store_memory',{memoryId:item.id,scope:item.scope});res.status(201).json(item)});
app.get('/api/knowledge',requireAuth,(req,res)=>res.json({items:knowledge}));
app.post('/api/knowledge',requireAuth,(req,res)=>{const title=typeof(req.body&&req.body.title)==='string'?req.body.title.trim():'';const content=typeof(req.body&&req.body.content)==='string'?req.body.content.trim():'';if(!title||!content)return res.status(400).json({error:'Title and content are required.'});const item={id:crypto.randomUUID(),title,content,createdAt:new Date().toISOString()};knowledge.unshift(item);record(req.session,'KNOWLEDGE_WRITE','add_knowledge',{knowledgeId:item.id});res.status(201).json(item)});
app.get('/api/audit',requireAuth,(req,res)=>res.json({items:audit}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log('KIA listening on '+PORT));