'use strict';
/* =========================================================
   Muscu — logique de l'application (aucune dépendance)
   Données : localStorage, aucun envoi réseau.
   ========================================================= */

const STORAGE_KEY = 'muscu.data.v1';
const APP_FILES = ['index.html', 'style.css', 'data.js', 'app.js', 'sw.js', 'manifest.webmanifest', 'icons/icon.svg'];
const OPTIONAL_FILES = ['LISEZMOI.txt'];
const ICON_SIZES = [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]];
const STATUS_LABELS = {
  provisoire: 'Référence provisoire', estimation: 'Estimation', proposee: 'Charge proposée',
  indicatif: 'Point de départ indicatif', validee: 'Référence validée', inconnue: 'À renseigner',
  maintien: 'Charge conseillée', hausse: 'Charge proposée ↑', baisse: 'Charge proposée ↓', pdc: 'Poids du corps'
};

/* ---------- Utilitaires ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2, '0');
const mod = (n, m) => ((n % m) + m) % m;
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const roundLoad = n => Math.round(n * 100) / 100;
const fmtKg = n => n == null ? '—' : roundLoad(n).toLocaleString('fr-FR') + ' kg';
const inputNum = n => n == null ? '' : String(n).replace('.', ',');
const rirTxt = r => r >= 4 ? '4+' : String(r);

/* ---------- Dates (date locale de l'iPhone, calcul en UTC pour éviter les pièges du changement d'heure) ---------- */
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return { y, m, d }; }
function utc(iso) { const { y, m, d } = parseISO(iso); return Date.UTC(y, m - 1, d); }
function diffDays(a, b) { return Math.round((utc(b) - utc(a)) / 86400000); }
function addDays(iso, n) { return new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10); }
function isValidISO(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const { y, m, d } = parseISO(iso); const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function fmtDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) {
  const { y, m, d } = parseISO(iso); const s = new Date(y, m - 1, d).toLocaleDateString('fr-FR', opts);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const fmtShort = iso => fmtDate(iso, { day: 'numeric', month: 'short' });
function fmtDur(ms) { const m = Math.max(0, Math.floor(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`; }
function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); return `${h ? h + ':' : ''}${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }

/* ---------- Cycle ---------- */
function cycleIndexFor(iso, ref = state.settings.cycle) { return mod(ref.refIndex + diffDays(ref.refDate, iso), 7); }
function sessionTypeFor(iso, ref) { return CYCLE[cycleIndexFor(iso, ref)]; }

/* ---------- Stockage ---------- */
let storageOK = true;
let persistInfo = 'inconnu';
let pendingToast = null;

function defaultState() {
  return {
    version: 1, createdAt: new Date().toISOString(),
    settings: { cycle: { ...CYCLE_DEFAULT }, cycleLog: [], shoulderPress: { enabled: false, sets: 3, min: 8, max: 12 }, lastExport: null },
    exercises: clone(INITIAL_EXERCISES), active: null, history: []
  };
}
function validHistoryEntry(h) {
  return h && typeof h === 'object' && isValidISO(h.date) && SESSION_NAMES[h.type] && h.type !== 'rest' &&
    Array.isArray(h.items) && h.items.every(i => i && typeof i.ex === 'string' && i.entry && Array.isArray(i.entry.sets) && i.slot);
}
function migrate(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  s.version = s.version || 1;
  s.settings = Object.assign({}, d.settings, s.settings || {});
  const c = s.settings.cycle;
  if (!c || !isValidISO(c.refDate) || !Number.isInteger(c.refIndex) || c.refIndex < 0 || c.refIndex > 6) s.settings.cycle = { ...CYCLE_DEFAULT };
  s.settings.shoulderPress = Object.assign({}, d.settings.shoulderPress, s.settings.shoulderPress || {});
  if (!Array.isArray(s.settings.cycleLog)) s.settings.cycleLog = [];
  s.exercises = (s.exercises && typeof s.exercises === 'object') ? s.exercises : {};
  for (const [id, ex] of Object.entries(INITIAL_EXERCISES)) {
    const u = s.exercises[id];
    // Conserve les valeurs de l'utilisateur ; met à jour les textes fixes (nom, conseils)
    s.exercises[id] = u ? Object.assign(clone(ex), u, { name: ex.name, tips: ex.tips, equip: ex.equip, perSide: ex.perSide }) : clone(ex);
  }
  s.history = Array.isArray(s.history) ? s.history.filter(validHistoryEntry) : [];
  s.history.forEach((h, i) => { if (!h.id) h.id = 'h' + Date.now() + '_' + i; });
  if (s.active) {
    const a = s.active;
    if (!validHistoryEntry(a) || !a.items.length) s.active = null;
    else { a.index = Math.min(Math.max(0, a.index | 0), a.items.length - 1); a.elapsedMs = a.elapsedMs || 0; }
  }
  return s;
}
function loadState() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { storageOK = false; }
  if (!raw) return defaultState();
  try { return migrate(JSON.parse(raw)); }
  catch (e) {
    try { localStorage.setItem(STORAGE_KEY + '.corrompu', raw); } catch (_) { }
    pendingToast = 'Données illisibles : une copie a été conservée, l’application repart d’un état vierge.';
    return defaultState();
  }
}
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageOK = true; return true; }
  catch (e) {
    storageOK = false;
    toast('⚠️ Enregistrement impossible (' + (e && e.name === 'QuotaExceededError' ? 'stockage plein' : 'stockage indisponible') + '). Exporte tes données.', 6000);
    return false;
  }
}
async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const p = (await navigator.storage.persisted()) || (await navigator.storage.persist());
      persistInfo = p ? 'oui' : 'non garanti';
    } else persistInfo = 'non disponible';
  } catch (e) { persistInfo = 'non disponible'; }
}

let state = loadState();

/* ---------- Exercices & séances ---------- */
const FALLBACK_EX = { name: '?', equip: 'machine', increment: 2.5, refLoad: null, refStatus: 'inconnue', technique: 'ok', tips: [] };
const exOf = id => state.exercises[id] || { ...FALLBACK_EX, name: id };
const unitTxt = ex => ex.equip === 'haltere' ? ' / haltère' : (ex.perSide && ex.equip !== 'pdc' ? ' / côté' : '');
const repsTxt = s => s.min === s.max ? `${s.min}` : `${s.min}–${s.max}`;
function setsRepsTxt(s, ex) {
  const sets = s.minSets && s.minSets < s.sets ? `${s.minSets}–${s.sets}` : `${s.sets}`;
  return `${sets} × ${repsTxt(s)}${ex.perSide ? ' / côté' : ''}`;
}
function slotsFor(type) {
  return (PROGRAM[type] || []).filter(s => !s.conditional || state.settings.shoulderPress.enabled).map(s => {
    if (s.conditional === 'shoulderPress') { const sp = state.settings.shoulderPress; return { ...s, sets: sp.sets, min: sp.min, max: sp.max }; }
    return { ...s };
  });
}
function allExerciseIds() { const set = new Set(); ['push', 'pull', 'legs', 'upper', 'lower'].forEach(t => PROGRAM[t].forEach(x => set.add(x.ex))); return [...set]; }

function setReps(ex, s) {
  if (ex.perSide) { const l = num(s.l), d = num(s.d); if (l == null && d == null) return null; if (l == null) return d; if (d == null) return l; return Math.min(l, d); }
  return num(s.r);
}
// Performance normalisée (charge par haltère pour les haltères)
function perfOf(it) {
  const ex = exOf(it.ex); const e = it.entry || { sets: [] };
  let load = num(e.load);
  if (load != null && ex.equip === 'haltere' && e.loadMode === 'total') load = load / 2;
  const reps = (e.sets || []).map(s => setReps(ex, s)).filter(r => r != null && r > 0);
  return { load, reps };
}
function hasData(it) {
  const e = it.entry;
  return num(e.load) != null || e.sets.some(s => num(s.r) != null || num(s.l) != null || num(s.d) != null) || e.rir != null || e.tech != null || (e.note || '').trim() !== '';
}
function volume(it) {
  const ex = exOf(it.ex); const e = it.entry; const load = num(e.load);
  if (load == null || ex.equip === 'pdc') return 0;
  const mult = (ex.equip === 'haltere' && e.loadMode !== 'total') ? 2 : 1;
  let reps = 0;
  for (const s of e.sets) reps += ex.perSide ? (num(s.l) || 0) + (num(s.d) || 0) : (num(s.r) || 0);
  return load * mult * reps;
}
// Performances réellement enregistrées (séances de l'historique), plus récentes d'abord
function performancesOf(exId, hist = state.history) {
  const out = [];
  for (const h of hist) for (const it of h.items) {
    if (it.ex !== exId || it.status !== 'done') continue;
    const p = perfOf(it);
    if (p.load == null && !p.reps.length) continue;
    out.push({ date: h.date, type: h.type, endedAt: h.endedAt || 0, item: it, load: p.load, reps: p.reps });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.endedAt - a.endedAt);
}

