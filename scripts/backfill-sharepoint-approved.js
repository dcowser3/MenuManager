#!/usr/bin/env node
/**
 * One-time backfill: push approved menus that never went through the live
 * approval flow (ClickUp history imports + the 7/13/26 storage-incident
 * restore) up to SharePoint/Teams, and record a sharepoint_approved_docx asset.
 *
 * Regeneration is done by the PRODUCTION dashboard's clean-download route
 * (regenerates the clean DOCX from the approved content stored in Supabase).
 * Upload targets the live Toro2 SharePoint; the asset row is written to prod
 * Supabase. Nothing here modifies the running services.
 *
 * SAFE BY DEFAULT: dry-run unless --execute is passed.
 *
 *   node scripts/backfill-sharepoint-approved.js            # dry run
 *   node scripts/backfill-sharepoint-approved.js --execute  # perform uploads
 *
 * Archive policy: before overwriting, an existing file with the SAME target
 * name is moved into old/ (never deleted). Other distinct files in a shared
 * folder (e.g. Holidays & Events) are left untouched.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const EXECUTE = process.argv.includes('--execute');
const DASH_URL = (process.env.BACKFILL_DASHBOARD_URL || 'https://sandovalhospitalitymenumanager.live').replace(/\/$/, '');
const SITE_URL = 'https://richardsandoval.sharepoint.com/sites/Toro2';
const LIBRARY = 'Shared Documents';
const BASE = 'Toro by Chef Richard Sandoval/Marketing - Locations/Chicago/Menus';

// Seasonal service periods without a dedicated Chicago folder -> route into Holidays & Events.
const FOLDER_OVERRIDE = { 'restaurant week': 'Holidays & Events', 'thanksgiving': 'Holidays & Events', "valentine's day": 'Holidays & Events' };

// The 10 submissions to backfill (Beverage deduped to the latest 6/30 update;
// the 6/23 dup and the Jan-Feb full menu are intentionally excluded).
const TARGET_IDS = [
  '81778696-9277-42b9-b94f-b6e19ecc576e', // Beverage 6/30
  'd3883cf5-f9ba-437e-86d0-724f94e7c994', // Brunch (Mother's Day)
  'db336d72-8d5a-459b-9bb4-0062806c1eb9', // Dessert
  '6fe50393-2a65-4629-ac96-61f6e58a1df0', // Dinner (Viva Abejas)
  '3aab75d9-dc15-4bcd-bb46-01f4f7bbb273', // Happy Hour
  'e7bb2074-d0d4-4c55-8f60-b17de1579b06', // Holidays & Events (Wine List)
  'fe9b3ca4-6be7-4222-b7c4-852ea940b0f7', // Lunch
  'dad2906a-2ee4-43d2-95bb-2fc902319b53', // Restaurant Week -> Holidays & Events
  '687b4a11-0c5e-4539-9999-ea419a9caa34', // Thanksgiving -> Holidays & Events
  '0cbc8fe5-2c17-4fe2-a56b-0b6d3d1827a1', // Valentine's Day -> Holidays & Events
];

// --- filename helpers (mirror services/clickup-integration/lib/sharepoint-filenames.ts) ---
function sani(v){return String(v||'').trim().replace(/[\\/:*?"<>|#%]+/g,' ').replace(/\s+/g,' ').trim();}
function titleCase(v){return v.toLowerCase().split(/\s+/).filter(Boolean).map(t=>t.charAt(0).toUpperCase()+t.slice(1)).join(' ');}
function dateSeg(v){const c=`${v||''}`.trim();const m=c.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return `${+m[2]}.${+m[3]}.${m[1].slice(-2)}`;const p=c?new Date(c):new Date();const d=isNaN(p.getTime())?new Date():p;return `${d.getMonth()+1}.${d.getDate()}.${String(d.getFullYear()).slice(-2)}`;}
function fileName(s, effectiveDate){const prop=sani(String(s.property||'').split(' - ')[0]||'Menu');const rawSvc=s.service_period||'Other';const svc=sani(titleCase(String(rawSvc).replace(/_/g,' ')))||'Other';return `${prop}_${svc}_${dateSeg(effectiveDate)}.docx`;}
function norm(v){const n=String(v||'').trim().toLowerCase();return n==='shared documents'?'documents':n;}
function encP(p){return p.split('/').map(encodeURIComponent).join('/');}

async function graphToken(){
  const body=new URLSearchParams({client_id:process.env.GRAPH_CLIENT_ID,client_secret:process.env.GRAPH_CLIENT_SECRET,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'});
  const r=await axios.post(`https://login.microsoftonline.com/${process.env.GRAPH_TENANT_ID}/oauth2/v2.0/token`,body.toString(),{headers:{'Content-Type':'application/x-www-form-urlencoded'}});
  return r.data.access_token;
}

(async()=>{
  const supabase=createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_ANON_KEY);
  const token=await graphToken();
  const auth={Authorization:`Bearer ${token}`};
  const G=(p,opts={})=>axios.get(`https://graph.microsoft.com/v1.0${p}`,{headers:auth,...opts}).then(r=>r.data);

  const u=new URL(SITE_URL);
  const site=await G(`/sites/${u.hostname}:${u.pathname.replace(/\/+$/,'')}`);
  const drives=await G(`/sites/${site.id}/drives`);
  const drive=drives.value.find(d=>norm(d.name)===norm(LIBRARY));
  const driveId=drive.id;

  const listDocx=async(folder)=>{try{const k=await G(`/drives/${driveId}/root:/${encP(folder)}:/children`);return k.value.filter(x=>x.file&&/\.docx$/i.test(x.name||''));}catch(e){if(e.response?.status===404)return null;throw e;}};

  console.log(`\nMODE: ${EXECUTE?'*** EXECUTE (live writes to SharePoint + Supabase) ***':'dry-run (no writes)'}`);
  console.log(`Regeneration source: ${DASH_URL}\nDrive: ${drive.name} (${driveId})\n`+'='.repeat(90));

  const results=[];
  for(const id of TARGET_IDS){
    const rec={id,status:'',detail:''};
    try{
      const {data:s}=await supabase.from('submissions').select('id,property,service_period,date_needed,project_name,created_at').eq('id',id).single();
      if(!s){rec.status='MISSING';rec.detail='submission not found';results.push(rec);continue;}
      const {data:existingAsset}=await supabase.from('assets').select('id').eq('submission_id',id).eq('asset_type','sharepoint_approved_docx').limit(1);
      if(existingAsset&&existingAsset.length){rec.status='SKIP';rec.detail='already has SharePoint asset';results.push(rec);continue;}

      const effectiveDate=s.date_needed||s.created_at;
      const fn=fileName(s,effectiveDate);
      const folderKey=String(s.service_period||'').trim().toLowerCase();
      const folder=`${BASE}/${FOLDER_OVERRIDE[folderKey]||s.service_period}`;
      const storagePath=`${folder}/${fn}`;
      rec.detail=`[${s.service_period}] ${s.project_name}\n     -> ${storagePath}`;

      // Regenerate clean DOCX from prod dashboard.
      const dl=await axios.get(`${DASH_URL}/download/approved-clean/${encodeURIComponent(id)}`,{responseType:'arraybuffer',timeout:60000,validateStatus:()=>true});
      if(dl.status!==200){rec.status='FAIL';rec.detail+=`\n     regeneration failed: HTTP ${dl.status} ${Buffer.from(dl.data||[]).toString().slice(0,120)}`;results.push(rec);continue;}
      const buf=Buffer.from(dl.data);
      const isDocx=buf.slice(0,2).toString()==='PK';
      if(!isDocx||buf.length<1000){rec.status='FAIL';rec.detail+=`\n     regeneration returned non-docx (${buf.length} bytes)`;results.push(rec);continue;}

      const existing=await listDocx(folder);
      const sameName=Array.isArray(existing)?existing.find(x=>x.name===fn):null;

      if(!EXECUTE){
        rec.status='READY';
        rec.detail+=`\n     regenerated OK (${(buf.length/1024).toFixed(0)} KB) | folder ${existing===null?'MISSING':`has ${existing.length} docx`}`+
                    `${sameName?` | would archive same-name file to old/`:''}`;
        results.push(rec);continue;
      }

      // --- EXECUTE ---
      if(existing===null){rec.status='FAIL';rec.detail+=`\n     target folder does not exist in SharePoint`;results.push(rec);continue;}
      if(sameName){
        // ensure old/ then move same-name file there
        let oldFolder;
        try{oldFolder=await G(`/drives/${driveId}/root:/${encP(folder+'/old')}`);}
        catch(e){if(e.response?.status===404){const parent=await G(`/drives/${driveId}/root:/${encP(folder)}`);oldFolder=await axios.post(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parent.id}/children`,{name:'old',folder:{}},{headers:{...auth,'Content-Type':'application/json'}}).then(r=>r.data);}else throw e;}
        const archivedName=fn.replace(/\.docx$/i,`_archived_${Date.now()}.docx`);
        await axios.patch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${sameName.id}`,{parentReference:{id:oldFolder.id},name:archivedName},{headers:{...auth,'Content-Type':'application/json'}});
      }
      const put=await axios.put(`https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encP(storagePath)}:/content`,buf,{headers:{...auth,'Content-Type':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'},maxBodyLength:Infinity});
      const webUrl=put.data?.webUrl||null;
      const {error:aErr}=await supabase.from('assets').insert({submission_id:id,asset_type:'sharepoint_approved_docx',source:'sharepoint_graph',storage_provider:'sharepoint',storage_path:storagePath,file_name:fn,meta:{clickup_task_id:null,site_id:site.id,drive_id:driveId,web_url:webUrl,matched_folder:FOLDER_OVERRIDE[folderKey]||s.service_period,archived_docx_count:sameName?1:0,backfilled:true}});
      if(aErr){rec.status='UPLOADED_NO_ASSET';rec.detail+=`\n     uploaded but asset insert failed: ${aErr.message}`;results.push(rec);continue;}
      rec.status='DONE';rec.detail+=`\n     uploaded${sameName?' (archived prior)':''} + asset recorded`;
      results.push(rec);
    }catch(e){rec.status='ERROR';rec.detail+=`\n     ${e.response?.status||''} ${JSON.stringify(e.response?.data?.error||e.message).slice(0,200)}`;results.push(rec);}
  }

  console.log('');
  for(const r of results) console.log(`[${r.status}] ${r.detail}\n`);
  const tally=results.reduce((m,r)=>{m[r.status]=(m[r.status]||0)+1;return m;},{});
  console.log('='.repeat(90));
  console.log('TALLY:',JSON.stringify(tally));
  if(!EXECUTE) console.log('\nDry run only. Re-run with --execute to perform the uploads.');
})().catch(e=>{console.error('FATAL',e.response?.status,JSON.stringify(e.response?.data?.error||e.message));process.exit(1);});
