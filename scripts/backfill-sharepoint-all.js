#!/usr/bin/env node
/**
 * Generalized SharePoint backfill for approved menus that never synced.
 * Pushes ONLY service-folder-matched menus (safe, auto-routable). Menus whose
 * service period has no matching configured folder are skipped and reported
 * for a separate manual/subfolder-routing pass.
 *
 *   node scripts/backfill-sharepoint-all.js                       # dry-run, all configured properties
 *   node scripts/backfill-sharepoint-all.js --execute             # perform uploads
 *   node scripts/backfill-sharepoint-all.js --property "tán"      # limit to matching property name(s)
 *
 * Regeneration: source='form' -> prod dashboard clean-download (actual/clean
 * approved DOCX); otherwise regenerate from saved content via docx-redliner.
 * Archive: same-name only (never touches marketing's differently-named files).
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileP = promisify(execFile);
const { createClient } = require('@supabase/supabase-js');

const EXECUTE = process.argv.includes('--execute');
const propArgIdx = process.argv.indexOf('--property');
const PROP_FILTER = propArgIdx >= 0 ? (process.argv[propArgIdx + 1] || '').toLowerCase() : '';
const ROOT = path.resolve(__dirname, '..');
const DASH_URL = (process.env.BACKFILL_DASHBOARD_URL || 'https://sandovalhospitalitymenumanager.live').replace(/\/$/, '');
const FOOD_TPL = path.join(ROOT, 'samples', 'RSH_DESIGN BRIEF_FOOD_Menu_Template .docx');
const BEV_TPL = path.join(ROOT, 'samples', 'RSH Design Brief Beverage Template.docx');
const PY = path.join(ROOT, 'services', 'docx-redliner', 'venv', 'bin', 'python');
const PY_SCRIPT = path.join(ROOT, 'services', 'docx-redliner', 'generate_from_form.py');

function sani(v){return String(v||'').trim().replace(/[\\/:*?"<>|#%]+/g,' ').replace(/\s+/g,' ').trim();}
function titleCase(v){return v.toLowerCase().split(/\s+/).filter(Boolean).map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(' ');}
function dateSeg(v){const c=`${v||''}`.trim();const m=c.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${+m[2]}.${+m[3]}.${m[1].slice(-2)}`;const p=c?new Date(c):new Date();const d=isNaN(p.getTime())?new Date():p;return `${d.getMonth()+1}.${d.getDate()}.${String(d.getFullYear()).slice(-2)}`;}
function fileName(s,eff){const prop=sani(String(s.property||'').split(' - ')[0]||'Menu');const svc=sani(titleCase(String(s.service_period||'Other').replace(/_/g,' ')))||'Other';return `${prop}_${svc}_${dateSeg(eff)}.docx`;}
function norm(v){const n=String(v||'').trim().toLowerCase();return n==='shared documents'?'documents':n;}
function normKey(v){return String(v||'').trim().toLowerCase().replace(/[_-]+/g,' ').replace(/\s*&\s*/g,' and ').replace(/\s+/g,' ');}
function encP(p){return p.split('/').map(encodeURIComponent).join('/');}

async function regenViaPython(s){
  const eff=s.date_needed||s.created_at;
  const formData={projectName:s.project_name||'',property:s.property||'',size:s.size||'',orientation:s.orientation||'',menuType:s.menu_type||'standard',dateNeeded:eff||'',menuContent:s.approved_menu_content||'',menuContentHtml:s.approved_menu_content_html||'',allergens:(s.raw_payload&&s.raw_payload.allergens)||''};
  const tpl=String(s.template_type||'food').toLowerCase()==='beverage'?BEV_TPL:FOOD_TPL;
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'mm-bf-'));const fd=path.join(tmp,'fd.json');const out=path.join(tmp,'o.docx');
  fs.writeFileSync(fd,JSON.stringify(formData));
  await execFileP(fs.existsSync(PY)?PY:'python3',[PY_SCRIPT,tpl,fd,out],{timeout:60000});
  const buf=fs.readFileSync(out);fs.rmSync(tmp,{recursive:true,force:true});return buf;
}
async function regenViaForm(id){
  const dl=await axios.get(`${DASH_URL}/download/approved-clean/${encodeURIComponent(id)}`,{responseType:'arraybuffer',timeout:60000,validateStatus:()=>true});
  if(dl.status!==200) throw new Error(`dashboard HTTP ${dl.status}`);
  return Buffer.from(dl.data);
}
// Prefer the prod app's actual approved DOCX for form approvals (higher
// fidelity); fall back to regenerating from saved content when it 404s.
async function regen(s){
  if(String(s.source||'')==='form'){
    try{ const b=await regenViaForm(s.id); if(b.slice(0,2).toString()==='PK'&&b.length>=1000) return b; }catch{}
  }
  return regenViaPython(s);
}