/* ---------- Recommandation de charge (surcharge progressive prudente) ---------- */
function fromReference(ex, manual) {
  if (ex.suggestedLoad != null && !manual) return { kind: 'proposee', load: ex.suggestedLoad, label: 'Charge proposée', reason: ex.suggestedReason || 'Charge non encore testée.' };
  if (ex.refLoad == null) return { kind: 'inconnue', load: null, label: 'À renseigner', reason: 'Aucune charge connue : commence léger avec une technique propre, puis note la charge réellement utilisée.' };
  return { kind: ex.refStatus || 'provisoire', load: ex.refLoad, label: STATUS_LABELS[ex.refStatus] || 'Référence',
    reason: manual ? 'Référence modifiée manuellement dans les réglages.' : (ex.refNote || 'Basée sur les données connues avant l’application.') };
}
function recommend(exId, slot, type, hist = state.history) {
  const ex = exOf(exId);
  if (ex.equip === 'pdc') return { kind: 'pdc', load: null, label: 'Poids du corps', reason: 'Progresse par le contrôle, l’amplitude puis les répétitions.' };
  const perfs = performancesOf(exId, hist).filter(p => p.load != null);
  const last = perfs.find(p => p.type === type) || perfs[0]; // priorité à la dernière séance du même type
  if (!last) return fromReference(ex, false);
  if (ex.refUpdatedAt && ex.refUpdatedAt > last.endedAt) return fromReference(ex, true);

  const inc = ex.increment > 0 ? ex.increment : 2.5;
  const L = last.load, reps = last.reps, e = last.item.entry;
  const rir = e.rir, tech = e.tech;
  const js = last.item.slot || slot; // on juge la séance avec ses propres objectifs
  const okSets = reps.length >= (js.minSets || js.sets);
  const judged = reps.slice(0, js.sets);
  const inRange = okSets && judged.every(r => r >= js.min);
  const atTop = okSets && judged.every(r => r >= js.max);
  const farBelow = reps.some(r => r < js.min - 2);
  const base = { lastLoad: L, lastDate: last.date };
  const keep = reason => ({ ...base, kind: 'maintien', load: L, label: STATUS_LABELS.maintien, reason });
  const down = reason => { const n = roundLoad(L - inc); return n > 0 ? { ...base, kind: 'baisse', load: n, label: STATUS_LABELS.baisse, reason } : keep(reason); };

  let rec;
  if (tech === 'corriger') rec = down('Technique notée « à corriger » : charge allégée pour travailler le mouvement.');
  else if (ex.technique === 'a_revoir') rec = keep('Technique à valider (Réglages › Exercices) avant toute augmentation.');
  else if (!inRange) rec = (rir === 0 || farBelow) ? down('Répétitions prévues non atteintes avec un effort maximal : légère baisse.') : keep('Répétitions prévues pas encore atteintes : conserve la charge.');
  else if (rir == null || tech == null) rec = keep('Séance réussie, mais RIR ou technique non renseignés : charge conservée par prudence.');
  else if (rir === 0) rec = keep('Fourchette atteinte mais dernières répétitions très difficiles (RIR 0) : charge conservée.');
  else if (js.max > js.min && !atTop) rec = keep(`Bonne séance : vise ${js.max} répétitions sur toutes les séries avant d’augmenter.`);
  else rec = { ...base, kind: 'hausse', load: roundLoad(L + inc), label: STATUS_LABELS.hausse, reason: `Toutes les séries réussies, technique correcte, RIR ${rirTxt(rir)} : petite augmentation (+${fmtKg(inc)}).` };

  if (last.type !== type) {
    if (slot.min > js.max && rec.load != null && rec.kind !== 'baisse') {
      const n = roundLoad(rec.load - inc);
      if (n > 0) rec = { ...rec, kind: 'baisse', load: n, label: STATUS_LABELS.baisse, reason: `Plus de répétitions prévues (${slot.min}) que lors de la référence (${repsTxt(js)}) : un cran plus léger.` };
    }
    rec.reason += ` (Référence : séance ${SESSION_NAMES[last.type]} du ${fmtShort(last.date)}.)`;
  }
  return rec;
}
const recLoadTxt = (rec, ex) => rec.load != null ? fmtKg(rec.load) + unitTxt(ex) : (rec.kind === 'pdc' ? 'PDC' : 'À renseigner');

/* ---------- Séance active ---------- */
function elapsed(a) { return (a.elapsedMs || 0) + (a.paused || !a.runningSince ? 0 : Date.now() - a.runningSince); }
function startSession() {
  if (state.active) return resumeSession();
  const date = todayISO(), type = sessionTypeFor(date);
  if (type === 'rest') return toast('Jour de repos : aucune séance prévue.');
  const now = Date.now();
  state.active = {
    id: 's' + now, date, type, startedAt: now, elapsedMs: 0, runningSince: now, paused: false, index: 0,
    items: slotsFor(type).map(s => {
      const ex = exOf(s.ex);
      return {
        ex: s.ex, status: 'todo',
        slot: { sets: s.sets, minSets: s.minSets || s.sets, min: s.min, max: s.max, note: s.note || '' },
        rec: recommend(s.ex, s, type),
        entry: { load: '', loadMode: ex.equip === 'haltere' ? 'par_haltere' : 'total', sets: Array.from({ length: s.sets }, () => ({ r: '', l: '', d: '' })), rir: null, tech: null, note: '' }
      };
    })
  };
  save(); go('session');
}
function resumeSession() {
  const a = state.active; if (!a) return;
  if (a.paused || !a.runningSince) { a.paused = false; a.runningSince = Date.now(); }
  save(); go('session');
}
function pauseSession() {
  const a = state.active; if (!a) return;
  a.elapsedMs = elapsed(a); a.paused = true; a.runningSince = null;
  save(); go('home'); toast('Séance en pause — tout est enregistré');
}
function goNext() {
  const a = state.active;
  let next = a.items.findIndex((x, i) => i > a.index && x.status === 'todo');
  if (next < 0) next = a.items.findIndex(x => x.status === 'todo');
  if (next < 0) { save(); go('finish'); return; }
  a.index = next; save(); render(); window.scrollTo(0, 0);
}
function exerciseDone() {
  const a = state.active, it = a.items[a.index], ex = exOf(it.ex), e = it.entry, w = [];
  const L = num(e.load);
  if (e.load !== '' && L == null) w.push('La charge saisie n’est pas un nombre valide : elle sera ignorée.');
  if (L != null && (L < 0 || L > 400)) w.push(`Charge inhabituelle : ${fmtKg(L)}.`);
  const vals = e.sets.flatMap(s => [s.r, s.l, s.d]).filter(v => v !== '' && v != null);
  if (vals.some(v => num(v) == null)) w.push('Certaines répétitions ne sont pas des nombres : elles seront ignorées.');
  if (vals.some(v => num(v) > 60)) w.push('Nombre de répétitions inhabituel (> 60).');
  if (!hasData(it)) w.push('Aucune performance saisie. L’exercice sera marqué terminé sans données (rien ne sera inventé).');
  if (w.length && !confirm(w.join('\n\n') + '\n\nMarquer comme terminé ?')) return;
  it.status = 'done'; it.doneAt = Date.now();
  save();
  toast(hasData(it) && ex.equip !== 'pdc' && L == null ? 'Enregistré (sans charge : pas de prévision basée dessus)' : 'Exercice enregistré ✓', 1800);
  goNext();
}
function activeAsRecord(a) { return { id: a.id, date: a.date, type: a.type, startedAt: a.startedAt, endedAt: Date.now(), durationMs: elapsed(a), complete: false, items: a.items }; }
let justSaved = null;
function finalizeSession(complete) {
  const a = state.active; if (!a) return;
  const rec = activeAsRecord(a);
  rec.complete = complete && a.items.every(i => i.status === 'done'); // une séance incomplète n'est jamais comptée comme terminée
  rec.items = clone(a.items);
  state.history.unshift(rec); sortHistory(); state.active = null;
  if (save()) toast(rec.complete ? 'Séance terminée et enregistrée ✓' : 'Séance partielle enregistrée');
  justSaved = rec.id; go('historyDetail', rec.id); justSavedKeep = true;
}
let justSavedKeep = false;
function reopenSession(id) {
  if (state.active) return toast('Une séance est déjà en cours.');
  const i = state.history.findIndex(h => h.id === id); if (i < 0) return;
  const h = state.history[i];
  state.active = {
    id: h.id, date: h.date, type: h.type, startedAt: h.startedAt || Date.now(), elapsedMs: h.durationMs || 0, runningSince: Date.now(), paused: false,
    index: Math.max(0, h.items.findIndex(x => x.status !== 'done')),
    items: h.items.map(x => ({ ...x, status: x.status === 'skipped' ? 'todo' : x.status, rec: x.rec || recommend(x.ex, x.slot, h.type) }))
  };
  state.history.splice(i, 1); save(); go('session');
}
function sortHistory() { state.history.sort((a, b) => b.date.localeCompare(a.date) || (b.endedAt || 0) - (a.endedAt || 0)); }

