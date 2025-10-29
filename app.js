async function loadSharedFiles() {
  const [rules, schema, branding] = await Promise.all([
    fetch('../shared/rules.json').then(r => r.json()),
    fetch('../shared/schema.json').then(r => r.json()),
    fetch('../shared/branding.json').then(r => r.json())
  ]);
  window.shared = { rules, schema, branding };
  document.title = branding.appName + ' – ' + branding.tagline;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', branding.primaryColor);
}
loadSharedFiles();
/* Smart Scan for Truckers - client-only prototype  
 * - Tesseract.js for OCR  
 * - pdf.js for PDF rasterization  
 * - Rule-based parsing → rows  
 * - Rollups daily/weekly/monthly  
 * - Export CSV/XLSX  
 * - LocalStorage persistence  
 */  
const $ = s => document.querySelector(s);  
const $$ = s => Array.from(document.querySelectorAll(s));  
  
const defaultRules = [  
  { pattern: "(gross\\s*(pay|revenue)|linehaul|settlement total)", category: "Gross Revenue", type: "Revenue", notes: "Main revenue" },  
  { pattern: "(fuel\\s*(charge|deduction)|diesel|comdata)", category: "Fuel", type: "Deduction", notes: "Fuel costs" },  
  { pattern: "(insurance|bobtail|occupational)", category: "Insurance", type: "Deduction", notes: "" },  
  { pattern: "(maintenance|repair|shop|tire)", category: "Maintenance", type: "Deduction", notes: "" },  
  { pattern: "(lumper|unload)", category: "Lumper", type: "Deduction", notes: "" },  
  { pattern: "(advance|cash advance)", category: "Advance", type: "Deduction", notes: "" },  
  { pattern: "(detention|layover)", category: "Accessorial", type: "Revenue", notes: "" },  
  { pattern: "(toll|ezpass)", category: "Tolls", type: "Deduction", notes: "" },  
  { pattern: "(escrow|holdback|lease payment)", category: "Escrow/Lease", type: "Deduction", notes: "" },  
  { pattern: "(bonus|incentive)", category: "Bonus", type: "Revenue", notes: "" }  
];  
  
let state = {  
  rules: loadJSON("sst_rules", defaultRules),  
  rows: loadJSON("sst_rows", []),  
};  
  
// DOM refs  
const rulesBody = $("#rulesBody");  
const runOcrBtn = $("#runOcr");  
const fileInput = $("#fileInput");  
const fileList = $("#fileList");  
const dataHead = $("#dataHead");  
const dataBody = $("#dataBody");  
const rollupsDiv = $("#rollups");  
const progressBar = $("#bar");  
const yearSpan = $("#year");  
yearSpan.textContent = new Date().getFullYear();  
  
// PWA install  
let deferredPrompt;  
const installBtn = $("#installBtn");  
window.addEventListener('beforeinstallprompt', (e) => {  
  e.preventDefault();  
  deferredPrompt = e;  
  installBtn.hidden = false;  
});  
installBtn?.addEventListener('click', async () => {  
  if (deferredPrompt) {  
    deferredPrompt.prompt();  
    await deferredPrompt.userChoice;  
    deferredPrompt = null;  
    installBtn.hidden = true;  
  }  
});  
  
// Render rules  
function renderRules(){  
  rulesBody.innerHTML = "";  
  state.rules.forEach((r, i) => {  
    const tr = document.createElement("tr");  
    tr.innerHTML = `  
      <td><input type="text" value="${escapeHtml(r.pattern)}" data-k="pattern" data-i="${i}"></td>  
      <td>  
        <input type="text" value="${escapeHtml(r.category)}" data-k="category" data-i="${i}">  
      </td>  
      <td>  
        <select data-k="type" data-i="${i}">  
          <option ${r.type==="Revenue"?"selected":""}>Revenue</option>  
          <option ${r.type==="Deduction"?"selected":""}>Deduction</option>  
        </select>  
      </td>  
      <td><input type="text" value="${escapeHtml(r.notes||"")}" data-k="notes" data-i="${i}"></td>  
      <td><button class="btn danger" data-del="${i}">✕</button></td>  
    `;  
    rulesBody.appendChild(tr);  
  });  
}  
renderRules();  
  
