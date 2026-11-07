'use strict';
const $ = id => document.getElementById(id);
const svg = id => `<svg aria-hidden="true"><use href="#i-${id}"></use></svg>`;
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state = { jobs: [], config: null, convertingId:null, uploadingId:null, busy:false };
const labels = {processing:'Converting',ready:'Ready',uploading:'Uploading',pending:'Pending',approved:'Approved',rejected:'Rejected',error:'Failed',expired:'Expired'};
const allowedForUpload = new Set(['mp3','ogg','wav']);
const dateFmt = value => { try { return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)); } catch { return '-'; } };
const numFmt = n => Number.isFinite(n) ? `${(n/(1024*1024)).toFixed(1)} MB` : '—';
function toast(msg) {
  const box=document.createElement('div');box.className='toast';box.textContent=msg;
  $('toasts').appendChild(box);
  setTimeout(()=>box.remove(),5600);
}
async function api(url,options={}) {
  let res;
  try { res=await fetch(url,{cache:'no-store',...options}); }
  catch { throw new Error('Tidak dapat terhubung ke server. Coba muat ulang halaman.'); }
  let data; try {data=await res.json();} catch {throw new Error(`Respons server tidak valid (HTTP ${res.status}).`);}
  if(!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
  return data;
}
function fillArt() {
  const bars=$('art-bars');
  for(let i=0;i<41;i++){
    const el=document.createElement('i');
    const h=15+Math.round(77*Math.abs(Math.sin(i*.32)*Math.cos(i*.17))+15*Math.abs(Math.sin(i*.97)));
    el.style.height=`${h}px`;el.style.animationDelay=`${i*42}ms`;bars.appendChild(el);
  }
}
function fileLabel(inputId,labelId,emptyLabel) {
  const input=$(inputId),label=$(labelId);
  label.textContent=input.files?.[0]?.name || emptyLabel;
  if(inputId==='convert-file' && input.files?.length) $('source-url').value='';
}
function enableDropzone(zoneId,inputId, labelId,placeholder) {
  const z=$(zoneId), input=$(inputId);
  input.addEventListener('change',()=>fileLabel(inputId,labelId,placeholder));
  for (const event of ['dragenter','dragover']) z.addEventListener(event,e=>{e.preventDefault();z.classList.add('dragover');});
  for (const event of ['dragleave','drop']) z.addEventListener(event,e=>{e.preventDefault();z.classList.remove('dragover');});
  z.addEventListener('drop',e=>{
    if(!e.dataTransfer?.files?.length)return;
    const transfer=new DataTransfer(); transfer.items.add(e.dataTransfer.files[0]);
    input.files=transfer.files;
    fileLabel(inputId,labelId,placeholder);
    if(inputId==='upload-file') $('upload-source').value='file';
  });
}
function setRange(id,output,fmt) {
  const input=$(id); const update=()=>{ $(output).value=fmt(Number(input.value));};
  input.addEventListener('input',update);update();
}
function selectedLatestConvert() {
  return state.jobs.find(j => j.type==='convert' && j.state==='ready' && j.downloadable && allowedForUpload.has(j.format));
}
function renderSourceOptions() {
  const s=$('upload-source'), previous=s.value;
  s.replaceChildren();
  const base=new Option('Upload file dari komputer','file');s.add(base);
  for (const j of state.jobs.filter(j=>j.type==='convert'&&j.state==='ready'&&j.downloadable&&allowedForUpload.has(j.format)).slice(0,15)) {
    s.add(new Option(`Converted · ${j.title.slice(0,37)} (${j.format.toUpperCase()})`, j.id));
  }
  s.value=Array.from(s.options).some(o=>o.value===previous)?previous:'file';
  updateSourceVisual();
}
function updateSourceVisual(){
  const fromJob=$('upload-source').value!=='file';
  $('upload-file-zone').classList.toggle('hidden',fromJob);
  $('upload-file-zone').style.display=fromJob?'none':'flex';
}
function result(containerId,job) {
  const box=$(containerId);
  if(!job) { box.classList.add('hidden');return; }
  box.classList.remove('hidden');
  let buttons='';
  if(job.type==='convert' && job.downloadable && job.state==='ready') {
    buttons=`<a class="small-button" href="/api/jobs/${encodeURIComponent(job.id)}/download">${svg('download')} Download audio</a><button type="button" class="small-button" data-use="${escapeHtml(job.id)}">${svg('upload')} Use for upload</button>`;
  }
  if(job.assetId) buttons += `<button type="button" class="small-button" data-copy="${escapeHtml(job.assetId)}">${svg('file')} Copy Asset ID</button>`;
  if(job.type==='upload' && job.state==='pending') buttons += `<button class="small-button" type="button" data-refresh="${escapeHtml(job.id)}">${svg('refresh')} Check status</button>`;
  box.innerHTML=`<div class="result-header">${svg(job.state==='error'||job.state==='rejected'?'circle':job.state==='approved'||job.state==='ready'?'check':'clock')} <span>${escapeHtml(labels[job.state]||job.state)} · ${escapeHtml(job.title)}</span></div><p>${escapeHtml(job.message||'')}</p>${job.assetId?`<p>Asset ID: <strong>${escapeHtml(job.assetId)}</strong></p>`:''}${buttons?`<div class="result-actions">${buttons}</div>`:''}`;
}
function renderJobs() {
  const body=$('jobs-body');
  if (!state.jobs.length) {
    body.innerHTML=`<tr><td colspan="5"><div class="empty-state">${svg('headphones')}<strong>Belum ada aktivitas</strong><span>Hasil konversi dan upload akan muncul di sini.</span></div></td></tr>`;
  } else {
    body.innerHTML=state.jobs.map(j => {
      let actions='';
      if(j.downloadable&&j.state==='ready') actions+=`<a class="mini-action" href="/api/jobs/${encodeURIComponent(j.id)}/download" aria-label="Unduh audio" title="Download">${svg('download')}</a>`;
      if(j.type==='convert' && j.downloadable && allowedForUpload.has(j.format)) actions+=`<button class="mini-action" data-use="${escapeHtml(j.id)}" title="Gunakan untuk upload" aria-label="Upload hasil konversi">${svg('upload')}</button>`;
      if(j.assetId) actions+=`<button class="mini-action" data-copy="${escapeHtml(j.assetId)}" title="Salin Asset ID" aria-label="Salin Asset ID">${svg('file')}</button>`;
      if(j.type==='upload' && j.state==='pending') actions+=`<button class="mini-action" data-refresh="${escapeHtml(j.id)}" title="Cek status sekarang" aria-label="Cek status">${svg('refresh')}</button>`;
      return `<tr title="${escapeHtml(j.message)}"><td><strong class="asset-title">${escapeHtml(j.title)}</strong><span class="asset-subtitle">${j.assetId?'ID: '+escapeHtml(j.assetId):j.type==='convert'?escapeHtml((j.format||'').toUpperCase())+(j.size?' · '+numFmt(j.size):''):'Roblox Creator API'}</span></td><td><span class="type-tag">${j.type==='convert'?'Convert':'Upload'}</span></td><td>${escapeHtml(dateFmt(j.createdAt))}</td><td><span class="state ${escapeHtml(j.state)}">${escapeHtml(labels[j.state]||j.state)}</span></td><td><div class="action-group">${actions||'<span class="asset-subtitle">—</span>'}</div></td></tr>`;
    }).join('');
  }
  renderSourceOptions();
  result('convert-result',state.jobs.find(j=>j.id===state.convertingId));
  result('upload-result',state.jobs.find(j=>j.id===state.uploadingId));
}
async function loadJobs({quiet=true}={}) {
  try {
    const data=await api('/api/jobs');
    state.jobs=data.jobs||[];
    renderJobs();
    if(!quiet)toast('Status berhasil diperbarui.');
  } catch(e) {if(!quiet)toast(e.message);}
}
async function loadConfig() {
  try {
    const c=await api('/api/config');state.config=c;
    $('connection').classList.toggle('online',c.robloxConfigured);
    $('connection').classList.toggle('offline',!c.robloxConfigured);
    $('connection-label').textContent=c.robloxConfigured?'Roblox API Configured':'Roblox Not Configured';
    $('api-note').classList.toggle('online',c.robloxConfigured);
    $('api-note').classList.toggle('offline',!c.robloxConfigured);
    $('api-note').querySelector('span:last-child').textContent=c.robloxConfigured?'Kredensial tersimpan. Akses diverifikasi Roblox saat upload pertama.':'API key belum disetel. Isi file .env untuk mengaktifkan upload.';
    $('creator-owner').textContent=c.robloxConfigured?`${c.creatorType==='group'?'Group':'User'} #${c.creatorId}`:'Belum terhubung';
    if(!c.tools.ffmpeg || !c.tools.ffprobe) toast('FFmpeg / FFprobe belum tersedia. Konversi audio membutuhkan keduanya.');
    if(!c.tools['yt-dlp']) $('source-url').placeholder='Install yt-dlp untuk URL YouTube/SoundCloud';
    $('upload-submit').disabled=!c.robloxConfigured;
  } catch(e) {
    $('connection-label').textContent='Server Offline';
    $('connection').classList.add('offline');
    $('api-note').querySelector('span:last-child').textContent='Server tidak terhubung.';
    $('upload-submit').disabled=true;
    toast(e.message);
  }
}
function useForUpload(id) {
  const job=state.jobs.find(j=>j.id===id);
  if(!job||!job.downloadable||!allowedForUpload.has(job.format)) return toast('File hasil konversi tidak tersedia untuk upload.');
  $('upload-source').value=id;
  $('upload-name').value=job.title.slice(0,60);
  updateSourceVisual();
  $('upload').scrollIntoView({behavior:'smooth',block:'start'});
  toast('Hasil konversi telah dipilih sebagai sumber upload.');
}
async function refreshOne(id) {
  try { await api(`/api/jobs/${encodeURIComponent(id)}/refresh`,{method:'POST'}); await loadJobs(); }
  catch(e){ toast(e.message); }
}
async function delegate(e) {
  const use=e.target.closest('[data-use]');
  if(use) {useForUpload(use.dataset.use);return;}
  const refresh=e.target.closest('[data-refresh]');
  if(refresh) { await refreshOne(refresh.dataset.refresh);return; }
  const copy=e.target.closest('[data-copy]');
  if(copy) {try {await navigator.clipboard.writeText(copy.dataset.copy);toast('Asset ID disalin.');}catch {toast(`Asset ID: ${copy.dataset.copy}`);} }
}
async function convert(e) {
  e.preventDefault();
  const btn=$('convert-submit');if(btn.disabled)return;
  const file=$('convert-file').files[0],url=$('source-url').value.trim();
  if(!file && !url) return toast('Masukkan URL atau pilih audio dari komputer.');
  const fd=new FormData($('convert-form'));
  if(file)fd.delete('url');else fd.delete('audio');
  btn.disabled=true;btn.querySelector('span').textContent='Submitting...';
  try {
    const data=await api('/api/convert',{method:'POST',body:fd});
    state.convertingId=data.job.id;
    toast('Konversi dimulai. Hasil akan muncul otomatis.');
    await loadJobs();
  }catch(err){toast(err.message);}
  finally{btn.disabled=false;btn.querySelector('span').textContent='Convert Audio';}
}
async function upload(e){
  e.preventDefault();
  const btn=$('upload-submit');if(btn.disabled)return;
  const fd=new FormData($('upload-form'));
  const selection=$('upload-source').value;
  if(selection!=='file') {fd.set('jobId',selection);fd.delete('audio');}
  else if(!$('upload-file').files?.[0]) return toast('Pilih file audio atau hasil konversi dahulu.');
  btn.disabled=true;btn.querySelector('span').textContent='Submitting...';
  try {
    const data=await api('/api/upload',{method:'POST',body:fd});
    state.uploadingId=data.job.id;
    toast('Proses upload ke Roblox dimulai.');
    await loadJobs();
  }catch(err){toast(err.message);}
  finally{btn.disabled=!state.config?.robloxConfigured;btn.querySelector('span').textContent='Upload to Roblox';}
}
$('source-url').addEventListener('input',()=>{
  if($('source-url').value.trim() && $('convert-file').files.length) {
    $('convert-file').value='';fileLabel('convert-file','convert-file-label','Klik atau tarik file audio ke sini');
  }
});
fillArt();
setRange('speed','speed-value',x=>x.toFixed(2)+'×');
setRange('gain','gain-value',x=>`${x>0?'+':''}${x} dB`);
enableDropzone('convert-dropzone','convert-file','convert-file-label','Klik atau tarik file audio ke sini');
enableDropzone('upload-file-zone','upload-file','upload-file-label','Choose an audio file');
$('upload-source').addEventListener('change',updateSourceVisual);
$('convert-form').addEventListener('submit',convert);
$('upload-form').addEventListener('submit',upload);
$('refresh-jobs').addEventListener('click',()=>loadJobs({quiet:false}));
document.addEventListener('click',delegate);
void loadConfig();void loadJobs();
setInterval(()=>void loadJobs(),12000);