/* ---------- Résumé ---------- */
function compareItems(it, pit) {
  if (!pit) return null;
  const a = perfOf(it), b = perfOf(pit); const parts = []; let prog = false;
  if (a.load != null && b.load != null) {
    const d = roundLoad(a.load - b.load);
    if (d > 0) { parts.push(`+${fmtKg(d)}`); prog = true; } else if (d < 0) parts.push(`−${fmtKg(-d)}`); else parts.push('charge identique');
  }
  if (a.reps.length && b.reps.length) {
    const d = a.reps.reduce((s, x) => s + x, 0) - b.reps.reduce((s, x) => s + x, 0);
    if (d > 0) { parts.push(`+${d} rép.`); if (a.load != null && b.load != null && a.load >= b.load) prog = true; }
    else if (d < 0) parts.push(`${d} rép.`);
  }
  return { text: parts.join(', '), prog };
}
function buildSummary(rec, hist) {
  const prev = hist.find(h => h.id !== rec.id && h.type === rec.type && (h.date < rec.date || (h.date === rec.date && (h.endedAt || 0) < (rec.endedAt || 0))));
  const histWith = [rec, ...hist.filter(h => h.id !== rec.id)];
  let sets = 0, reps = 0, vol = 0; const rows = [], progress = [], techIssues = [], nextTime = [];
  for (const it of rec.items) {
    const ex = exOf(it.ex); const p = perfOf(it); let cmp = null;
    if (it.status === 'done') {
      sets += p.reps.length; reps += p.reps.reduce((s, x) => s + x, 0); vol += volume(it);
      cmp = compareItems(it, prev && prev.items.find(x => x.ex === it.ex && x.status === 'done'));
      if (cmp && cmp.prog) progress.push(`${ex.name} : ${cmp.text}`);
      if (it.entry.tech === 'corriger') techIssues.push(`${ex.name} : technique notée « à corriger ».`);
      else if (ex.technique === 'a_revoir') {
        const recent = performancesOf(it.ex, histWith).slice(0, 2);
        techIssues.push(recent.length === 2 && recent.every(r => r.item.entry.tech === 'ok')
          ? `${ex.name} : technique notée correcte 2 fois de suite — tu peux la valider dans Réglages.`
          : `${ex.name} : technique encore à valider (aucune augmentation proposée).`);
      }
      if (ex.equip !== 'pdc') nextTime.push({ ex, r: recommend(it.ex, it.slot, rec.type, histWith) });
    }
    rows.push({ it, ex, cmp });
  }
  const prevVol = prev ? prev.items.filter(x => x.status === 'done').reduce((s, x) => s + volume(x), 0) : null;
  return { prev, sets, reps, vol, prevVol, rows, progress, techIssues, nextTime };
}
function entryLine(it, ex) {
  const e = it.entry, load = num(e.load);
  const reps = e.sets.map(s => ex.perSide ? ((num(s.l) != null || num(s.d) != null) ? `${num(s.l) ?? '–'}/${num(s.d) ?? '–'}` : null) : num(s.r)).filter(x => x != null);
  const loadTxt = ex.equip === 'pdc' ? 'Poids du corps' : load != null ? fmtKg(load) + (ex.equip === 'haltere' ? (e.loadMode === 'total' ? ' (total)' : ' / haltère') : ex.perSide ? ' / côté' : '') : 'charge non notée';
  return `${loadTxt} · ${reps.length ? reps.join(' · ') : 'répétitions non notées'}${e.rir != null ? ` · RIR ${rirTxt(e.rir)}` : ''}${e.tech ? ` · technique ${e.tech === 'ok' ? 'OK' : 'à corriger'}` : ''}`;
}
const pct = (a, b) => { const v = Math.round((a - b) / b * 100); return (v > 0 ? '+' : '') + v + ' %'; };
function renderSummary(rec, hist) {
  const s = buildSummary(rec, hist); const done = rec.items.filter(i => i.status === 'done').length;
  const allDone = done === rec.items.length;
  return `<section class="card hero"><div class="row between"><span class="chip">${fmtDate(rec.date)}</span>
    <span class="chip ${rec.complete || allDone ? 'ok' : 'warn'}">${rec.complete ? 'Terminée' : allDone ? 'Prête à terminer' : 'Partielle'}</span></div>
    <h2 class="session-name">${SESSION_NAMES[rec.type]}</h2>
    <div class="stats"><div><b>${done}/${rec.items.length}</b><span>exercices</span></div><div><b>${s.sets}</b><span>séries</span></div>
    <div><b>${s.reps}</b><span>répétitions</span></div><div><b>${s.vol ? Math.round(s.vol).toLocaleString('fr-FR') : '—'}</b><span>volume (kg)</span></div>
    <div><b>${rec.durationMs ? fmtDur(rec.durationMs) : '—'}</b><span>durée</span></div></div>
    ${s.prev ? `<p class="muted">Comparée à ${SESSION_NAMES[s.prev.type]} du ${fmtShort(s.prev.date)}${s.prevVol && s.vol ? ` · volume ${pct(s.vol, s.prevVol)}` : ''}</p>` : '<p class="muted">Première séance de ce type enregistrée : pas encore de comparaison.</p>'}
  </section>
  <section class="card"><h3>Exercices</h3>${s.rows.map(({ it, ex, cmp }) => `<div class="sum-row ${it.status}">
    <div class="row between"><b>${it.status === 'done' ? '✓' : it.status === 'skipped' ? '↷' : '○'} ${esc(ex.name)}</b>${cmp && cmp.text ? `<span class="cmp ${cmp.prog ? 'up' : ''}">${esc(cmp.text)}</span>` : ''}</div>
    ${it.status === 'done' ? `<div class="muted small">${esc(entryLine(it, ex))}</div>${it.entry.note ? `<div class="small">« ${esc(it.entry.note)} »</div>` : ''}` : `<div class="muted small">${it.status === 'skipped' ? 'Passé' : 'Non réalisé'}</div>`}
  </div>`).join('')}</section>
  ${s.progress.length ? `<section class="card"><h3>📈 Progressions constatées</h3><ul>${s.progress.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
  ${s.techIssues.length ? `<section class="card"><h3>🎯 Technique à améliorer</h3><ul>${s.techIssues.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>` : ''}
  ${s.nextTime.length ? `<section class="card"><h3>La prochaine fois</h3><p class="muted small">Prévisions prudentes, pas des certitudes.</p>
    ${s.nextTime.map(n => `<div class="fx"><div class="row between"><b>${esc(n.ex.name)}</b><span><b>${recLoadTxt(n.r, n.ex)}</b></span></div>
    <small class="badge k-${n.r.kind}">${esc(n.r.label)}</small><p class="reason">${esc(n.r.reason)}</p></div>`).join('')}</section>` : ''}
  <p class="muted small">Volume = charge × répétitions (indicatif ; ×2 pour une charge « par haltère »). Durée : temps écoulé hors pauses signalées.</p>`;
}

/* ---------- Navigation ---------- */
let view = 'home', viewArg = null;
function go(v, arg = null) { if (!justSavedKeep) justSaved = null; justSavedKeep = false; view = v; viewArg = arg; render(); window.scrollTo(0, 0); }
function render() {
  if ((view === 'session' || view === 'finish') && !state.active) view = 'home';
  const views = { home: renderHome, session: renderSession, finish: renderFinish, upcoming: renderUpcoming, history: renderHistory, historyDetail: () => renderHistoryDetail(viewArg), exercise: () => renderExerciseHistory(viewArg), settings: renderSettings };
  $('#app').innerHTML = (views[view] || renderHome)();
  document.body.classList.toggle('focus', view === 'session' || view === 'finish');
  const tabMap = { historyDetail: 'history', exercise: 'history' };
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.view === (tabMap[view] || view)));
}
const progressBar = (n, t) => `<div class="progress" role="progressbar" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="${t}"><div style="width:${t ? Math.round(n / t * 100) : 0}%"></div></div>`;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/* ---------- Accueil ---------- */
function nextDaysList(t, from, count) {
  let h = '<ul class="mini-days">';
  for (let i = from; i < from + count; i++) { const d = addDays(t, i); h += `<li><span>${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'short' })}</span><b>${SESSION_NAMES[sessionTypeFor(d)]}</b></li>`; }
  return h + '</ul>';
}
function restCard(t, idx) {
  let nd = null; for (let i = 1; i <= 7; i++) { const d = addDays(t, i); if (sessionTypeFor(d) !== 'rest') { nd = d; break; } }
  return `<section class="card hero"><span class="chip">Jour ${idx + 1} du cycle</span><h2 class="session-name">Repos 🌙</h2>
    <p>Aucun exercice aujourd’hui. La récupération fait partie de la progression.</p>
    <ul><li>Dors suffisamment (7 à 9 h).</li><li>Hydrate-toi et mange assez de protéines.</li><li>Une marche légère ou des étirements doux restent possibles.</li></ul>
    ${nd ? `<p class="muted">Prochaine séance : <b>${SESSION_NAMES[sessionTypeFor(nd)]}</b> — ${fmtDate(nd, { weekday: 'long', day: 'numeric', month: 'long' })}</p>` : ''}
    <div class="stack"><button class="btn ghost" data-act="go" data-view="upcoming">Voir les séances à venir</button><button class="btn ghost" data-act="go" data-view="history">Historique</button></div>
    <p class="muted small">Séance décalée exceptionnellement ? <button class="link" data-act="go" data-view="settings">Corriger le cycle</button></p></section>`;
}
function renderHome() {
  const t = todayISO(); lastDay = t; const idx = cycleIndexFor(t); const type = CYCLE[idx]; const a = state.active;
  let h = `<header class="page-head"><p class="eyebrow">Aujourd’hui</p><h1>${fmtDate(t)}</h1></header>`;
  if (!storageOK) h += `<div class="card warn">⚠️ Le stockage local est indisponible (navigation privée ?). Tes données risquent de ne pas être conservées.</div>`;
  if (a && a.date !== t) {
    const n = a.items.filter(i => i.status === 'done').length;
    h += `<section class="card warn"><h3>Séance non terminée</h3><p>${SESSION_NAMES[a.type]} du ${fmtDate(a.date, { weekday: 'long', day: 'numeric', month: 'long' })} — ${n}/${a.items.length} exercices.</p>
      <div class="stack"><button class="btn" data-act="resume">Reprendre cette séance</button><button class="btn ghost" data-act="closePartial">Clôturer en séance partielle</button></div>
      <p class="muted small">Rien n’est effacé : une séance clôturée reste consultable dans l’historique.</p></section>`;
  }
  if (type === 'rest') h += restCard(t, idx);
  else {
    const slots = slotsFor(type);
    const done = state.history.find(x => x.date === t && x.type === type && x.complete);
    const partial = state.history.find(x => x.date === t && x.type === type && !x.complete);
    const cur = a && a.date === t;
    h += `<section class="card hero"><div class="row between"><span class="chip">Jour ${idx + 1} du cycle</span>${done ? '<span class="chip ok">Terminée ✓</span>' : ''}</div>
      <h2 class="session-name">${SESSION_NAMES[type]}</h2><p class="muted">${SESSION_SUBTITLES[type]}</p>
      <div class="stats"><div><b>${slots.length}</b><span>exercices</span></div><div><b>${slots.reduce((s, x) => s + x.sets, 0)}</b><span>séries</span></div>
      ${cur ? `<div><b>${fmtDur(elapsed(a))}</b><span>${a.paused ? 'en pause' : 'écoulé'}</span></div>` : ''}</div>`;
    if (cur) { const n = a.items.filter(i => i.status === 'done').length; h += progressBar(n, a.items.length) + `<p class="muted">${n} / ${a.items.length} exercices terminés</p><button class="btn big" data-act="resume">Reprendre la séance</button>`; }
    else if (a) h += `<p class="muted">Reprends ou clôture d’abord la séance précédente.</p>`;
    else if (done) h += `<p>Séance du jour terminée. Bravo !</p><button class="btn big" data-act="viewHist" data-id="${esc(done.id)}">Voir le résumé</button>`;
    else {
      if (partial) h += `<p class="muted">Une séance partielle a été enregistrée aujourd’hui.</p><button class="btn ghost" data-act="reopen" data-id="${esc(partial.id)}">Reprendre la séance partielle</button>`;
      h += `<button class="btn big" data-act="start">Commencer la séance</button>`;
    }
    h += `<details class="peek"><summary>Aperçu des exercices</summary><ol>${slots.map(s => `<li>${esc(exOf(s.ex).name)} <span class="muted small">${setsRepsTxt(s, exOf(s.ex))}</span></li>`).join('')}</ol></details></section>`;
  }
  const le = state.settings.lastExport;
  if (state.history.length >= 3 && (!le || Date.now() - le > 14 * 864e5))
    h += `<section class="card"><p>💾 Pense à exporter une sauvegarde de tes données.</p><button class="btn ghost" data-act="exportData">Exporter mes données</button></section>`;
  if (!isStandalone() && location.protocol === 'https:')
    h += `<section class="card"><p class="small">📱 Astuce : ajoute l’app à l’écran d’accueil (Safari › Partager › « Sur l’écran d’accueil »). Attention : les données saisies dans Safari ne sont pas partagées avec l’icône.</p></section>`;
  h += `<section class="card"><h3>Prochains jours</h3>${nextDaysList(t, 1, 4)}<button class="btn ghost" data-act="go" data-view="upcoming">Toutes les séances à venir</button></section>
    <div class="foot-links"><button class="link" data-act="downloadZip">Télécharger l’application</button></div>`;
  return h;
}

/* ---------- Séance en cours ---------- */
function seg(name, opts, cur) {
  return `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-act="seg" data-name="${name}" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function renderEntryForm(it, ex) {
  const e = it.entry;
  const loadLabel = ex.equip === 'barre' ? 'Charge totale, barre comprise (kg)' : ex.perSide ? 'Charge par côté (kg)' : ex.equip === 'machine' ? 'Charge affichée sur la machine (kg)' : 'Charge (kg)';
  let h = `<section class="card"><h3>Ma performance réelle</h3>`;
  if (ex.equip !== 'pdc') {
    h += `<label class="field"><span>${loadLabel}</span><div class="row"><input type="text" inputmode="decimal" autocomplete="off" data-f="load" value="${esc(e.load)}" placeholder="vide = non noté">
      ${it.rec.load != null ? `<button type="button" class="btn small ghost" data-act="useRec">Mettre ${fmtKg(it.rec.load)}</button>` : ''}</div></label>`;
    if (ex.equip === 'haltere') h += seg('loadMode', [['par_haltere', 'Par haltère'], ['total', 'Total (2 haltères)']], e.loadMode);
  }
  h += `<div class="field"><span>Répétitions par série${ex.perSide ? ' (gauche / droite)' : ''} — objectif ${repsTxt(it.slot)}</span>`;
  e.sets.forEach((s, i) => {
    h += `<div class="set-row"><span class="set-n">S${i + 1}</span>` + (ex.perSide
      ? `<input type="text" inputmode="numeric" pattern="[0-9]*" data-f="rep" data-i="${i}" data-side="l" placeholder="G" value="${esc(s.l)}"><input type="text" inputmode="numeric" pattern="[0-9]*" data-f="rep" data-i="${i}" data-side="d" placeholder="D" value="${esc(s.d)}">`
      : `<input type="text" inputmode="numeric" pattern="[0-9]*" data-f="rep" data-i="${i}" data-side="r" placeholder="${repsTxt(it.slot)}" value="${esc(s.r)}">`) + `</div>`;
  });
  h += `<div class="row gap"><button type="button" class="btn small ghost" data-act="addSet">+ Série</button>${e.sets.length > 1 ? `<button type="button" class="btn small ghost" data-act="delSet">− Série</button>` : ''}</div></div>`;
  h += `<div class="field"><span>Répétitions en réserve (RIR)</span>${seg('rir', [['0', '0'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4+']], e.rir == null ? null : String(e.rir))}
    <small class="muted">0 = échec ou presque · 2 = il en restait environ 2. Touche à nouveau pour effacer.</small></div>`;
  h += `<div class="field"><span>Technique correcte ?</span>${seg('tech', [['ok', 'Oui'], ['corriger', 'À corriger']], e.tech)}</div>`;
  h += `<label class="field"><span>Remarque (facultatif)</span><textarea data-f="note" rows="2">${esc(e.note)}</textarea></label></section>`;
  return h;
}
function renderSession() {
  const a = state.active; const it = a.items[a.index]; const ex = exOf(it.ex);
  const n = a.items.filter(i => i.status === 'done').length;
  const perfs = performancesOf(it.ex); const lastL = perfs.find(p => p.load != null);
  const cur = lastL ? { v: fmtKg(lastL.load) + unitTxt(ex), sub: `réelle · ${fmtShort(lastL.date)} · ${lastL.reps.join('/') || '—'}` }
    : ex.equip === 'pdc' ? { v: 'Poids du corps', sub: '' }
    : ex.refLoad != null ? { v: fmtKg(ex.refLoad) + unitTxt(ex), sub: STATUS_LABELS[ex.refStatus] || '' } : { v: 'À renseigner', sub: 'aucune donnée' };
  const lastPerfs = perfs.slice(0, 2).map(p => `<li>${fmtShort(p.date)} (${SESSION_NAMES[p.type]}) : ${esc(entryLine(p.item, ex))}</li>`).join('');
  return `<div class="sess-top"><button class="btn small ghost" data-act="pause">⏸ Pause</button>
    <div class="sess-title"><b>${SESSION_NAMES[a.type]}</b><span id="timer">${fmtClock(elapsed(a))}</span></div>
    <button class="btn small ghost" data-act="list">☰ Liste</button></div>
  ${progressBar(n, a.items.length)}
  <p class="ex-counter">Exercice ${a.index + 1} sur ${a.items.length}${it.status === 'done' ? ' · <span class="ok">terminé</span>' : it.status === 'skipped' ? ' · passé' : ''}</p>
  <article class="card ex-card"><h2>${esc(ex.name)}</h2>
    <div class="targets"><div><span>Séries</span><b>${it.slot.minSets < it.slot.sets ? it.slot.minSets + '–' : ''}${it.slot.sets}</b></div>
      <div><span>Répétitions</span><b>${repsTxt(it.slot)}</b>${ex.perSide ? '<small>par côté</small>' : ''}</div></div>
    <div class="loads"><div class="load-box"><span>Charge actuelle</span><b>${cur.v}</b><small>${esc(cur.sub)}</small></div>
      <div class="load-box accent"><span>Conseillée aujourd’hui</span><b>${recLoadTxt(it.rec, ex)}</b><small class="badge k-${it.rec.kind}">${esc(it.rec.label)}</small></div></div>
    ${it.rec.reason ? `<p class="reason">${esc(it.rec.reason)}</p>` : ''}
    ${it.slot.note ? `<p class="note">${esc(it.slot.note)}</p>` : ''}
    ${ex.technique === 'a_revoir' ? '<p class="note warn">Technique à revoir : priorité au mouvement, aucune augmentation proposée.</p>' : ''}
    <p class="small"><b>Dernières performances :</b></p>${lastPerfs ? `<ul class="small muted">${lastPerfs}</ul>` : `<p class="small muted">${ex.lastKnown ? 'Avant l’application : ' + esc(ex.lastKnown) : 'Aucune performance enregistrée.'}</p>`}
    <details class="tips" ${ex.technique === 'a_revoir' ? 'open' : ''}><summary>Instructions techniques</summary><ul>${(ex.tips || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
  </article>
  ${renderEntryForm(it, ex)}
  <div class="row between"><button class="link" data-act="skip">Passer cet exercice</button><button class="link" data-act="toFinish">Résumé / fin de séance</button></div>
  <div class="sess-actions"><button class="btn ghost" data-act="prev" ${a.index === 0 ? 'disabled' : ''}>‹ Précédent</button><button class="btn" data-act="done">Exercice terminé ✓</button></div>`;
}
function showList() {
  const a = state.active;
  showSheet(`<h3>${SESSION_NAMES[a.type]} — exercices</h3><ol class="ex-list">${a.items.map((it, i) => `<li><button class="${i === a.index ? 'cur' : ''}" data-act="jump" data-i="${i}">${it.status === 'done' ? '✓' : it.status === 'skipped' ? '↷' : '○'} ${esc(exOf(it.ex).name)}</button></li>`).join('')}</ol><button class="btn ghost" data-act="closeSheet">Fermer</button>`);
}