rulesBody.addEventListener("input", (e)=>{  
  const i = e.target.dataset.i;  
  const k = e.target.dataset.k;  
  if (i==null || !k) return;  
  state.rules[i][k] = e.target.value;  
  saveJSON("sst_rules", state.rules);  
});  
  
rulesBody.addEventListener("click", (e)=>{  
  if (e.target.dataset.del != null){  
    const i = Number(e.target.dataset.del);  
    state.rules.splice(i,1);  
    saveJSON("sst_rules", state.rules);  
    renderRules();  
  }  
});  
  
$("#addRule").addEventListener("click", ()=>{  
  state.rules.push({pattern:"", category:"Custom", type:"Revenue", notes:""});  
  saveJSON("sst_rules", state.rules);  
  renderRules();  
});  
  
$("#saveRules").addEventListener("click", ()=>{  
  saveJSON("sst_rules", state.rules);  
  alert("Rules saved");  
});  
  
$("#resetRules").addEventListener("click", ()=>{  
  if (confirm("Reset to default rules?")){  
    state.rules = JSON.parse(JSON.stringify(defaultRules));  
    saveJSON("sst_rules", state.rules);  
    renderRules();  
  }  
});  
  
// Files list  
fileInput.addEventListener("change", ()=>{  
  fileList.innerHTML = "";  
  Array.from(fileInput.files||[]).forEach(f=>{  
    const div = document.createElement("div");  
    div.textContent = `• ${f.name} (${Math.round(f.size/1024)} KB)`;  
    fileList.appendChild(div);  
  });  
});  
  
// OCR flow  
$("#runOcr").addEventListener("click", async()=>{  
  const files = Array.from(fileInput.files||[]);  
  if (files.length===0) { alert("Please add at least one file."); return; }  
  setProgress(0);  
  const allTexts = [];  
  let processed = 0;  
  
  for (const f of files){  
    if (f.type==="application/pdf"){  
      const texts = await ocrPdf(f, (p)=> setProgress((processed + p)*100/files.length));  
      allTexts.push(...texts);  
    } else {  
      const text = await ocrImage(f, (p)=> setProgress((processed + p)*100/files.length));  
      allTexts.push(text);  
    }  
    processed += 1;  
  }  
  setProgress(100);  
  
  const merged = $("#mergePages").checked ? [allTexts.join("\n")] : allTexts;  
  const newRows = merged.flatMap(t => parseSettlement(t));  
  state.rows = [...state.rows, ...newRows];  
  saveJSON("sst_rows", state.rows);  
  renderTable();  
  renderRollups();  
});  
  
function setProgress(pct){  
  progressBar.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + "%";  
}  
  
// OCR helpers  
async function ocrImage(file, onProgress){  
  const worker = await Tesseract.createWorker('eng', 1);  
  const res = await worker.recognize(file, { logger: m => {  
    if (m.status==='recognizing text' && onProgress) onProgress(m.progress*100);  
  }});  
  await worker.terminate();  
  return res.data.text || "";  
}  
  
async function ocrPdf(file, onProgress){  
  const arrayBuffer = await file.arrayBuffer();  
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });  
  const pdf = await loadingTask.promise;  
  const texts = [];  
  for (let pageNum=1; pageNum<=pdf.numPages; pageNum++){  
    const page = await pdf.getPage(pageNum);  
    const viewport = page.getViewport({ scale: 2.0 });  
    const canvas = document.createElement('canvas');  
    const ctx = canvas.getContext('2d');  
    canvas.width = viewport.width;  
    canvas.height = viewport.height;  
    await page.render({ canvasContext: ctx, viewport }).promise;  
    const blob = await new Promise(res=> canvas.toBlob(res, 'image/png', 0.92));  
    const text = await ocrImage(blob, (p)=>{  
      if (onProgress) onProgress(((pageNum-1)+p/100)*100/pdf.numPages);  
    });  
    texts.push(text);  
  }  
  return texts;  
}  
  
// Parsing logic  
function parseSettlement(text){  
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);  
  const rows = [];  
  for (const line of lines){  
    const amount = findAmount(line);  
    if (amount==null) continue;  
  
    const date = findDate(line) || guessDateFromText(text) || todayISO();  
    const {category, type} = classifyLine(line, state.rules);  
  
    const load = findLoad(line);  
    const miles = findMiles(line);  
  
    rows.push({  
      date, description: line, type, category, amount, load, miles  
    });  
  }  
  return rows;  
}  
  
