const express=require('express');
const path=require('path');
const crypto=require('crypto');
const {Pool}=require('pg');

const app=express();
const PORT=Number(process.env.PORT||10000);
const CORE_URL=(process.env.KRATIVE_CORE_BASE_URL||'https://krative-core.onrender.com').replace(/\/$/,'');
const CORE_KEY=process.env.KRATIVE_CORE_API_KEY||'';
const ADMIN_KEY=process.env.KLGI_ADMIN_KEY||'';

app.use(express.json({limit:'2mb'}));
app.use(express.static(path.join(__dirname,'public')));

const memory={signals:[],opportunities:[],audit:[]};
let pool=null;

async function dbInit(){
  if(!process.env.DATABASE_URL) return;
  pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS klgi_signals(
      id uuid PRIMARY KEY, title text NOT NULL, description text NOT NULL,
      source text NOT NULL, source_url text, geography text, industry text,
      signal_type text NOT NULL, strength numeric DEFAULT 0.5,
      verified boolean DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS klgi_opportunities(
      id uuid PRIMARY KEY, problem text NOT NULL, evidence jsonb NOT NULL,
      hypothesis text, confidence numeric DEFAULT 0,
      priority numeric DEFAULT 0, status text DEFAULT 'new',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS klgi_audit(
      id uuid PRIMARY KEY, action text NOT NULL, metadata jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}
function auth(req,res,next){
  if(!ADMIN_KEY) return res.status(503).json({error:'KLGI_ADMIN_KEY is not configured.'});
  const key=String(req.headers['x-klgi-key']||'');
  if(key!==ADMIN_KEY) return res.status(401).json({error:'Invalid KLGI key.'});
  next();
}
async function audit(action,metadata={}){
  const item={id:crypto.randomUUID(),action,metadata,createdAt:new Date().toISOString()};
  memory.audit.unshift(item);
  if(pool) await pool.query('INSERT INTO klgi_audit(id,action,metadata) VALUES($1,$2,$3)',[item.id,action,metadata]);
}
async function getSignals(){
  if(pool){
    const r=await pool.query('SELECT id,title,description,source,source_url AS "sourceUrl",geography,industry,signal_type AS "signalType",strength,verified,created_at AS "createdAt" FROM klgi_signals ORDER BY created_at DESC');
    return r.rows;
  }
  return memory.signals;
}
async function getOpportunities(){
  if(pool){
    const r=await pool.query('SELECT id,problem,evidence,hypothesis,confidence,priority,status,created_at AS "createdAt",updated_at AS "updatedAt" FROM klgi_opportunities ORDER BY priority DESC,updated_at DESC');
    return r.rows;
  }
  return memory.opportunities;
}
function normalizeSignal(body){
  const s={
    id:crypto.randomUUID(),
    title:String(body.title||'').trim().slice(0,180),
    description:String(body.description||'').trim().slice(0,4000),
    source:String(body.source||'').trim().slice(0,180),
    sourceUrl:String(body.sourceUrl||'').trim().slice(0,500),
    geography:String(body.geography||'').trim().slice(0,120),
    industry:String(body.industry||'').trim().slice(0,120),
    signalType:String(body.signalType||'other').trim().slice(0,60),
    strength:Math.max(0,Math.min(1,Number(body.strength??0.5))),
    verified:Boolean(body.verified),
    createdAt:new Date().toISOString()
  };
  if(!s.title||!s.description||!s.source) throw new Error('title, description and source are required');
  return s;
}
function tokens(s){return new Set(String(s).toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(x=>x.length>3));}
function similarity(a,b){
  const A=tokens(a),B=tokens(b); let common=0;
  for(const x of A) if(B.has(x)) common++;
  return common/Math.max(1,Math.min(A.size,B.size));
}
function heuristic(signals){
  if(!signals.length) return [];
  const groups=[];
  for(const s of signals){
    let g=groups.find(x=>similarity(x.problem,s.description+' '+s.title)>=0.34 && (x.industry===s.industry||!x.industry||!s.industry));
    if(!g){g={problem:s.description,industry:s.industry,evidence:[],sources:new Set()};groups.push(g);}
    g.evidence.push(s);g.sources.add(s.source);
  }
  return groups.map(g=>{
    const verified=g.evidence.filter(x=>x.verified).length;
    const avg=g.evidence.reduce((a,x)=>a+x.strength,0)/g.evidence.length;
    const diversity=Math.min(1,g.sources.size/3);
    const recurrence=Math.min(1,g.evidence.length/5);
    const confidence=Math.round((verified?0.35:0.15)*avg*100 + 25*recurrence + 20*diversity);
    const priority=Math.round((avg*40)+(recurrence*30)+(diversity*20)+(verified/g.evidence.length*10));
    return {
      id:crypto.randomUUID(),
      problem:g.problem,
      evidence:g.evidence.map(x=>({signalId:x.id,title:x.title,source:x.source,verified:x.verified,strength:x.strength})),
      hypothesis:'Emerging problem hypothesis: repeated signals may indicate a growing unmet need; validate with affected users before treating it as market demand.',
      confidence:Math.min(100,confidence),
      priority:Math.min(100,priority),
      status:'new',
      createdAt:new Date().toISOString(),
      updatedAt:new Date().toISOString()
    };
  }).filter(x=>x.evidence.length>=2).sort((a,b)=>b.priority-a.priority);
}
async function callCore(input,context){
  if(!CORE_KEY) return {configured:false,mode:'local-heuristic'};
  try{
    const r=await fetch(CORE_URL+'/api/v1/intelligence',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+CORE_KEY},
      body:JSON.stringify({input,context:{...context,source:'KLGI',intelligenceLayer:'NOETICA',fusion:'KIF',state:'UIS',humanNetwork:'HIN'}})
    });
    const data=await r.json();
    return {configured:true,reachable:r.ok,data};
  }catch(e){return {configured:true,reachable:false,error:e.message};}
}

app.get('/health',async(req,res)=>res.json({status:'ok',service:'klgi',noetica:true,coreConfigured:Boolean(CORE_KEY),databaseConfigured:Boolean(pool)}));

app.get('/api/dashboard',auth,async(req,res)=>{
  const [signals,opportunities]=await Promise.all([getSignals(),getOpportunities()]);
  res.json({signals,opportunities,meta:{coreConfigured:Boolean(CORE_KEY),databaseConfigured:Boolean(pool),pipeline:['DISCOVER','COLLECT','UNDERSTAND','QUALIFY','ANALYZE','PRIORITIZE','ACT','LEARN'],principle:'Need Before Demand'}});
});
app.post('/api/signals',auth,async(req,res)=>{
  try{
    const s=normalizeSignal(req.body||{});
    if(pool) await pool.query('INSERT INTO klgi_signals(id,title,description,source,source_url,geography,industry,signal_type,strength,verified,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[s.id,s.title,s.description,s.source,s.sourceUrl,s.geography,s.industry,s.signalType,s.strength,s.verified,s.createdAt]);
    else memory.signals.unshift(s);
    await audit('SIGNAL_COLLECTED',{signalId:s.id,source:s.source,verified:s.verified});
    res.status(201).json(s);
  }catch(e){res.status(400).json({error:e.message});}
});
app.post('/api/analyze',auth,async(req,res)=>{
  const signals=await getSignals();
  const candidates=heuristic(signals);
  const core=await callCore(JSON.stringify(candidates.slice(0,10)),{signalCount:signals.length});
  if(pool){
    for(const o of candidates.slice(0,20)){
      await pool.query(`INSERT INTO klgi_opportunities(id,problem,evidence,hypothesis,confidence,priority,status,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at`,
        [o.id,o.problem,JSON.stringify(o.evidence),o.hypothesis,o.confidence,o.priority,o.status,o.createdAt,o.updatedAt]);
    }
  }else memory.opportunities.unshift(...candidates);
  await audit('NEED_ANALYSIS',{signalCount:signals.length,candidateCount:candidates.length,core:core.configured&&core.reachable});
  res.json({candidates,core});
});
app.post('/api/opportunities/:id/status',auth,async(req,res)=>{
  const status=String(req.body?.status||'new');
  if(!['new','validating','qualified','rejected','acted','learned'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  if(pool) await pool.query('UPDATE klgi_opportunities SET status=$1,updated_at=now() WHERE id=$2',[status,req.params.id]);
  else {const o=memory.opportunities.find(x=>x.id===req.params.id);if(o)o.status=status;}
  await audit('OPPORTUNITY_STATUS',{id:req.params.id,status});
  res.json({success:true,status});
});
app.get('/api/core-status',auth,async(req,res)=>{
  try{const r=await fetch(CORE_URL+'/health');res.json({configured:Boolean(CORE_KEY),reachable:r.ok,baseUrl:CORE_URL});}
  catch(e){res.json({configured:Boolean(CORE_KEY),reachable:false,baseUrl:CORE_URL});}
});
app.get(/.*/,(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

dbInit().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log('KLGI listening on '+PORT)))
.catch(e=>{console.error('Database init failed:',e.message);app.listen(PORT,'0.0.0.0',()=>console.log('KLGI listening without database on '+PORT));});