/* ---------- Fin de séance ---------- */
function renderFinish() {
  const a = state.active; const rec = activeAsRecord(a);
  const nDone = a.items.filter(i => i.status === 'done').length; const allDone = nDone === a.items.length;
  const anyData = a.items.some(i => i.status === 'done' || hasData(i));
  const hist = state.history.filter(h => h.date <= a.date);
  let h = `<div class="sess-top"><button class="btn small ghost" data-act="backToSession">‹ Séance</button><div class="sess-title"><b>Fin de séance</b></div><span></span></div>`;
  h += allDone ? `<div class="card ok-banner">Tous les exercices sont terminés 💪</div>` : `<div class="card warn">Séance incomplète : ${a.items.length - nDone} exercice(s) non terminé(s). Résumé partiel ci-dessous.</div>`;
  h += renderSummary(rec, hist);
  h += allDone
    ? `<div class="stack"><button class="btn big" data-act="finishComplete">Terminer la séance</button><button class="btn ghost" data-act="backToSession">Revenir aux exercices</button></div>`
    : `<div class="stack"><button class="btn big" data-act="backToSession">Reprendre la séance</button><button class="btn ghost" data-act="later">Mettre en pause, reprendre plus tard</button>
       ${anyData ? `<button class="btn ghost" data-act="closePartial">Clôturer en séance partielle</button>` : `<button class="btn ghost danger" data-act="cancelSession">Annuler la séance (rien n’a été saisi)</button>`}</div>`;
  return h;
}