function classifyLine(line, rules){  
  for (const r of rules){  
    try {  
      const re = new RegExp(r.pattern, 'i');  
      if (re.test(line)){  
        return { category: r.category || "Uncategorized", type: r.type || "Revenue" };  
      }  
    } catch(e){ /* bad regex */ }  
  }  
  const amt = findAmount(line) ?? 0;  
  return { category: "Uncategorized", type: amt < 0 ? "Deduction" : "Revenue" };  
}  
  
function findAmount(line){  
  const m = line.match(/([\-+]?\$?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d{2})|\$?\s*\d+(?:\.\d{2}))/);  
  if (!m) return null;  
  const raw = m[1].replace(/\$|\s|,/g,'');  
  const val = parseFloat(raw);  
  if (isNaN(val)) return null;  
  const negative = /\(|\bcr\b/i.test(line) ? -1 : 1;  
  return negative * val;  
}  
  
function findDate(line){  
  const m = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);  
  if (!m) return null;  
  const mm = m[1].padStart(2,'0');  
  const dd = m[2].padStart(2,'0');  
  const yy = m[3].length===2 ? ('20'+m[3]) : m[3];  
  return `${yy}-${mm}-${dd}`;  
}  
function guessDateFromText(text){  
  const m = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);  
  if (!m) return null;  
  const mm = m[1].padStart(2,'0');  
  const dd = m[2].padStart(2,'0');  
  const yy = m[3].length===2 ? ('20'+m[3]) : m[3];  
  return `${yy}-${mm}-${dd}`;  
}  
function todayISO(){  
  const d = new Date();  
  return d.toISOString().slice(0,10);  
}  
function findLoad(line){  
  const m = line.match(/\b(load|pro|ref|bol|invoice)\s*#?\s*([A-Z0-9\-]{4,})/i);  
  return m ? m[2] : "";  
}  
function findMiles(line){  
  const m = line.match(/\b(\d{2,5})\s*(mi|miles)\b/i);  
  return m ? Number(m[1]) : "";  
}  
  
// Render table  
const columns = ["date","description","type","category","amount","load","miles"];  
function renderTable(){  
  dataHead.innerHTML = "";  
  columns.forEach(c => {  
    const th = document.createElement("th");  
    th.textContent = c.toUpperCase();  
    dataHead.appendChild(th);  
  });  
  dataBody.innerHTML = "";  
  state.rows.forEach((row, idx) => {  
    const tr = document.createElement("tr");  
    columns.forEach(c => {  
      const td = document.createElement("td");  
      td.contentEditable = "true";  
      td.dataset.idx = idx;  
      td.dataset.col = c;  
      td.textContent = (c==="amount" && typeof row[c]==="number") ? row[c].toFixed(2) : (row[c] ?? "");  
      tr.appendChild(td);  
    });  
    dataBody.appendChild(tr);  
  });  
}  
renderTable();  
  
dataBody.addEventListener("input", (e)=>{  
  const idx = Number(e.target.dataset.idx);  
  const col = e.target.dataset.col;  
  if (col==="amount"){  
    const v = parseFloat(e.target.textContent.replace(/[^0-9\.\-]/g,''));  
    state.rows[idx][col] = isNaN(v) ? 0 : v;  
  } else {  
    state.rows[idx][col] = e.target.textContent;  
  }  
  saveJSON("sst_rows", state.rows);  
  renderRollups();  
});  
  
// Rollups  
function renderRollups(){  
  const rows = state.rows;  
  const byDay = groupBy(rows, r=>r.date);  
  const byWeek = groupBy(rows, r=>isoWeek(r.date));  
  const byMonth = groupBy(rows, r=>r.date?.slice(0,7));  
  
  const box = (title, totals) => {  
    const revenue = (totals.Revenue||0).toFixed(2);  
    const deduction = (totals.Deduction||0).toFixed(2);  
    const net = (totals.Net||0).toFixed(2);  
    return `<div class="card" style="background:#0f0f0f;border-color:#1d1d1d;margin:8px 0">  
      <strong>${title}</strong>  
      <div>Revenue: $${revenue} <span class="badge">+</span></div>  
      <div>Deductions: $${deduction} <span class="badge">−</span></div>  
      <div>Net: $${net} <span class="badge">=</span></div>  
    </div>`;  
  };  
  
  const roll = groupTotals => Object.entries(groupTotals).map(([k, rows]) => {  
    const totals = sumRows(rows);  
    return box(k, totals);  
  }).join("");  
  
  rollupsDiv.innerHTML = `  
    <h4>Daily</h4>${roll(byDay)}  
    <h4>Weekly</h4>${roll(byWeek)}  
    <h4>Monthly</h4>${roll(byMonth)}  
  `;  
}  
renderRollups();  
  
function sumRows(rows){  
  const rev = rows.filter(r=>r.type==="Revenue").reduce((a,b)=>a + (Number(b.amount)||0),0);  
  const ded = rows.filter(r=>r.type==="Deduction").reduce((a,b)=>a + (Number(b.amount)||0),0);  
  return { Revenue: rev, Deduction: Math.abs(ded), Net: rev - Math.abs(ded) };  
}  
  
function groupBy(arr, keyFn){  
  const m = {};  
  for (const item of arr){  
    const k = keyFn(item) || "Unknown";  
    (m[k] ||= []).push(item);  
  }  
  return m;  
}  
  
function isoWeek(isoDate){  
  const d = new Date(isoDate);  
  if (isNaN(d)) return "Unknown";  
  d.setHours(0,0,0,0);  
  d.setDate(d.getDate() + 3 - (d.getDay()+6)%7);  
  const week1 = new Date(d.getFullYear(),0,4);  
  const week = 1+Math.round(((d.getTime()-week1.getTime())/86400000 - 3 + (week1.getDay()+6)%7)/7);  
  const yyyy = d.getFullYear();  
  return `${yyyy}-W${String(week).padStart(2,'0')}`;  
}  
  
// Export  
$("#exportCsv").addEventListener("click", ()=>{  
  const csv = Papa.unparse(state.rows);  
  download("smart-scan.csv", new Blob([csv], {type:"text/csv"}));  
});  
$("#exportXlsx").addEventListener("click", ()=>{  
  const wb = XLSX.utils.book_new();  
  const ws = XLSX.utils.json_to_sheet(state.rows);  
  XLSX.utils.book_append_sheet(wb, ws, "Data");  
  const rolls = computeRollupsForSheet();  
  const ws2 = XLSX.utils.json_to_sheet(rolls);  
  XLSX.utils.book_append_sheet(wb, ws2, "Rollups");  
  const out = XLSX.write(wb, {bookType:"xlsx", type:"array"});  
  download("smart-scan.xlsx", new Blob([out], {type:"application/octet-stream"}));  
});  
  
function computeRollupsForSheet(){  
  const rows = state.rows;  
  const add = (arr, label) => {  
    const entries = Object.entries(arr).map(([k, list])=>{  
      const t = sumRows(list);  
      return { Period: `${label}: ${k}`, Revenue: t.Revenue, Deductions: t.Deduction, Net: t.Net };  
    });  
    return entries.sort((a,b)=> String(a.Period).localeCompare(String(b.Period)));  
  }  
  return [  
    ...add(groupBy(rows, r=>r.date), "Day"),  
    ...add(groupBy(rows, r=>isoWeek(r.date)), "Week"),  
    ...add(groupBy(rows, r=>r.date?.slice(0,7)), "Month"),  
  ];  
}  
  
// Clear  
$("#clearData").addEventListener("click", ()=>{  
  if (!confirm("This will remove OCR results from this browser.")) return;  
  state.rows = [];  
  saveJSON("sst_rows", state.rows);  
  renderTable();  
  renderRollups();  
});  
  
// Utils  
function loadJSON(key, fallback){  
  try {  
    const raw = localStorage.getItem(key);  
    return raw ? JSON.parse(raw) : fallback;  
  } catch(e){ return fallback; }  
}  
function saveJSON(key, val){  
  localStorage.setItem(key, JSON.stringify(val));  
}  
function escapeHtml(s){  
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));  
}  
function download(name, blob){  
  const a = document.createElement('a');  
  a.href = URL.createObjectURL(blob);  
  a.download = name;  
  a.click();  
  URL.revokeObjectURL(a.href);  
}  