(async()=>{
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const body=new URLSearchParams({client_id:process.env.GRAPH_CLIENT_ID,client_secret:process.env.GRAPH_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'});
  const tok=(await axios.post(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,body.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'}})).data.access_token;
  const auth={Authorization:`Bearer ${tok}`};
  const G=p=>axios.get(`https://graph.microsoft.com/v1.0${p}`,{headers:auth}).then(r=>r.data);

  const driveCache={};
  async function resolveDrive(p){
    const cacheKey=p.sharepoint_drive_id||`${p.sharepoint_site_url}|${p.sharepoint_library_name}`;
    if(driveCache[cacheKey])return driveCache[cacheKey];
    let siteId,driveId;
    if(p.sharepoint_drive_id){driveId=p.sharepoint_drive_id;}
    else{const u=new URL(p.sharepoint_site_url);const site=await G(`/sites/${u.hostname}:${u.pathname.replace(/\/+$/,'')}`);siteId=site.id;const drives=await G(`/sites/${site.id}/drives`);const d=drives.value.find(x=>norm(x.name)===norm(p.sharepoint_library_name));if(!d)throw new Error(`library "${p.sharepoint_library_name}" not found`);driveId=d.id;}
    return driveCache[cacheKey]={siteId,driveId};
  }
  const listDocx=async(driveId,f)=>{try{const k=await G(`/drives/${driveId}/root:/${encP(f)}:/children`);return k.value;}catch(e){if(e.response?.status===404)return null;throw e;}};

  let {data:props}=await supabase.from('properties').select('name,sharepoint_site_url,sharepoint_library_name,sharepoint_drive_id,sharepoint_base_folder_path,sharepoint_service_folders').not('sharepoint_base_folder_path','is',null).order('name');
  if(PROP_FILTER) props=props.filter(p=>p.name.toLowerCase().includes(PROP_FILTER));

  console.log(`\nMODE: ${EXECUTE?'*** EXECUTE ***':'dry-run'} | properties: ${props.length} | matched-only\n`+'='.repeat(90));
  const grand={done:0,fail:0,skip:0,deferred:0,dupDropped:0};

  for(const p of props){
    const {data:subs}=await supabase.from('submissions').select('id,property,project_name,service_period,date_needed,created_at,source,template_type,menu_type,orientation,size,raw_payload,approved_menu_content,approved_menu_content_html').in('status',['approved','approved_override']).eq('property',p.name);
    const ids=subs.map(s=>s.id);
    const {data:assets}=ids.length?await supabase.from('assets').select('submission_id').eq('asset_type','sharepoint_approved_docx').in('submission_id',ids):{data:[]};
    const have=new Set(assets.map(a=>a.submission_id));
    const folders=(p.sharepoint_service_folders||[]);
    const folderByKey=new Map(folders.map(f=>[normKey(f),f]));
    const pending=subs.filter(s=>!have.has(s.id));
    const matchedRaw=pending.filter(s=>folderByKey.has(normKey(s.service_period)));
    const deferred=pending.filter(s=>!folderByKey.has(normKey(s.service_period)));
    grand.deferred+=deferred.length;

    // Chicago was handled in the first pass; its 2 remaining Beverage rows are
    // the duplicates intentionally dropped ("latest only" = 6/30). Skip it.
    if(/Fairmont Millennium Park - Chicago/.test(p.name)){
      if(matchedRaw.length||deferred.length) console.log(`\n### ${p.name}  — already handled (skipping ${matchedRaw.length} intentional Beverage dup(s))`);
      continue;
    }

    // In-batch dedupe: multiple submissions can produce the same target file
    // (same service + same date = resubmissions). Keep the newest, drop the rest.
    const seen=new Map(); const dupDropped=[];
    for(const s of [...matchedRaw].sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))){
      const eff=s.date_needed||s.created_at; const key=`${folderByKey.get(normKey(s.service_period))}/${fileName(s,eff)}`;
      if(seen.has(key)){dupDropped.push(s);continue;}
      seen.set(key,s);
    }
    const matched=[...seen.values()];
    grand.dupDropped+=dupDropped.length;
    if(!matched.length && !deferred.length) continue;
    console.log(`\n### ${p.name}  (matched ${matched.length}, dup-dropped ${dupDropped.length}, deferred ${deferred.length})`);
    if(!matched.length){console.log('   (no auto-routable menus)');continue;}

    let drive;try{drive=await resolveDrive(p);}catch(e){console.log(`   DRIVE RESOLVE FAILED: ${e.message} — skipping property`);grand.fail+=matched.length;continue;}

    for(const s of matched){
      const eff=s.date_needed||s.created_at;const fn=fileName(s,eff);
      const folder=`${p.sharepoint_base_folder_path}/${folderByKey.get(normKey(s.service_period))}`;
      const storagePath=`${folder}/${fn}`;
      try{
        const buf = await regen(s);
        if(buf.slice(0,2).toString()!=='PK'||buf.length<1000){console.log(`   [FAIL] ${s.service_period} :: ${fn} — bad docx`);grand.fail++;continue;}
        const kids=await listDocx(drive.driveId,folder);
        if(kids===null){console.log(`   [FAIL] ${s.service_period} :: ${fn} — folder missing: ${folder}`);grand.fail++;continue;}
        const sameName=kids.find(x=>x.file&&x.name===fn);
        if(!EXECUTE){console.log(`   [READY] ${s.service_period} :: ${folderByKey.get(normKey(s.service_period))}/${fn} (${(buf.length/1024).toFixed(0)}KB${sameName?', archives same-name':''})`);grand.done++;continue;}
        if(sameName){
          let oldF;try{oldF=await G(`/drives/${drive.driveId}/root:/${encP(folder+'/old')}`);}catch(e){if(e.response?.status===404){const par=await G(`/drives/${drive.driveId}/root:/${encP(folder)}`);oldF=await axios.post(`https://graph.microsoft.com/v1.0/drives/${drive.driveId}/items/${par.id}/children`,{name:'old',folder:{}},{headers:{...auth,'Content-Type':'application/json'}}).then(x=>x.data);}else throw e;}
          await axios.patch(`https://graph.microsoft.com/v1.0/drives/${drive.driveId}/items/${sameName.id}`,{parentReference:{id:oldF.id},name:fn.replace(/\.docx$/i,`_archived_${Date.now()}.docx`)},{headers:{...auth,'Content-Type':'application/json'}});
        }
        const put=await axios.put(`https://graph.microsoft.com/v1.0/drives/${drive.driveId}/root:/${encP(storagePath)}:/content`,buf,{headers:{...auth,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},maxBodyLength:Infinity});
        const {error:aErr}=await supabase.from('assets').insert({submission_id:s.id,asset_type:'sharepoint_approved_docx',source:'sharepoint_graph',storage_provider:'sharepoint',storage_path:storagePath,file_name:fn,meta:{site_id:drive.siteId||null,drive_id:drive.driveId,web_url:put.data?.webUrl||null,matched_folder:folderByKey.get(normKey(s.service_period)),archived_docx_count:sameName?1:0,backfilled:true}});
        console.log(`   [DONE] ${s.service_period} :: ${fn}${sameName?' (archived prior)':''}${aErr?` | ASSET FAIL ${aErr.message}`:''}`);
        grand.done++;
      }catch(e){console.log(`   [ERR] ${s.service_period} :: ${fn} — ${e.response?.status||''} ${(e.message||'').slice(0,140)}`);grand.fail++;}
    }
  }
  console.log('\n'+'='.repeat(90));
  console.log(`TALLY: ${EXECUTE?'uploaded':'ready'}=${grand.done}, failed=${grand.fail}, dup-dropped(older resubmissions)=${grand.dupDropped}, deferred(unmatched, need manual routing)=${grand.deferred}`);
  if(!EXECUTE) console.log('Dry run. Re-run with --execute to upload the matched menus.');
})().catch(e=>{console.error('FATAL',e.response?.status,e.message);process.exit(1);});
