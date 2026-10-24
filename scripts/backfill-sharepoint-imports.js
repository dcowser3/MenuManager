#!/usr/bin/env node
/**
 * Backfill the 8 Toro Chicago clickup_history_import menus to SharePoint.
 * These are excluded from the app's download/regenerate route (source!=='form'),
 * so we regenerate the clean DOCX directly via docx-redliner/generate_from_form.py
 * from the approved content stored in Supabase, then upload into each menu's
 * correct existing Teams subfolder.
 *
 *   node scripts/backfill-sharepoint-imports.js            # dry-run (regenerates, no upload)
 *   node scripts/backfill-sharepoint-imports.js --execute  # perform uploads
 *
 * Archive policy: only a SAME-NAMED existing file is moved to old/; marketing's
 * differently-named .indd/.pdf files are never touched.
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
const ROOT = path.resolve(__dirname, '..');
const SITE_URL = 'https://richardsandoval.sharepoint.com/sites/Toro2';
const BASE = 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus';
const FOOD_TPL = path.join(ROOT, 'samples', 'RSH_DESIGN BRIEF_FOOD_Menu_Template .docx');
const BEV_TPL = path.join(ROOT, 'samples', 'RSH Design Brief Beverage Template.docx');
const PY = path.join(ROOT, 'services', 'docx-redliner', 'venv', 'bin', 'python');
const PY_SCRIPT = path.join(ROOT, 'services', 'docx-redliner', 'generate_from_form.py');

// id -> target subfolder (relative to BASE). Seasonal/event menus go to their
// existing Holidays & Events event subfolder; regular service menus to their
// standard service folder.
const TARGETS = [
  { id: 'd3883cf5-f9ba-437e-86d0-724f94e7c994', folder: "Holidays & Events/Mother's Day 2026" },   // Mother's Day Brunch
  { id: 'db336d72-8d5a-459b-9bb4-0062806c1eb9', folder: 'Dessert' },                                 // Dessert (service)
  { id: '6fe50393-2a65-4629-ac96-61f6e58a1df0', folder: 'Holidays & Events/Viva Abejas 2026' },      // Viva Abejas Dinner
  { id: '3aab75d9-dc15-4bcd-bb46-01f4f7bbb273', folder: 'Happy Hour' },                              // Happy Hour (service)
  { id: 'fe9b3ca4-6be7-4222-b7c4-852ea940b0f7', folder: 'Lunch' },                                  // Lunch (service)
  { id: 'dad2906a-2ee4-43d2-95bb-2fc902319b53', folder: 'Holidays & Events/Restaurant Week 2026' }, // Restaurant Week
  { id: '687b4a11-0c5e-4539-9999-ea419a9caa34', folder: 'Holidays & Events/Thanksgiving 2025' },     // Thanksgiving
  { id: '0cbc8fe5-2c17-4fe2-a56b-0b6d3d1827a1', folder: "Holidays & Events/Valentine's Day 2026" },  // Valentine's Day
];

function sani(v){return String(v||'').trim().replace(/[\\/:*?"<>|#%]+/g,' ').replace(/\s+/g,' ').trim();}
function titleCase(v){return v.toLowerCase().split(/\s+/).filter(Boolean).map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(' ');}
function dateSeg(v){const c=`${v||''}`.trim();const m=c.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${+m[2]}.${+m[3]}.${m[1].slice(-2)}`;const p=c?new Date(c):new Date();const d=isNaN(p.getTime())?new Date():p;return `${d.getMonth()+1}.${d.getDate()}.${String(d.getFullYear()).slice(-2)}`;}
function fileName(s,eff){const prop=sani(String(s.property||'').split(' - ')[0]||'Menu');const svc=sani(titleCase(String(s.service_period||'Other').replace(/_/g,' ')))||'Other';return `${prop}_${svc}_${dateSeg(eff)}.docx`;}
function norm(v){const n=String(v||'').trim().toLowerCase();return n==='shared documents'?'documents':n;}
function encP(p){return p.split('/').map(encodeURIComponent).join('/');}

async function regenerate(s){
  const eff = s.date_needed || s.created_at;
  const formData = {
    projectName: s.project_name||'', property: s.property||'',
    size: s.size||'', orientation: s.orientation||'',
    menuType: s.menu_type||'standard', dateNeeded: eff||'',
    menuContent: s.approved_menu_content||'',
    menuContentHtml: s.approved_menu_content_html || '',
    allergens: (s.raw_payload && s.raw_payload.allergens) || '',
  };
  const tpl = String(s.template_type||'food').toLowerCase()==='beverage' ? BEV_TPL : FOOD_TPL;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(),'mm-backfill-'));
  const fdPath = path.join(tmpDir,'formdata.json');
  const outPath = path.join(tmpDir,'out.docx');
  fs.writeFileSync(fdPath, JSON.stringify(formData));
  const py = fs.existsSync(PY) ? PY : 'python3';
  await execFileP(py, [PY_SCRIPT, tpl, fdPath, outPath], { timeout: 60000 });
  const buf = fs.readFileSync(outPath);
  fs.rmSync(tmpDir,{recursive:true,force:true});
  return { buf, fileName: fileName(s, eff) };
}

(async()=>{
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const body=new URLSearchParams({client_id:process.env.GRAPH_CLIENT_ID,client_secret:process.env.GRAPH_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'});
  const tok=(await axios.post(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,body.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'}})).data.access_token;
  const auth={Authorization:`Bearer ${tok}`};
  const G=p=>axios.get(`https://graph.microsoft.com/v1.0${p}`,{headers:auth}).then(r=>r.data);
  const u=new URL(SITE_URL); const site=await G(`/sites/${u.hostname}:${u.pathname.replace(/\/+$/,'')}`);
  const drives=await G(`/sites/${site.id}/drives`); const driveId=drives.value.find(d=>norm(d.name)==='documents').id;
  const listDocx=async f=>{try{const k=await G(`/drives/${driveId}/root:/${encP(f)}:/children`);return k.value;}catch(e){if(e.response?.status===404)return null;throw e;}};

  console.log(`\nMODE: ${EXECUTE?'*** EXECUTE ***':'dry-run'} | Drive resolved | regeneration: local python\n`+'='.repeat(90));
  const results=[];
  for(const t of TARGETS){
    const r={id:t.id,status:'',detail:''};
    try{
      const {data:s,error:sErr}=await supabase.from('submissions').select('id,property,project_name,service_period,date_needed,created_at,template_type,menu_type,orientation,size,raw_payload,approved_menu_content,approved_menu_content_html').eq('id',t.id).single();
      if(sErr||!s){r.status='ERROR';r.detail=`submission load failed: ${sErr?.message||'not found'}`;results.push(r);continue;}
      const {data:ex}=await supabase.from('assets').select('id').eq('submission_id',t.id).eq('asset_type','sharepoint_approved_docx').limit(1);
      if(ex&&ex.length){r.status='SKIP';r.detail=`already has asset`;results.push(r);continue;}
      const {buf,fileName:fn}=await regenerate(s);
      const isDocx=buf.slice(0,2).toString()==='PK';
      const folder=`${BASE}/${t.folder}`;
      const storagePath=`${folder}/${fn}`;
      r.detail=`[${s.service_period}] ${s.project_name}\n     -> ${t.folder}/${fn}  (${(buf.length/1024).toFixed(0)} KB${isDocx?'':' !!NOT DOCX'})`;
      const kids=await listDocx(folder);
      const sameName=Array.isArray(kids)?kids.find(x=>x.file&&x.name===fn):null;
      if(!isDocx){r.status='FAIL';results.push(r);continue;}
      if(kids===null){r.detail+=`\n     target subfolder MISSING in Teams`;}
      else{r.detail+=`\n     folder has ${kids.filter(x=>x.file).length} file(s)${sameName?' | would archive same-name to old/':''}`;}

      if(!EXECUTE){r.status=kids===null?'FOLDER_MISSING':'READY';results.push(r);continue;}

      if(kids===null){r.status='FAIL';r.detail+=`\n     skipped: subfolder does not exist`;results.push(r);continue;}
      if(sameName){
        let oldF;try{oldF=await G(`/drives/${driveId}/root:/${encP(folder+'/old')}`);}catch(e){if(e.response?.status===404){const par=await G(`/drives/${driveId}/root:/${encP(folder)}`);oldF=await axios.post(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${par.id}/children`,{name:'old',folder:{}},{headers:{...auth,'Content-Type':'application/json'}}).then(x=>x.data);}else throw e;}
        await axios.patch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${sameName.id}`,{parentReference:{id:oldF.id},name:fn.replace(/\.docx$/i,`_archived_${Date.now()}.docx`)},{headers:{...auth,'Content-Type':'application/json'}});
      }
      const put=await axios.put(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encP(storagePath)}:/content`,buf,{headers:{...auth,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},maxBodyLength:Infinity});
      const {error:aErr}=await supabase.from('assets').insert({submission_id:t.id,asset_type:'sharepoint_approved_docx',source:'sharepoint_graph',storage_provider:'sharepoint',storage_path:storagePath,file_name:fn,meta:{site_id:site.id,drive_id:driveId,web_url:put.data?.webUrl||null,matched_folder:t.folder,archived_docx_count:sameName?1:0,backfilled:true,source_bypass:true}});
      r.status=aErr?'UPLOADED_NO_ASSET':'DONE';r.detail+=`\n     uploaded${sameName?' (archived prior)':''}${aErr?` | asset FAILED ${aErr.message}`:' + asset recorded'}`;
      results.push(r);
    }catch(e){r.status='ERROR';r.detail+=`\n     ${e.response?.status||''} ${JSON.stringify(e.response?.data?.error||e.message||e.stderr||'').slice(0,220)}`;results.push(r);}
  }
  console.log('');
  for(const r of results) console.log(`[${r.status}] ${r.detail}\n`);
  console.log('='.repeat(90));
  console.log('TALLY:',JSON.stringify(results.reduce((m,r)=>{m[r.status]=(m[r.status]||0)+1;return m;},{})));
  if(!EXECUTE) console.log('\nDry run. Re-run with --execute to upload.');
})().catch(e=>{console.error('FATAL',e.response?.status,e.message);process.exit(1);});