/* ---------- Séances à venir ---------- */
function forecastRow(s, type) {
  const ex = exOf(s.ex); const rec = recommend(s.ex, s, type); const last = performancesOf(s.ex).find(p => p.load != null);
  return `<div class="fx"><div class="fx-name">${esc(ex.name)}</div><div class="fx-meta">${setsRepsTxt(s, ex)}</div>
    <div class="fx-loads"><div><span>Dernière charge réelle</span><b>${last ? fmtKg(last.load) + unitTxt(ex) : '—'}</b><small>${last ? fmtShort(last.date) : 'aucune enregistrée'}</small></div>
    <div class="accent"><span>Prévision</span><b>${recLoadTxt(rec, ex)}</b><small class="badge k-${rec.kind}">${esc(rec.label)}</small></div></div>
    ${rec.reason ? `<p class="reason">${esc(rec.reason)}</p>` : ''}</div>`;
}
function renderUpcoming() {
  const t = todayISO(); const seen = {};
  let h = `<header class="page-head"><h1>Séances à venir</h1><p class="muted small">« Dernière charge réelle » = ce que tu as réellement fait. « Prévision » = estimation calculée à partir de ton historique actuel, recalculée après chaque séance.</p></header>`;
  for (let i = 0; i < 14; i++) {
    const d = addDays(t, i); const idx = cycleIndexFor(d); const type = CYCLE[idx];
    const label = i === 0 ? '<span class="chip ok">Aujourd’hui</span>' : i === 1 ? '<span class="chip">Demain</span>' : '';
    const dTxt = fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
    if (type === 'rest') { h += `<div class="day"><div><b>${dTxt}</b> ${label}</div><span class="muted">Repos</span></div>`; continue; }
    const first = !seen[type]; if (first) seen[type] = d;
    const slots = slotsFor(type);
    h += `<details class="card day" ${first && i < 3 ? 'open' : ''}><summary><b>${dTxt}</b> ${label} — ${SESSION_NAMES[type]} <span class="muted small">(${slots.length} ex.)</span></summary>
      ${first ? '' : `<p class="note">Prévision provisoire : elle dépendra du résultat de la séance ${SESSION_NAMES[type]} du ${fmtShort(seen[type])}.</p>`}
      ${slots.map(s => forecastRow(s, type)).join('')}</details>`;
  }
  return h;
}

/* ---------- Historique ---------- */
function histCard(h) {
  const done = h.items.filter(i => i.status === 'done'); const vol = done.reduce((s, i) => s + volume(i), 0);
  return `<button class="card hist" data-act="viewHist" data-id="${esc(h.id)}"><div class="row between"><b>${SESSION_NAMES[h.type]}</b><span class="chip ${h.complete ? 'ok' : 'warn'}">${h.complete ? 'Terminée' : 'Partielle'}</span></div>
    <div class="muted">${fmtDate(h.date)}</div><div class="small muted">${done.length}/${h.items.length} exercices${vol ? ` · ${Math.round(vol).toLocaleString('fr-FR')} kg de volume` : ''}${h.durationMs ? ` · ${fmtDur(h.durationMs)}` : ''}</div></button>`;
}
function renderHistory() {
  const ids = allExerciseIds().filter(id => performancesOf(id).length);
  return `<header class="page-head"><h1>Historique</h1></header>
  <section class="card"><h3>Évolution par exercice</h3>${ids.length ? `<select id="exPick"><option value="">Choisir un exercice…</option>${ids.map(id => `<option value="${id}">${esc(exOf(id).name)}</option>`).join('')}</select>` : '<p class="muted">Aucune performance enregistrée pour l’instant.</p>'}</section>
  ${state.history.length ? state.history.map(histCard).join('') : '<div class="card muted">Aucune séance enregistrée. Termine ta première séance pour la retrouver ici.</div>'}`;
}
function renderHistoryDetail(id) {
  const rec = state.history.find(h => h.id === id);
  if (!rec) return `<div class="card">Séance introuvable.</div><button class="btn ghost" data-act="go" data-view="history">Retour</button>`;
  const upto = state.history.filter(h => h.date < rec.date || (h.date === rec.date && (h.endedAt || 0) <= (rec.endedAt || 0)));
  return `<div class="sess-top"><button class="btn small ghost" data-act="go" data-view="history">‹ Historique</button><div class="sess-title"><b>Résumé</b></div><span></span></div>
  ${justSaved === id ? `<div class="card ok-banner">${rec.complete ? 'Séance terminée et enregistrée ✓' : 'Séance partielle enregistrée — tu peux la reprendre plus tard.'}</div>` : ''}
  ${renderSummary(rec, upto)}
  <div class="stack">${!rec.complete && !state.active ? `<button class="btn" data-act="reopen" data-id="${esc(rec.id)}">Reprendre cette séance</button>` : ''}
  <button class="btn ghost" data-act="go" data-view="home">Accueil</button><button class="btn ghost danger" data-act="delHist" data-id="${esc(rec.id)}">Supprimer cette séance</button></div>`;
}
function chart(values) {
  const W = 320, H = 120, P = 12; const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [P + i * (W - 2 * P) / (values.length - 1), H - P - (v - min) / span * (H - 2 * P)]);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" aria-label="Évolution de la charge"><polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="currentColor"/>`).join('')}</svg>`;
}
function renderExerciseHistory(id) {
  const ex = exOf(id); const perfs = performancesOf(id);
  const loads = perfs.filter(p => p.load != null).map(p => p.load).reverse();
  const types = Object.keys(PROGRAM).filter(t => slotsFor(t).some(s => s.ex === id));
  return `<div class="sess-top"><button class="btn small ghost" data-act="go" data-view="history">‹ Historique</button><div class="sess-title"><b>${esc(ex.name)}</b></div><span></span></div>
  <section class="card">${loads.length >= 2 ? chart(loads) + `<p class="muted small">Charge réelle${unitTxt(ex)} : ${fmtKg(loads[0])} → ${fmtKg(loads[loads.length - 1])}</p>` : '<p class="muted">Au moins 2 séances avec une charge notée sont nécessaires pour la courbe.</p>'}</section>
  <section class="card"><h3>Prochaines charges conseillées</h3>${types.map(t => { const s = slotsFor(t).find(x => x.ex === id); const r = recommend(id, s, t);
    return `<div class="fx"><div class="row between"><b>${SESSION_NAMES[t]} · ${setsRepsTxt(s, ex)}</b><b>${recLoadTxt(r, ex)}</b></div><small class="badge k-${r.kind}">${esc(r.label)}</small><p class="reason">${esc(r.reason)}</p></div>`; }).join('')}</section>
  <section class="card"><h3>Séances</h3>${perfs.map(p => `<div class="sum-row"><div class="row between"><b>${fmtDate(p.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b><span class="muted">${SESSION_NAMES[p.type]}</span></div>
    <div class="muted small">${esc(entryLine(p.item, ex))}</div></div>`).join('') || '<p class="muted">Aucune performance.</p>'}</section>`;
}

/* ---------- Réglages ---------- */
function cyclePreview(start, idx) {
  let h = '<ul class="mini-days">';
  for (let i = 0; i < 7; i++) { const d = addDays(start, i); h += `<li><span>${fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}</span><b>${SESSION_NAMES[CYCLE[mod(idx + i, 7)]]}</b></li>`; }
  return h + '</ul>';
}
function renderSettings() {
  const t = todayISO(); const c = state.settings.cycle; const curIdx = cycleIndexFor(t); const sp = state.settings.shoulderPress;
  const opts = sel => CYCLE.map((ty, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>Jour ${i + 1} — ${SESSION_NAMES[ty]}</option>`).join('');
  const log = state.settings.cycleLog.slice(0, 3).map(l => `<li>${fmtShort(l.date)} : ${SESSION_NAMES[CYCLE[cycleIndexFor(l.date, l.from)]]} → ${SESSION_NAMES[CYCLE[l.to.refIndex]]}</li>`).join('');
  const statusOpts = cur => ['provisoire', 'estimation', 'indicatif', 'proposee', 'validee'].map(s => `<option value="${s}" ${cur === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('');
  const exEdit = allExerciseIds().map(id => { const ex = exOf(id); if (ex.equip === 'pdc') return '';
    return `<details class="ex-edit"><summary>${esc(ex.name)} <span class="muted small">${ex.refLoad != null ? fmtKg(ex.refLoad) : 'À renseigner'}${ex.technique === 'a_revoir' ? ' · technique à revoir' : ''}</span></summary>
      <label class="field"><span>Charge de référence (kg${unitTxt(ex)})</span><input id="ref-${id}" inputmode="decimal" value="${inputNum(ex.refLoad)}" placeholder="vide = à renseigner"></label>
      <label class="field"><span>Statut de la référence</span><select id="st-${id}">${statusOpts(ex.refStatus)}</select></label>
      <label class="field"><span>Plus petite augmentation disponible (kg)</span><input id="inc-${id}" inputmode="decimal" value="${inputNum(ex.increment)}"></label>
      <label class="field"><span>Technique</span><select id="te-${id}"><option value="ok" ${ex.technique === 'ok' ? 'selected' : ''}>Validée</option><option value="a_revoir" ${ex.technique === 'a_revoir' ? 'selected' : ''}>À revoir (aucune augmentation)</option></select></label>
      <button class="btn small" data-act="saveEx" data-id="${id}">Enregistrer</button></details>`; }).join('');
  let used = 0; try { used = Math.round((localStorage.getItem(STORAGE_KEY) || '').length / 1024); } catch (e) { }
  const swOn = 'serviceWorker' in navigator && !!navigator.serviceWorker.controller;
  return `<header class="page-head"><h1>Réglages</h1></header>
  <section class="card"><h2>Cycle d’entraînement</h2>
    <p>Référence : <b>${fmtDate(c.refDate)}</b> = <b>jour ${c.refIndex + 1} (${SESSION_NAMES[CYCLE[c.refIndex]]})</b>.</p>
    <p class="muted small">Aujourd’hui : jour ${curIdx + 1} du cycle — ${SESSION_NAMES[CYCLE[curIdx]]}. Le cycle de 7 jours est continu et ne dépend pas du lundi.</p>
    <h3>Décaler exceptionnellement une séance</h3>
    <label class="field"><span>Aujourd’hui (${fmtDate(t, { weekday: 'long', day: 'numeric', month: 'long' })}), je fais :</span><select id="fixIdx">${opts(curIdx)}</select></label>
    <div id="fixPreview">${cyclePreview(t, curIdx)}</div>
    <p class="note">Effet : le cycle repart de la séance choisie aujourd’hui et <b>tous les jours suivants sont décalés d’autant</b>. Aucune séance de rattrapage n’est ajoutée, l’historique n’est pas modifié. Tu peux rétablir la référence d’origine à tout moment.</p>
    <button class="btn" data-act="applyFix">Appliquer la correction</button>
    ${log ? `<p class="small muted">Dernières corrections :</p><ul class="small muted">${log}</ul>` : ''}
    <h3 style="margin-top:18px">Début du cycle</h3>
    <div class="row2"><label class="field"><span>Date</span><input type="date" id="refDate" value="${c.refDate}"></label><label class="field"><span>Séance ce jour-là</span><select id="refIdx">${opts(c.refIndex)}</select></label></div>
    <div class="stack"><button class="btn ghost" data-act="saveRef">Enregistrer cette référence</button><button class="btn ghost" data-act="resetRef">Rétablir : 18/10/2026 = Upper</button>
    <button class="btn ghost" data-act="runTests">Vérifier le calcul du cycle</button></div><div id="testOut"></div>
  </section>
  <section class="card"><h2>Shoulder press</h2>
    <label class="check"><input type="checkbox" id="spOn" ${sp.enabled ? 'checked' : ''}> Conserver le shoulder press dans la séance Push</label>
    <div class="row2"><label class="field"><span>Séries</span><input id="spSets" inputmode="numeric" value="${sp.sets}"></label><label class="field"><span>Reps min – max</span><div class="row"><input id="spMin" inputmode="numeric" value="${sp.min}"><input id="spMax" inputmode="numeric" value="${sp.max}"></div></label></div>
    <p class="muted small">Charge : à renseigner dans « Exercices » ci-dessous. S’applique aux prochaines séances, pas à celle en cours.</p>
    <button class="btn ghost" data-act="saveSP">Enregistrer</button></section>
  <section class="card"><h2>Exercices et charges de référence</h2>
    <p class="muted small">La référence sert de point de départ tant qu’aucune performance n’est enregistrée. Si tu la modifies, elle prime sur l’historique jusqu’à ta prochaine performance. Adapte l’incrément aux machines et haltères de ta salle.</p>${exEdit}</section>
  <section class="card"><h2>Mes données</h2>
    <p class="small muted">${state.history.length} séance(s) enregistrée(s) · ${used} Ko · stockage persistant : ${persistInfo}${state.settings.lastExport ? ` · dernier export : ${fmtShort(new Date(state.settings.lastExport).toISOString().slice(0, 10))}` : ''}</p>
    <div class="stack"><button class="btn" data-act="exportData">Exporter mes données (JSON)</button><button class="btn ghost" data-act="importData">Importer mes données</button><button class="btn ghost danger" data-act="resetData">Réinitialiser…</button></div>
    <p class="note small">Les données restent uniquement sur cet iPhone. Effacer les données de Safari, supprimer l’icône de l’écran d’accueil ou changer de téléphone peut faire perdre l’historique sans export préalable.</p></section>
  <section class="card"><h2>Application</h2>
    <p class="small muted">Mode : ${isStandalone() ? 'ouverte depuis l’écran d’accueil ✓' : 'navigateur'} · Hors ligne : ${swOn ? 'actif ✓' : 'inactif'} · Version ${APP_VERSION}</p>
    <label class="check"><input type="checkbox" id="zipData"> Inclure une sauvegarde de mes données dans le ZIP</label>
    <div class="stack"><button class="btn" data-act="downloadZip">Télécharger l’application (ZIP)</button><button class="btn ghost" data-act="downloadIcons">Générer les icônes PNG</button><button class="btn ghost" data-act="checkUpdate">Rechercher une mise à jour</button></div></section>`;
}
function applyFix() {
  const idx = +$('#fixIdx').value; const t = todayISO(); const old = { ...state.settings.cycle };
  if (cycleIndexFor(t) === idx) return toast('Aucun changement : c’est déjà la séance prévue.');
  if (!confirm(`Aujourd’hui deviendra « ${SESSION_NAMES[CYCLE[idx]]} » (jour ${idx + 1}).\nTous les jours suivants seront décalés en conséquence.\nL’historique n’est pas modifié. Confirmer ?`)) return;
  state.settings.cycle = { refDate: t, refIndex: idx };
  state.settings.cycleLog.unshift({ at: new Date().toISOString(), date: t, from: old, to: { refDate: t, refIndex: idx } });
  state.settings.cycleLog = state.settings.cycleLog.slice(0, 20);
  save(); toast('Cycle corrigé'); render();
}
function saveRef() {
  const d = $('#refDate').value, idx = +$('#refIdx').value;
  if (!isValidISO(d)) return toast('Date invalide');
  if (!confirm(`Nouvelle référence : ${fmtDate(d)} = ${SESSION_NAMES[CYCLE[idx]]}. Toutes les dates seront recalculées à partir de là. Confirmer ?`)) return;
  state.settings.cycleLog.unshift({ at: new Date().toISOString(), date: todayISO(), from: { ...state.settings.cycle }, to: { refDate: d, refIndex: idx } });
  state.settings.cycle = { refDate: d, refIndex: idx }; save(); toast('Référence enregistrée'); render();
}
function resetRef() {
  if (!confirm('Rétablir la référence d’origine : dimanche 18 octobre 2026 = Upper ?')) return;
  state.settings.cycle = { ...CYCLE_DEFAULT }; save(); toast('Référence d’origine rétablie'); render();
}
function saveExercise(id) {
  const ex = state.exercises[id]; if (!ex) return;
  const rawRef = $('#ref-' + id).value.trim(); const ref = rawRef === '' ? null : num(rawRef);
  if (rawRef !== '' && (ref == null || ref < 0)) return toast('Charge invalide');
  const inc = num($('#inc-' + id).value); if (inc == null || inc <= 0 || inc > 20) return toast('Incrément invalide');
  if (ref !== ex.refLoad) { ex.refLoad = ref; ex.refUpdatedAt = Date.now(); ex.suggestedLoad = null; }
  ex.refStatus = ref == null ? 'inconnue' : $('#st-' + id).value;
  ex.increment = inc; ex.technique = $('#te-' + id).value;
  save(); toast('Exercice enregistré'); render();
}
function saveSP() {
  const sp = state.settings.shoulderPress;
  const sets = parseInt($('#spSets').value, 10), mn = parseInt($('#spMin').value, 10), mx = parseInt($('#spMax').value, 10);
  if (!(sets >= 1 && sets <= 10 && mn >= 1 && mx >= mn && mx <= 50)) return toast('Valeurs invalides');
  Object.assign(sp, { enabled: $('#spOn').checked, sets, min: mn, max: mx }); save(); toast('Shoulder press enregistré'); render();
}
function runCycleTests() {
  const ref = { ...CYCLE_DEFAULT };
  const exp = [['2026-10-17', 'rest', 'Samedi'], ['2026-10-18', 'upper', 'Dimanche'], ['2026-10-19', 'lower', 'Lundi'], ['2026-10-20', 'rest', 'Mardi'], ['2026-10-21', 'push', 'Mercredi'],
    ['2026-10-22', 'pull', 'Jeudi'], ['2026-10-23', 'legs', 'Vendredi'], ['2026-10-24', 'rest', 'Samedi'], ['2026-10-25', 'upper', 'Dimanche'],
    ['2026-10-31', 'rest', 'Samedi'], ['2026-11-01', 'upper', 'Dimanche'], ['2026-12-31', 'pull', 'Jeudi'], ['2027-01-01', 'legs', 'Vendredi']];
  let ok = 0;
  const rows = exp.map(([d, ty, wd]) => {
    const got = sessionTypeFor(d, ref); const gotWd = fmtDate(d, { weekday: 'long' }); const pass = got === ty && gotWd === wd; if (pass) ok++;
    return `<tr><td>${pass ? '✅' : '❌'}</td><td>${gotWd} ${fmtDate(d, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${SESSION_NAMES[got]}</td><td class="muted">attendu ${SESSION_NAMES[ty]}</td></tr>`;
  });
  const extra = [addDays('2026-10-31', 1) === '2026-11-01', addDays('2026-12-31', 1) === '2027-01-01', diffDays('2026-10-24', '2026-10-26') === 2];
  const extraOk = extra.every(Boolean);
  $('#testOut').innerHTML = `<p class="small"><b>${ok}/${exp.length}</b> dates correctes (référence d’origine) · changements de mois/année/heure : ${extraOk ? '✅' : '❌'}</p><table class="test-table">${rows.join('')}</table>`;
}

/* ---------- Export / import / réinitialisation ---------- */
let pendingShare = null;
function offerFile(blob, filename, title) {
  const url = URL.createObjectURL(blob); let canShare = false;
  try { canShare = !!(navigator.canShare && navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] })); } catch (e) { }
  pendingShare = { blob, filename };
  showSheet(`<h3>${esc(title)}</h3><a class="btn" href="${url}" download="${esc(filename)}">Enregistrer ${esc(filename)}</a>
    ${canShare ? `<button class="btn ghost" data-act="shareFile">Partager / Enregistrer dans Fichiers</button>` : ''}
    <p class="muted small">Sur iPhone, le fichier va dans Fichiers › Téléchargements. Si rien ne se passe depuis l’icône de l’écran d’accueil, utilise « Partager » ou recommence depuis Safari.</p>
    <button class="btn ghost" data-act="closeSheet">Fermer</button>`);
}
function exportData() {
  const data = { ...state, app: 'muscu', appVersion: APP_VERSION, exportedAt: new Date().toISOString() };
  state.settings.lastExport = Date.now(); save();
  offerFile(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `muscu-sauvegarde-${todayISO()}.json`, 'Sauvegarde prête');
}
function validateImport(d) {
  const errs = [];
  if (!d || typeof d !== 'object') return ['Le fichier ne contient pas un objet de données.'];
  if (!d.exercises || typeof d.exercises !== 'object') errs.push('Liste des exercices absente.');
  if (!Array.isArray(d.history)) errs.push('Historique absent.');
  else { const bad = d.history.filter(h => !validHistoryEntry(h)).length; if (bad) errs.push(`${bad} séance(s) invalide(s) dans l’historique.`); }
  if (!d.settings || typeof d.settings !== 'object') errs.push('Réglages absents.');
  return errs;
}
function handleImport(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let d; try { d = JSON.parse(reader.result); } catch (e) { return alert('Fichier invalide : ce n’est pas un JSON lisible.'); }
    const errs = validateImport(d); if (errs.length) return alert('Import refusé :\n- ' + errs.join('\n- '));
    if (!confirm(`Cette sauvegarde contient ${d.history.length} séance(s)${d.active ? ' et une séance en cours' : ''}.\nElle va REMPLACER tes données actuelles (${state.history.length} séance(s)).\nUne copie de sécurité des données actuelles sera gardée sur l’appareil.\n\nContinuer ?`)) return;
    try { localStorage.setItem(STORAGE_KEY + '.avant-import', JSON.stringify(state)); } catch (e) { }
    delete d.app; delete d.appVersion; delete d.exportedAt;
    state = migrate(d); sortHistory();
    if (save()) toast('Données importées ✓'); go('home');
  };
  reader.onerror = () => alert('Lecture du fichier impossible.');
  reader.readAsText(file);
}
function resetData() {
  if (!confirm('Réinitialiser TOUTES les données (historique, réglages, séance en cours) ?\nPense à exporter une sauvegarde avant.')) return;
  if (prompt('Pour confirmer, tape EFFACER en majuscules') !== 'EFFACER') return toast('Réinitialisation annulée');
  state = defaultState(); save(); toast('Données réinitialisées'); go('home');
}

/* ---------- Icônes & ZIP (générés sur l'appareil, sans bibliothèque) ---------- */
function drawIcon(size) {
  const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'); const k = size / 512;
  const grd = g.createLinearGradient(0, 0, size, size); grd.addColorStop(0, '#1b2440'); grd.addColorStop(1, '#0b0f1a');
  g.fillStyle = grd; g.fillRect(0, 0, size, size); g.fillStyle = '#7cf0b4';
  const rr = (x, y, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x * k, y * k, w * k, h * k, r * k); else g.rect(x * k, y * k, w * k, h * k); g.fill(); };
  rr(140, 240, 232, 32, 10); rr(96, 170, 44, 172, 16); rr(372, 170, 44, 172, 16); rr(60, 200, 32, 112, 12); rr(420, 200, 32, 112, 12);
  return c;
}
const canvasBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Génération PNG impossible')), 'image/png'));
async function ensureTouchIcon() {
  try { const r = await fetch('icons/apple-touch-icon.png', { method: 'HEAD', cache: 'no-store' }); if (r.ok) return; } catch (e) { }
  const link = document.querySelector('link[rel="apple-touch-icon"]'); if (link) link.href = drawIcon(180).toDataURL('image/png');
}
async function downloadIcons() {
  try {
    const links = [];
    for (const [name, size] of ICON_SIZES) links.push(`<a class="btn ghost" href="${URL.createObjectURL(await canvasBlob(drawIcon(size)))}" download="${name}">${name} (${size}×${size})</a>`);
    showSheet(`<h3>Icônes PNG</h3><p class="small muted">Enregistre-les puis place-les dans le dossier <b>icons/</b> de ton hébergement.</p>${links.join('')}<button class="btn ghost" data-act="closeSheet">Fermer</button>`);
  } catch (e) { showSheet(`<h3>Erreur</h3><p>${esc(e.message)}</p><button class="btn ghost" data-act="closeSheet">Fermer</button>`); }
}
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let j = 0; j < 8; j++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) { // format ZIP « stored » (sans compression), lisible par Fichiers sur iPhone
  const enc = new TextEncoder(); const parts = [], central = []; let offset = 0; const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0); const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(4, 0, true); end.setUint16(6, 0, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true); end.setUint16(20, 0, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
async function fetchFile(path) {
  let res = null;
  try { res = await fetch(path, { cache: 'no-store' }); } catch (e) { }
  if ((!res || !res.ok) && typeof caches !== 'undefined') res = await caches.match(path);
  return res && res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
async function downloadZip() {
  if (location.protocol === 'file:') {
    return showSheet(`<h3>Téléchargement indisponible ici</h3><p>Ouverte comme fichier local, l’application ne peut pas relire ses propres fichiers. Ouvre la version hébergée (adresse https) pour générer le ZIP.</p><button class="btn ghost" data-act="closeSheet">Fermer</button>`);
  }
  const withData = !!($('#zipData') && $('#zipData').checked);
  showSheet('<p>Préparation du ZIP…</p>');
  try {
    const files = [];
    for (const f of APP_FILES) { const data = await fetchFile(f); if (!data) throw new Error('Fichier introuvable : ' + f); files.push({ name: 'muscu-app/' + f, data }); }
    for (const f of OPTIONAL_FILES) { const data = await fetchFile(f); if (data) files.push({ name: 'muscu-app/' + f, data }); }
    for (const [name, size] of ICON_SIZES) files.push({ name: 'muscu-app/icons/' + name, data: new Uint8Array(await (await canvasBlob(drawIcon(size))).arrayBuffer()) });
    if (withData) files.push({ name: `muscu-app/sauvegarde-${todayISO()}.json`, data: new TextEncoder().encode(JSON.stringify(state, null, 2)) });
    const zip = makeZip(files);
    offerFile(zip, 'muscu-app.zip', `ZIP prêt (${Math.max(1, Math.round(zip.size / 1024))} Ko, ${files.length} fichiers)`);
  } catch (e) { showSheet(`<h3>Erreur</h3><p>${esc(e.message)}</p><button class="btn ghost" data-act="closeSheet">Fermer</button>`); }
}
async function checkUpdate() {
  if (!navigator.onLine) return toast('Connexion nécessaire pour rechercher une mise à jour');
  if (!('serviceWorker' in navigator)) return location.reload();
  toast('Recherche…');
  try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { }
  try { if (typeof caches !== 'undefined') { const keys = await caches.keys(); await Promise.all(keys.filter(k => k.startsWith('muscu-')).map(k => caches.delete(k))); } } catch (e) { }
  location.reload(); // tes données (localStorage) ne sont pas touchées
}

/* ---------- Feuille / toast ---------- */
function showSheet(html) { const s = $('#sheet'); s.innerHTML = `<div class="sheet-panel">${html}</div>`; s.hidden = false; }
function hideSheet() { const s = $('#sheet'); s.hidden = true; s.innerHTML = ''; }
let toastTimer;
function toast(msg, ms = 2500) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms); }

/* ---------- Actions ---------- */
const curItem = () => state.active.items[state.active.index];
const actions = {
  go: b => go(b.dataset.view), start: startSession, resume: resumeSession, pause: pauseSession, later: pauseSession,
  done: exerciseDone,
  prev: () => { const a = state.active; if (a.index > 0) { a.index--; save(); render(); window.scrollTo(0, 0); } },
  skip: () => { curItem().status = 'skipped'; save(); toast('Exercice passé (compté comme non réalisé)'); goNext(); },
  list: showList,
  jump: b => { state.active.index = +b.dataset.i; save(); hideSheet(); render(); window.scrollTo(0, 0); },
  seg: b => {
    const e = curItem().entry; const name = b.dataset.name; let v = b.dataset.v; if (name === 'rir') v = Number(v);
    e[name] = e[name] === v ? (name === 'loadMode' ? v : null) : v; save();
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', String(e[name]) === x.dataset.v));
  },
  addSet: () => { curItem().entry.sets.push({ r: '', l: '', d: '' }); save(); render(); },
  delSet: () => { const s = curItem().entry.sets; const last = s[s.length - 1]; if ((last.r || last.l || last.d) && !confirm('Supprimer la dernière série et ses répétitions ?')) return; s.pop(); save(); render(); },
  useRec: () => { const it = curItem(); it.entry.load = inputNum(it.rec.load); save(); render(); },
  toFinish: () => go('finish'), backToSession: () => go('session'),
  finishComplete: () => finalizeSession(true),
  closePartial: () => { if (confirm('Clôturer cette séance comme partielle ? Elle sera enregistrée dans l’historique sans être comptée comme complète.')) finalizeSession(false); },
  cancelSession: () => { if (confirm('Annuler cette séance ? Aucune donnée n’a été saisie.')) { state.active = null; save(); go('home'); } },
  viewHist: b => go('historyDetail', b.dataset.id), reopen: b => reopenSession(b.dataset.id),
  delHist: b => { if (!confirm('Supprimer définitivement cette séance de l’historique ?')) return; state.history = state.history.filter(h => h.id !== b.dataset.id); save(); toast('Séance supprimée'); go('history'); },
  exportData, importData: () => $('#importFile').click(), resetData,
  applyFix, saveRef, resetRef, runTests: runCycleTests,
  saveEx: b => saveExercise(b.dataset.id), saveSP,
  downloadZip, downloadIcons, checkUpdate, closeSheet: hideSheet,
  shareFile: () => { if (!pendingShare) return; navigator.share({ files: [new File([pendingShare.blob], pendingShare.filename, { type: pendingShare.blob.type })], title: pendingShare.filename }).catch(() => { }); }
};
document.addEventListener('click', e => {
  if (e.target.id === 'sheet') return hideSheet();
  const b = e.target.closest('[data-act]'); if (!b || b.disabled) return;
  const fn = actions[b.dataset.act]; if (fn) { e.preventDefault(); fn(b, e); }
});
document.addEventListener('input', ev => {
  const el = ev.target; if (!el.dataset.f || !state.active || view !== 'session') return;
  const e = curItem().entry;
  if (el.dataset.f === 'load') e.load = el.value.trim();
  else if (el.dataset.f === 'note') e.note = el.value;
  else if (el.dataset.f === 'rep') { const s = e.sets[+el.dataset.i]; if (s) s[el.dataset.side] = el.value.trim(); }
  save(); // enregistrement immédiat : rien n'est perdu si l'app est fermée
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'fixIdx') $('#fixPreview').innerHTML = cyclePreview(todayISO(), +el.value);
  else if (el.id === 'exPick' && el.value) go('exercise', el.value);
  else if (el.id === 'importFile') { handleImport(el.files[0]); el.value = ''; }
});

/* ---------- Démarrage ---------- */
let lastDay = todayISO();
function tick() {
  if (view === 'session' && state.active) { const el = $('#timer'); if (el) el.textContent = fmtClock(elapsed(state.active)); }
  const d = todayISO(); if (d !== lastDay) { lastDay = d; if (view === 'home' || view === 'upcoming') render(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && (view === 'home' || view === 'upcoming')) render(); });
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
}
sortHistory(); render(); setInterval(tick, 1000); requestPersist(); ensureTouchIcon();
if (pendingToast) toast(pendingToast, 6000);
