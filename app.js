/* Espace Jeunesse — suivi des groupes, appel des assises, bibliothèque de dars.

   Les données (groupes, jeunes, assises, dars) vivent dans une base partagée
   Supabase dès que config.js est rempli : tout le monde voit la même chose.
   Chaque appareil en garde une copie (localStorage) pour s'ouvrir tout de
   suite et continuer à marcher sans réseau ; ce qui est saisi hors ligne part
   au retour de la connexion. Sans config.js, l'outil fonctionne seul sur
   l'appareil, comme avant. Les photos, elles, ne quittent jamais l'appareil. */

'use strict';

// ---------------------------------------------------------------- stockage --
const CLE = 'espace-jeunesse.v1';
const TYPES = ['groupes', 'membres', 'assises', 'dars'];

const vide = () => ({
  version: 1,
  groupes: [
    { id: 'g-college', nom: 'Collège — 4ème / 3ème', encadrant: 'Amine', ordre: 1 },
    { id: 'g-lycee',   nom: 'Lycée',                 encadrant: 'Adel',  ordre: 2 }
  ],
  membres: [],
  assises: [],
  dars: []
});

let D = charger();
let darsPartages = [];

/* Le profil dit quel groupe cet appareil suit : Amine le collège, Adel le
   lycée, le référent les deux. Il reste propre à l'appareil et ne voyage pas
   dans la base — sinon le choix de l'un changerait la vue de l'autre. */
const CLE_PROFIL = 'espace-jeunesse.profil';
let profil = localStorage.getItem(CLE_PROFIL) || '';

function profilOk()      { return profil === 'tous' || !!groupe(profil); }
function estVisible(gid) { return profil === 'tous' || gid === profil; }

function groupesVisibles() {
  return (profil === 'tous' ? D.groupes.slice() : [groupe(profil)].filter(Boolean))
    .sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
}

/* le groupe « par défaut » d'une action : celui de l'encadrant, ou rien pour
   le référent — le formulaire lui demandera alors lequel */
function gidParDefaut() { return profil === 'tous' ? '' : profil; }

function choisirProfil(p) {
  profil = p;
  localStorage.setItem(CLE_PROFIL, p);
  vue.gid = p === 'tous' ? null : p;
  vue.membreId = vue.darsId = null;
  fermerModale();
  aller('accueil');
}

function nomProfil() {
  if (profil === 'tous') return 'Les deux groupes';
  const g = groupe(profil);
  return g ? g.nom : 'Espace Jeunesse';
}

function charger() {
  try {
    const brut = localStorage.getItem(CLE);
    if (!brut) return vide();
    return Object.assign(vide(), JSON.parse(brut));
  } catch (e) {
    console.error('Lecture des données impossible', e);
    return vide();
  }
}

function cacheLocal() {
  try {
    localStorage.setItem(CLE, JSON.stringify(D));
  } catch (e) {
    toast('Mémoire du téléphone pleine : enregistrement impossible', true);
    console.error(e);
  }
}

/* Point d'entrée unique de toute modification : copie locale tout de suite,
   envoi vers la base partagée juste après. */
function sauver() {
  cacheLocal();
  if (partageOk()) planifierEnvoi();
}

// ----------------------------------------------------------------- partage --
/* Une seule table « objets » : une ligne par groupe, jeune, assise ou dars,
   l'objet entier rangé en JSON. Chaque groupe étant tenu par un seul
   encadrant, deux personnes ne modifient presque jamais le même objet en même
   temps ; la dernière écriture gagne, objet par objet.

   Pour savoir quoi envoyer, on garde l'empreinte de chaque objet tel que la
   base le connaît : un objet dont l'empreinte a changé est à envoyer, une
   empreinte sans objet est une suppression. Les suppressions sont « douces »
   (supprime = true) pour que les autres appareils les apprennent aussi. */
const CFG = window.EJ_CONFIG || {};
const CLE_CODE = 'espace-jeunesse.code';
const CLE_SYNCHRO = 'espace-jeunesse.synchro';

const partage = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(CLE_SYNCHRO) || '{}'); } catch (e) { /* on repart de zéro */ }
  return {
    actif: !!(CFG.supabaseUrl && CFG.supabaseKey),
    code: localStorage.getItem(CLE_CODE) || '',
    etat: 'local',
    empreintes: s.e || {},
    dernier: s.d || '',
    verifie: false, envoie: false, recoit: false, minuterie: null
  };
})();

function partageOk() { return partage.actif && !!partage.code; }
function besoinCode() { return partage.actif && !partage.code; }

function memoriser() {
  try { localStorage.setItem(CLE_SYNCHRO, JSON.stringify({ e: partage.empreintes, d: partage.dernier })); }
  catch (e) { console.error(e); }
}

/* JSON à clés triées : la base range les clés à sa façon, il faut que le même
   objet donne la même empreinte d'un côté comme de l'autre. */
function stable(o) {
  if (Array.isArray(o)) return '[' + o.map(stable).join(',') + ']';
  if (o && typeof o === 'object') return '{' + Object.keys(o).sort()
    .filter(k => o[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stable(o[k])).join(',') + '}';
  return JSON.stringify(o === undefined ? null : o);
}
function empreinte(o) {
  const s = stable(o);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36) + s.length.toString(36);
}

function objetsLocaux() {
  const m = new Map();
  for (const t of TYPES) for (const o of D[t]) m.set(t + ':' + o.id, { t, o });
  return m;
}

function aEnvoyer() {
  const loc = objetsLocaux(), lignes = [];
  for (const [k, { t, o }] of loc) {
    const h = empreinte(o);
    if (partage.empreintes[k] !== h) lignes.push({ id: k, type: t, data: o, supprime: false, h });
  }
  for (const k of Object.keys(partage.empreintes)) {
    if (!loc.has(k) && partage.empreintes[k] !== 'x')
      lignes.push({ id: k, type: k.split(':')[0], data: null, supprime: true, h: 'x' });
  }
  return lignes;
}

async function api(chemin, opts) {
  opts = opts || {};
  const entetes = { apikey: CFG.supabaseKey, 'Content-Type': 'application/json',
                    'x-espace-code': partage.code };
  // les anciennes clés « anon » sont des JWT ; les nouvelles clés publiques non
  if (/^eyJ/.test(CFG.supabaseKey)) entetes.Authorization = 'Bearer ' + CFG.supabaseKey;
  const r = await fetch(CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/' + chemin, {
    method: opts.method || 'GET', body: opts.body, keepalive: !!opts.keepalive,
    headers: Object.assign(entetes, opts.headers)
  });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

function planifierEnvoi() {
  clearTimeout(partage.minuterie);
  majEtat('attente');
  partage.minuterie = setTimeout(envoyer, 700);
}

async function envoyer(auDepart) {
  if (!partageOk() || partage.envoie) return;
  clearTimeout(partage.minuterie);
  const lignes = aEnvoyer();
  if (!lignes.length) { if (partage.etat !== 'code') majEtat('ok'); return; }
  partage.envoie = true;
  majEtat('envoi');
  try {
    for (let i = 0; i < lignes.length; i += 150) {
      const lot = lignes.slice(i, i + 150);
      await api('objets?on_conflict=id', {
        method: 'POST', keepalive: !!auDepart,
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(lot.map(l => ({ id: l.id, type: l.type, data: l.data, supprime: l.supprime })))
      });
      for (const l of lot) partage.empreintes[l.id] = l.h;
      memoriser();
    }
    majEtat('ok');
  } catch (e) {
    erreurReseau(e);
  } finally {
    partage.envoie = false;
  }
  // quelqu'un a pu pointer pendant l'envoi
  if (partage.etat === 'ok' && aEnvoyer().length) planifierEnvoi();
}

async function recevoir() {
  if (!partageOk() || partage.recoit) return false;
  partage.recoit = true;
  try {
    if (!partage.verifie) {
      const v = await api('objets?id=eq.verif&select=id');
      if (!v || !v.length) { codeRefuse(); return false; }
      partage.verifie = true;
    }
    let filtre = '';
    if (partage.dernier) {
      // 30 s de marge : une écriture lente peut s'horodater avant la dernière lue
      const t = Date.parse(partage.dernier.replace(/(\.\d{3})\d+/, '$1')) - 30000;
      if (!isNaN(t)) filtre = '&maj=gte.' + encodeURIComponent(new Date(t).toISOString());
    }
    const lignes = await api('objets?select=id,type,data,supprime,maj&order=maj.asc' + filtre);
    const change = integrer(lignes || []);
    if (lignes && lignes.length) partage.dernier = lignes[lignes.length - 1].maj;
    memoriser();
    if (change) { cacheLocal(); rendreSiPossible(); }
    if (partage.etat !== 'attente' && partage.etat !== 'envoi') majEtat('ok');
    return change;
  } catch (e) {
    erreurReseau(e);
    return false;
  } finally {
    partage.recoit = false;
  }
}

/* Range ce qui arrive de la base. Ce qui a été modifié ici et pas encore
   envoyé reste prioritaire. Les objets sont mis à jour sur place, pas
   remplacés : un formulaire ouvert garde ainsi la bonne référence. */
function integrer(lignes) {
  const premiere = !Object.keys(partage.empreintes).length;
  const locaux = objetsLocaux();
  // à la toute première connexion, la base fait foi pour ce qu'elle connaît déjà
  const enAttente = premiere ? new Set() : new Set(aEnvoyer().map(l => l.id));
  let change = false;

  for (const l of lignes) {
    if (!TYPES.includes(l.type) || enAttente.has(l.id)) continue;
    const loc = locaux.get(l.id);

    if (l.supprime) {
      if (loc) { D[l.type] = D[l.type].filter(o => o !== loc.o); change = true; }
      partage.empreintes[l.id] = 'x';
      continue;
    }
    if (!l.data || !l.data.id) continue;
    const h = empreinte(l.data);
    partage.empreintes[l.id] = h;
    if (loc) {
      if (empreinte(loc.o) === h) continue;
      for (const k of Object.keys(loc.o)) delete loc.o[k];
      Object.assign(loc.o, l.data);
      change = true;
      continue;
    }

    // la même assise saisie sur deux appareils avant le partage : on recolle
    if (premiere && l.type === 'assises') {
      const jumelle = D.assises.find(a => a.groupeId === l.data.groupeId && a.date === l.data.date
                                       && !partage.empreintes['assises:' + a.id]);
      if (jumelle) {
        const presences = Object.assign({}, jumelle.presences, l.data.presences);
        const fusion = Object.assign({}, jumelle, l.data, { presences,
          theme: l.data.theme || jumelle.theme, commentaire: l.data.commentaire || jumelle.commentaire });
        for (const k of Object.keys(jumelle)) delete jumelle[k];
        Object.assign(jumelle, fusion);
        change = true;
        continue;
      }
    }
    D[l.type].push(l.data);
    change = true;
  }
  return change;
}

function erreurReseau(e) {
  console.warn('Partage :', e);
  if (e && (e.status === 401 || e.status === 403)) return codeRefuse();
  majEtat(navigator.onLine === false || !e.status ? 'horsligne' : 'erreur');
}

function codeRefuse() {
  partage.code = '';
  partage.verifie = false;
  localStorage.removeItem(CLE_CODE);
  majEtat('code');
  fermerModale();
  rendre();
}

async function essayerCode(code) {
  partage.code = code;
  partage.verifie = false;
  try {
    const v = await api('objets?id=eq.verif&select=id');
    if (!v || !v.length) { partage.code = ''; return 'Ce code n\'est pas le bon.'; }
  } catch (e) {
    partage.code = '';
    return e.status ? 'La base ne répond pas correctement (erreur ' + e.status + ').'
                    : 'Pas de connexion internet. Réessaie une fois connecté.';
  }
  partage.verifie = true;
  localStorage.setItem(CLE_CODE, code);
  await recevoir();
  if (aEnvoyer().length) await envoyer();
  rendre();
  return '';
}

const ETATS = {
  local:     'Sur cet appareil',
  ok:        'À jour',
  attente:   'Envoi…',
  envoi:     'Envoi…',
  horsligne: 'Hors ligne',
  erreur:    'Non envoyé',
  code:      'Code ?'
};

function majEtat(e) {
  partage.etat = e;
  const b = $('#etat-synchro');
  if (!b) return;
  b.hidden = !partage.actif;
  b.dataset.etat = e;
  $('span', b).textContent = ETATS[e] || e;
  b.title = e === 'horsligne' ? 'Pas de réseau : ce qui est saisi partira au retour de la connexion'
          : e === 'erreur' ? 'Envoi impossible pour le moment, nouvel essai bientôt' : 'Partagé avec tous les encadrants';
}

async function synchroniserMaintenant() {
  if (besoinCode()) return rendre();
  await envoyer();
  await recevoir();
  toast(partage.etat === 'ok' ? 'Tout est à jour'
      : partage.etat === 'horsligne' ? 'Pas de réseau — ce sera envoyé plus tard'
      : 'La base partagée ne répond pas', partage.etat !== 'ok');
}

// ------------------------------------------------------------------ photos --
/* Des photos dans localStorage feraient sauter le quota en une assise. Elles
   vont donc dans IndexedDB, et dans deux magasins séparés : les vignettes,
   légères, qu'on charge d'un bloc pour l'album, et les originaux, qu'on ne lit
   que lorsqu'on ouvre une photo en grand. Elles ne quittent jamais l'appareil
   et ne partent ni dans la base partagée, ni dans l'export JSON. */
const BASE_PHOTOS = 'espace-jeunesse-photos';
let basePromesse = null;
let album = [];          // les vignettes, triées de la plus récente à la plus ancienne

function basePhotos() {
  if (!basePromesse) basePromesse = new Promise((res, rej) => {
    const r = indexedDB.open(BASE_PHOTOS, 1);
    r.onupgradeneeded = () => {
      const b = r.result;
      if (!b.objectStoreNames.contains('vignettes')) b.createObjectStore('vignettes', { keyPath: 'id' });
      if (!b.objectStoreNames.contains('originaux')) b.createObjectStore('originaux');
    };
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
  return basePromesse;
}

function idbTout(magasin) {
  return basePhotos().then(b => new Promise((res, rej) => {
    const r = b.transaction(magasin).objectStore(magasin).getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
function idbLire(magasin, cle) {
  return basePhotos().then(b => new Promise((res, rej) => {
    const r = b.transaction(magasin).objectStore(magasin).get(cle);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
}
function idbEcrire(magasin, valeur, cle) {
  return basePhotos().then(b => new Promise((res, rej) => {
    const t = b.transaction(magasin, 'readwrite');
    cle === undefined ? t.objectStore(magasin).put(valeur) : t.objectStore(magasin).put(valeur, cle);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}
function idbEffacer(magasin, cle) {
  return basePhotos().then(b => new Promise((res, rej) => {
    const t = b.transaction(magasin, 'readwrite');
    t.objectStore(magasin).delete(cle);
    t.oncomplete = () => res(); t.onerror = () => rej(t.error);
  }));
}

/* Une photo de téléphone pèse 4 Mo ; réduite au format d'un écran elle en pèse
   200 Ko, et personne ne verra la différence sur un souvenir d'assise. */
function reduire(fichier, cote) {
  const dessiner = (source, l, h) => {
    const r = Math.min(1, cote / Math.max(l, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(l * r));
    c.height = Math.max(1, Math.round(h * r));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  };

  // createImageBitmap redresse les photos prises de travers (orientation EXIF)
  if (window.createImageBitmap) {
    return createImageBitmap(fichier, { imageOrientation: 'from-image' })
      .then(bmp => {
        const c = dessiner(bmp, bmp.width, bmp.height);
        bmp.close && bmp.close();
        return c;
      });
  }
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload  = () => { const c = dessiner(img, img.naturalWidth, img.naturalHeight);
                          URL.revokeObjectURL(url); res(c); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('image illisible')); };
    img.src = url;
  });
}

function versBlob(canvas, qualite) {
  return new Promise((res, rej) =>
    canvas.toBlob(b => b ? res(b) : rej(new Error('conversion impossible')), 'image/jpeg', qualite));
}

async function ajouterPhotos(fichiers, cible) {
  let n = 0;
  for (const f of fichiers) {
    if (!f.type.startsWith('image/')) continue;
    try {
      const grand  = await reduire(f, 1600);
      const petit  = await reduire(f, 420);
      const blob   = await versBlob(grand, 0.78);
      const pid    = id();
      const fiche  = {
        id: pid, groupeId: cible.gid, date: cible.date,
        assiseId: cible.assiseId || '', legende: '',
        poids: blob.size, largeur: grand.width, hauteur: grand.height,
        vignette: petit.toDataURL('image/jpeg', 0.6),
        ajoutee: new Date().toISOString()
      };
      await idbEcrire('originaux', blob, pid);
      await idbEcrire('vignettes', fiche);
      album.unshift(fiche);
      n++;
    } catch (e) {
      console.error('Photo ignorée', f.name, e);
    }
  }
  album.sort((a, b) => (b.date + b.ajoutee).localeCompare(a.date + a.ajoutee));
  rendre();
  toast(n ? `${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}` : 'Aucune photo lisible', !n);
}

function photosDe(gid, date) {
  return album.filter(p => (gid ? p.groupeId === gid : estVisible(p.groupeId))
                        && (!date || p.date === date));
}

// ------------------------------------------------------------------ outils --
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const echap = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// la date du jour à l'heure locale : toISOString() donnerait la veille après minuit
function aujourdhui() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const pluriel = (n, mot, motP) => `${n} ${n > 1 ? (motP || mot + 's') : mot}`;

function dateFr(iso, long) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function dateCourte(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function avatarDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return `<span class="avatar date">?</span>`;
  return `<span class="avatar date">${d.getDate()}<small>${
    d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</small></span>`;
}

function initiales(m) {
  return ((m.prenom || '')[0] || '?').toUpperCase() + ((m.nom || '')[0] || '').toUpperCase();
}

const nomComplet = (m) => ((m.prenom || '') + ' ' + (m.nom || '')).trim();

const ICO = {
  fleche:   '<path d="m9 6 6 6-6 6"/>',
  plus:     '<path d="M12 5v14M5 12h14"/>',
  check:    '<path d="m5 12.5 4.5 4.5L19 7"/>',
  appel:    '<rect x="5" y="4" width="14" height="17" rx="2.5"/><path d="M9 3h6v3H9z"/><path d="m9 13.5 2 2 4-4.5"/>',
  cal:      '<rect x="3.5" y="5" width="17" height="16" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  users:    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  ajout:    '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 11-4.7"/><path d="M19 14v6M16 17h6"/>',
  livre:    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  photo:    '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  tel:      '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  sms:      '<path d="M4 5h16v11H9l-5 4z"/>',
  loupe:    '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  imprimer: '<path d="M7 9V4h10v5M7 17H4v-7h16v7h-3"/><path d="M7 14h10v6H7z"/>',
  crayon:   '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  note:     '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/>',
  poubelle: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  effacer:  '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  alerte:   '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4M12 17v.5"/>',
  croix:    '<path d="M6 6l12 12M18 6 6 18"/>'
};
const ico = (n) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[n] || ''}</svg>`;
const fleche = () => `<svg class="ico fleche" viewBox="0 0 24 24" aria-hidden="true">${ICO.fleche}</svg>`;

function groupe(gid) { return D.groupes.find(g => g.id === gid); }

function membresDe(gid, avecInactifs) {
  return D.membres
    .filter(m => m.groupeId === gid && (avecInactifs || m.actif !== false))
    .sort((a, b) => nomComplet(a).localeCompare(nomComplet(b), 'fr'));
}

/* Sans groupe précisé, on ne ressort que les assises des groupes visibles :
   le cloisonnement vaut pour tout ce qui remonte à l'écran. */
function assisesDe(gid) {
  return D.assises
    .filter(a => gid ? a.groupeId === gid : estVisible(a.groupeId))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/* Taux de présence d'un jeune : les excusés ne pénalisent pas, ils sortent du
   calcul. Un retard compte comme une présence. */
function taux(membreId, gid) {
  let ok = 0, ko = 0, exc = 0;
  for (const a of D.assises) {
    if (a.groupeId !== gid) continue;
    const s = a.presences && a.presences[membreId];
    if (s === 'present' || s === 'retard') ok++;
    else if (s === 'absent') ko++;
    else if (s === 'excuse') exc++;
  }
  const base = ok + ko;
  return { ok, ko, exc, base, pct: base ? Math.round(ok / base * 100) : null };
}

/* Décrochage : les trois derniers pointages renseignés sont des absences. */
function decroche(membreId, gid) {
  const suite = assisesDe(gid)
    .map(a => a.presences && a.presences[membreId])
    .filter(s => s === 'present' || s === 'retard' || s === 'absent' || s === 'excuse')
    .slice(0, 3);
  return suite.length === 3 && suite.every(s => s === 'absent');
}

function classeJauge(pct) { return pct >= 75 ? '' : pct >= 50 ? 'moyen' : 'bas'; }

function toast(txt, erreur) {
  const t = $('#toast');
  t.innerHTML = (erreur ? '' : ico('check')) + `<span>${echap(txt)}</span>`;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function vibrer() { try { navigator.vibrate && navigator.vibrate(8); } catch (e) { /* sans effet */ } }

// -------------------------------------------------------- fenêtres, dialogues --
function modale(titre, html) {
  const deja = !$('#modal-back').hidden;
  $('#modal-title').textContent = titre;
  $('#modal-body').innerHTML = html;
  $('#modal-back').hidden = false;
  $('.modal').scrollTop = 0;
  document.body.style.overflow = 'hidden';
  if (!deja) pousser();
}

/* depuisHisto : la fenêtre se ferme parce qu'on a appuyé sur « retour » ; il
   ne faut alors pas reculer une seconde fois. */
function fermerModale(depuisHisto) {
  if ($('#modal-back').hidden) return;
  $('#modal-back').hidden = true;
  $('#modal-body').innerHTML = '';
  document.body.style.overflow = '';
  if (!depuisHisto && history.state && history.state.modal) {
    retourEnCours = true;
    history.back();
  }
  if (rendreEnAttente) rendre();
}

/* Remplace confirm() : plus lisible, et les boutons disent ce qu'ils font.
   Résout avec la valeur du choix, ou null si on annule. */
let repondreA = null;
function demander(titre, texte, choix, annuler) {
  if (repondreA) repondre(null);
  $('#confirm-titre').textContent = titre;
  $('#confirm-texte').textContent = texte || '';
  $('#confirm-texte').hidden = !texte;
  $('#confirm-choix').innerHTML = choix.map((c, i) =>
    `<button class="btn ${'cls' in c ? c.cls : 'btn-primary'}" data-reponse="${i}">${echap(c.label)}</button>`).join('')
    + `<button class="btn btn-ghost" data-reponse="-1">${echap(annuler || 'Annuler')}</button>`;
  $('#confirm-back').hidden = false;
  return new Promise(res => { repondreA = (i) => res(i == null || i < 0 ? null : choix[i].val); });
}
function repondre(i) {
  $('#confirm-back').hidden = true;
  const f = repondreA;
  repondreA = null;
  if (f) f(i);
}
const confirmer = (titre, texte, ok, danger) =>
  demander(titre, texte, [{ label: ok, val: true, cls: danger ? 'btn-danger-plein' : 'btn-primary' }]);

function telecharger(nomFichier, contenu, type) {
  const blob = new Blob([contenu], { type: type || 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -------------------------------------------------------------- navigation --
/* Chaque écran et chaque fenêtre ouverte a son entrée dans l'historique du
   navigateur : le bouton « retour » du téléphone ferme la fenêtre ou revient
   à l'écran d'avant, au lieu de quitter l'application. */
const vue = { nom: 'accueil', gid: null, membreId: null, darsId: null, date: aujourdhui() };
const CHAMPS_VUE = ['nom', 'gid', 'membreId', 'darsId', 'date'];
const copieVue = () => CHAMPS_VUE.reduce((o, k) => (o[k] = vue[k] || null, o), {});
const memeVue = (a, b) => !!a && !!b && CHAMPS_VUE.every(k => (a[k] || null) === (b[k] || null));

let retourEnCours = false, pousseDiffere = false, rendreEnAttente = false;

function etatHisto() {
  return { v: copieVue(), modal: !$('#modal-back').hidden,
           n: ((history.state && history.state.n) || 0) + 1 };
}
function pousser() {
  if (retourEnCours) { pousseDiffere = true; return; }
  const s = history.state;
  if (s && memeVue(s.v, copieVue()) && !!s.modal === !$('#modal-back').hidden) return;
  history.pushState(etatHisto(), '');
}
function remplacer() {
  history.replaceState(Object.assign({ n: 0 }, history.state, { v: copieVue() }), '');
}

function majOnglets() {
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === vue.nom));
}

function aller(nom, extra) {
  Object.assign(vue, { membreId: null, darsId: null }, extra || {}, { nom });
  majOnglets();
  window.scrollTo(0, 0);
  rendre();
  pousser();
}

function ouvrir(extra) {
  Object.assign(vue, extra);
  majOnglets();
  window.scrollTo(0, 0);
  rendre();
  pousser();
}

const sousVue = () => !!(vue.membreId || vue.darsId || (vue.nom === 'groupes' && profil === 'tous' && vue.gid));

function retour() {
  if (history.state && history.state.n > 0) return history.back();
  if (vue.membreId) vue.membreId = null;
  else if (vue.darsId) vue.darsId = null;
  else vue.gid = null;
  remplacer();
  window.scrollTo(0, 0);
  rendre();
}

window.addEventListener('popstate', (e) => {
  if (retourEnCours) {
    retourEnCours = false;
    if (pousseDiffere) { pousseDiffere = false; history.pushState(etatHisto(), ''); }
    return;
  }
  if (repondreA) repondre(null);
  if (!$('#modal-back').hidden) fermerModale(true);
  const v = e.state && e.state.v;
  if (v && !memeVue(v, copieVue())) {
    Object.assign(vue, v);
    majOnglets();
    window.scrollTo(0, 0);
    rendre();
  } else if (rendreEnAttente) rendre();
});

/* Ce qui arrive de la base ne doit pas effacer une saisie en cours : on
   attend que la fenêtre se ferme ou que le champ perde le focus. */
function rendreSiPossible() {
  const f = document.activeElement;
  const saisie = f && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName) && $('#app').contains(f);
  if (!$('#modal-back').hidden || saisie) { rendreEnAttente = true; return; }
  rendre();
}

function rendre() {
  const app = $('#app');
  rendreEnAttente = false;
  majEntete();

  if (besoinCode())  { app.innerHTML = vueCode(); return; }
  if (!profilOk())   { app.innerHTML = vueBienvenue(); return; }

  // un encadrant ne navigue jamais hors de son groupe
  if (profil !== 'tous') vue.gid = profil;
  if (vue.membreId) {
    const m = D.membres.find(x => x.id === vue.membreId);
    if (!m || !estVisible(m.groupeId)) vue.membreId = null;
  }
  majEntete();

  if (vue.membreId)      app.innerHTML = vueMembre(vue.membreId);
  else if (vue.darsId)   app.innerHTML = vueDars(vue.darsId);
  else if (vue.nom === 'accueil')  app.innerHTML = vueAccueil();
  else if (vue.nom === 'appel')    app.innerHTML = vueAppel();
  else if (vue.nom === 'planning') app.innerHTML = vuePlanning();
  else if (vue.nom === 'groupes')  app.innerHTML = vue.gid ? vueGroupe(vue.gid) : vueGroupes();
  else if (vue.nom === 'dars')     app.innerHTML = vueListeDars();
  else if (vue.nom === 'photos')   app.innerHTML = vueSouvenirs();
}

function majEntete() {
  const t = $('#titre-profil');
  if (!t) return;
  const pret = profilOk() && !besoinCode();
  t.textContent = pret ? nomProfil() : 'Espace Jeunesse';
  t.classList.toggle('cliquable', pret);
  t.title = pret ? 'Changer de groupe' : '';
  $('#tabs').hidden = !pret;
  const r = pret && sousVue();
  $('#btn-retour').hidden = !r;
  $('#brand-mark').hidden = r;
  majEtat(partage.actif ? partage.etat : 'local');
}

// ------------------------------------------------------- écrans d'entrée ---
function vueCode() {
  return `<div class="bienvenue">
    <div class="logo">EJ</div>
    <h1>Espace Jeunesse</h1>
    <p class="sub">Les groupes, les jeunes et les appels sont partagés entre tous les encadrants.
      Entre le code d'accès qu'on t'a donné — il n'est demandé qu'une fois sur ce téléphone.</p>
    <form id="f-code" class="card">
      <label class="field"><span>Code d'accès</span>
        <input type="password" name="code" required autocomplete="current-password"
               autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go"></label>
      <p class="faint" id="code-erreur" style="color:var(--absent);margin:-4px 0 12px" hidden></p>
      <button type="submit" class="btn btn-primary btn-lg btn-wide">Se connecter</button>
    </form>
  </div>`;
}

function vueBienvenue() {
  const gs = D.groupes.slice().sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  return `<div class="bienvenue">
    <div class="logo">EJ</div>
    <h1>Bienvenue</h1>
    <p class="sub">Quel groupe suis-tu sur ce téléphone ? Tu ne verras que tes jeunes et tes assises.</p>
    ${gs.map(g => `
      <button class="choix" data-profil="${g.id}">
        <span class="avatar">${echap((g.nom[0] || 'G').toUpperCase())}</span>
        <span class="grow">
          <span class="choix-nom">${echap(g.nom)}</span>
          <span class="choix-sous">${g.encadrant ? 'Encadré par ' + echap(g.encadrant) : 'Sans encadrant'} · ${
            pluriel(membresDe(g.id).length, 'jeune')}</span>
        </span>${fleche()}
      </button>`).join('')}
    <button class="choix" data-profil="tous">
      <span class="avatar">${ico('users')}</span>
      <span class="grow">
        <span class="choix-nom">Les deux groupes</span>
        <span class="choix-sous">Vue du référent</span>
      </span>${fleche()}
    </button>
    <p class="faint" style="margin-top:16px">Ce choix se change à tout moment en touchant le nom du groupe, en haut.</p>
  </div>`;
}

function changerProfil() {
  modale('Quel groupe suit ce téléphone ?', `
    ${D.groupes.map(g => `<button class="choix${g.id === profil ? ' actif' : ''}" data-profil="${g.id}">
      <span class="avatar">${echap((g.nom[0] || 'G').toUpperCase())}</span>
      <span class="grow">
        <span class="choix-nom">${echap(g.nom)}</span>
        <span class="choix-sous">${g.encadrant ? echap(g.encadrant) : '—'} · ${pluriel(membresDe(g.id).length, 'jeune')}</span>
      </span>${g.id === profil ? ico('check') : ''}
    </button>`).join('')}
    <button class="choix${profil === 'tous' ? ' actif' : ''}" data-profil="tous">
      <span class="avatar">${ico('users')}</span>
      <span class="grow">
        <span class="choix-nom">Les deux groupes</span>
        <span class="choix-sous">Vue du référent</span>
      </span>${profil === 'tous' ? ico('check') : ''}
    </button>
    <p class="faint">Changer de groupe ne touche à aucune donnée : ça change seulement ce que ce téléphone affiche.</p>`);
}

// ----------------------------------------------------------------- accueil --
function heroGroupe(g) {
  const ms = membresDe(g.id);
  const a = trouverAssise(g.id, aujourdhui());
  const c = a ? compte(a) : null;
  const pointes = c ? c.present + c.retard + c.excuse + c.absent : 0;
  const nom = profil === 'tous' ? echap(g.nom) + ' — ' : '';
  let t, s, btn;

  if (!ms.length) {
    t = nom + 'Aucun jeune inscrit';
    s = 'Commence par inscrire la liste';
    btn = `<button class="btn" data-ajout-rapide="${g.id}">${ico('ajout')}Inscrire</button>`;
  } else if (a && a.terminee) {
    t = nom + 'Appel validé';
    s = `${c.present + c.retard} présent${c.present + c.retard > 1 ? 's' : ''} sur ${ms.length}`;
    btn = `<button class="btn fait" data-go-appel="${g.id}">${ico('check')}Voir</button>`;
  } else if (pointes) {
    t = nom + 'Appel en cours';
    s = `${pointes} / ${ms.length} pointés`;
    btn = `<button class="btn" data-go-appel="${g.id}">Reprendre</button>`;
  } else {
    t = nom + (a && a.theme ? echap(a.theme) : "L'assise d'aujourd'hui");
    s = a ? [a.heure, a.lieu].filter(Boolean).map(echap).join(' · ') || 'Programmée' : pluriel(ms.length, 'jeune') + ' à pointer';
    btn = `<button class="btn" data-go-appel="${g.id}">${ico('appel')}Faire l'appel</button>`;
  }
  return `<div class="hero-groupe">
    <div class="grow"><div class="t">${t}</div><div class="s">${s}</div></div>${btn}
  </div>`;
}

function vueAccueil() {
  const gs = groupesVisibles();
  const total = gs.reduce((n, g) => n + membresDe(g.id).length, 0);
  const alertes = [];
  for (const g of gs) {
    for (const m of membresDe(g.id)) {
      if (decroche(m.id, g.id)) alertes.push({ m, g, motif: '3 absences de suite' });
      else {
        const t = taux(m.id, g.id);
        if (t.base >= 4 && t.pct < 50) alertes.push({ m, g, motif: 'moins de 50 % de présence' });
      }
    }
  }
  const auj = aujourdhui();
  const seul = gidParDefaut();

  let h = `<section class="hero">
    <div class="hero-date">${echap(dateCourte(auj))}</div>
    <h1>Assalamu alaykum</h1>
    <p>${pluriel(total, 'jeune')} suivi${total > 1 ? 's' : ''} · ${pluriel(passees().length, 'assise')}</p>
    ${gs.map(heroGroupe).join('')}
  </section>

  <div class="raccourcis">
    <button class="raccourci" data-ajout-rapide="${seul}"><span class="rond">${ico('ajout')}</span>Inscrire des jeunes</button>
    <button class="raccourci" data-programmer="${seul}"><span class="rond">${ico('cal')}</span>Programmer</button>
    <button class="raccourci" id="add-dars"><span class="rond">${ico('livre')}</span>Nouveau dars</button>
    ${seul ? `<button class="raccourci" data-photo-pour="${seul}"><span class="rond">${ico('photo')}</span>Photo</button>`
           : `<button class="raccourci" data-aller="photos"><span class="rond">${ico('photo')}</span>Photos</button>`}
  </div>`;

  if (alertes.length) {
    h += `<div class="section"><h2>À rappeler</h2><span class="chip chip-alert">${alertes.length}</span></div>
    <div class="liste">${alertes.slice(0, 8).map(a => `
      <button class="item" data-membre="${a.m.id}" data-gid="${a.g.id}">
        <span class="avatar" style="background:color-mix(in srgb,var(--absent) 13%,transparent);color:var(--absent)">${echap(initiales(a.m))}</span>
        <span class="grow">
          <span class="ligne-nom" style="display:block">${echap(nomComplet(a.m))}</span>
          <span class="ligne-meta">${echap(a.motif)}${profil === 'tous' ? ' · ' + echap(a.g.nom) : ''}</span>
        </span>${fleche()}
      </button>`).join('')}</div>`;
  }

  const prochaine = aVenir().filter(a => a.date > auj)[0];
  if (prochaine) {
    h += `<div class="section"><h2>Prochaine assise</h2></div>
    <div class="liste">${ligneAssise(prochaine)}</div>`;
  }

  h += `<div class="section"><h2>Présence</h2><span class="faint">8 dernières assises</span></div>
  <div class="tuiles">
    ${gs.map(g => {
      const ms = membresDe(g.id);
      let ok = 0, base = 0;
      for (const a of assisesDe(g.id).filter(a => a.date <= auj).slice(0, 8)) for (const m of ms) {
        const s = a.presences && a.presences[m.id];
        if (s === 'present' || s === 'retard') { ok++; base++; }
        else if (s === 'absent') base++;
      }
      const pct = base ? Math.round(ok / base * 100) : null;
      return `<button class="tuile" data-groupe="${g.id}" style="text-align:left;font:inherit;color:inherit;cursor:pointer">
        <div class="n">${pct === null ? '—' : pct + ' %'}</div>
        <div class="l">${echap(g.nom)}</div>
        <div class="muted" style="margin-top:4px">${pluriel(ms.length, 'jeune')}${g.encadrant ? ' · ' + echap(g.encadrant) : ''}</div>
        ${pct === null ? '' : `<div class="jauge ${classeJauge(pct)}"><i style="width:${pct}%"></i></div>`}
      </button>`;
    }).join('')}
  </div>`;

  const recentes = passees().slice(0, 5);
  h += `<div class="section"><h2>Dernières assises</h2></div>`;
  h += recentes.length ? `<div class="liste">${recentes.map(ligneAssise).join('')}</div>`
                       : `<div class="empty">Aucune assise passée pour le moment.</div>`;
  return h;
}

function puceAssise(a) {
  const c = compte(a);
  const n = c.present + c.retard;
  if (a.terminee) return `<span class="chip c-present">${ico('check').replace('class="ico"', 'class="ico" style="width:13px;height:13px"')}${n}</span>`;
  if (c.present + c.retard + c.excuse + c.absent) return `<span class="chip c-retard">${n} · en cours</span>`;
  return a.date >= aujourdhui() ? `<span class="chip chip-accent">${echap(ecart(a.date))}</span>`
                                : `<span class="chip">pas d'appel</span>`;
}

function ligneAssise(a) {
  const g = groupe(a.groupeId);
  return `<button class="item" data-assise="${a.id}">
    ${avatarDate(a.date)}
    <span class="grow">
      <span class="ligne-nom truncate" style="display:block">${echap(a.theme || 'Assise')}</span>
      <span class="ligne-meta truncate" style="display:block">${echap(dateCourte(a.date))}${
        a.heure ? ' · ' + echap(a.heure) : ''}${a.lieu ? ' · ' + echap(a.lieu) : ''}${
        g && profil === 'tous' ? ' · ' + echap(g.nom) : ''}</span>
    </span>
    ${puceAssise(a)}
  </button>`;
}

/* Les jeunes qui ne viennent plus ne sont plus « à pointer », mais leurs
   pointages passés comptent toujours. */
function compte(a) {
  const c = { present: 0, retard: 0, excuse: 0, absent: 0, vide: 0 };
  for (const m of membresDe(a.groupeId, true)) {
    const s = a.presences && a.presences[m.id];
    if (c[s] !== undefined) c[s]++;
    else if (m.actif !== false) c.vide++;
  }
  return c;
}

// -------------------------------------------------------------------- appel --
function trouverAssise(gid, date) {
  return D.assises.find(a => a.groupeId === gid && a.date === date);
}

const ETAT = { present: 'Présent', retard: 'Retard', excuse: 'Excusé', absent: 'Absent' };
const SIGNE = { present: '✓', retard: '◷', excuse: '✉', absent: '✕' };

function vueAppel() {
  const gs = groupesVisibles();
  const gid = (estVisible(vue.gid) && vue.gid) || (gs[0] && gs[0].id);
  if (!gid) return `<div class="empty">Crée d'abord un groupe dans l'onglet Jeunes.</div>`;
  vue.gid = gid;
  const g = groupe(gid);
  const ms = membresDe(gid);
  const a = trouverAssise(gid, vue.date);
  const c = a ? compte(a) : { present: 0, retard: 0, excuse: 0, absent: 0, vide: ms.length };
  const pointes = c.present + c.retard + c.excuse + c.absent;
  const auj = aujourdhui();

  let h = `<div class="entete"><div class="grow">
      <h1>Appel</h1>
      <p class="sub">${echap(dateCourte(vue.date))}${profil === 'tous' ? ' · ' + echap(g.nom) : ''}</p>
    </div></div>

  ${vue.date !== auj ? `<div class="bandeau-date">
      <span class="grow">Tu pointes l'assise du <b>${echap(dateFr(vue.date))}</b>, pas celle d'aujourd'hui.</span>
      <button class="btn btn-sm" id="appel-auj">Aujourd'hui</button>
    </div>` : ''}

  <div class="card">
    <div class="field-2${gs.length > 1 ? ' souple' : ''}" style="${gs.length > 1 ? '' : 'grid-template-columns:1fr'}">
      ${gs.length > 1 ? `<label class="field"><span>Groupe</span>
        <select id="sel-groupe">${gs.map(x =>
          `<option value="${x.id}"${x.id === gid ? ' selected' : ''}>${echap(x.nom)}</option>`).join('')}</select>
      </label>` : ''}
      <label class="field"><span>Date de l'assise</span>
        <input type="date" id="sel-date" value="${vue.date}">
      </label>
    </div>
    <label class="field" style="margin-bottom:0">
      <span style="display:flex;justify-content:space-between;gap:8px">Thème / dars du jour
        <em class="etat-save" style="font-style:normal">Enregistré automatiquement</em></span>
      <input type="text" id="in-theme" placeholder="Ex. La sincérité dans l'intention"
             enterkeyhint="done" value="${echap(a ? a.theme || '' : '')}">
    </label>
  </div>`;

  if (!ms.length) {
    return h + `<div class="empty">${ico('users').replace('class="ico"', 'class="ico empty-ico"')}
      Aucun jeune inscrit dans ce groupe.<br>L'appel se remplira une fois la liste faite.<br>
      <button class="btn btn-primary" data-ajout-rapide="${gid}">${ico('ajout')}Inscrire les jeunes</button></div>`;
  }

  h += `<div class="outils">
      ${c.vide ? `<button class="btn btn-sm btn-soft" id="tout-present">${ico('check')}${pointes ? 'Les autres présents' : 'Tous présents'}</button>` : ''}
      <button class="btn btn-sm" data-ajout-rapide="${gid}">${ico('ajout')}Nouveau</button>
      ${pointes ? `<button class="btn btn-sm" id="raz">${ico('effacer')}Effacer</button>` : ''}
      <button class="btn btn-sm" id="imprimer">${ico('imprimer')}Imprimer</button>
  </div>
  <div class="appel-head">
    <div class="compte">
      <span class="chip c-present">${c.present} présent${c.present > 1 ? 's' : ''}</span>
      ${c.retard ? `<span class="chip c-retard">${c.retard} retard${c.retard > 1 ? 's' : ''}</span>` : ''}
      ${c.excuse ? `<span class="chip c-excuse">${c.excuse} excusé${c.excuse > 1 ? 's' : ''}</span>` : ''}
      <span class="chip c-absent">${c.absent} absent${c.absent > 1 ? 's' : ''}</span>
      ${c.vide ? `<span class="chip">${c.vide} à pointer</span>` : ''}
    </div>
  </div>

  <div class="pointage">`;

  for (const m of ms) {
    const s = (a && a.presences && a.presences[m.id]) || '';
    const t = taux(m.id, gid);
    h += `<div class="ligne" data-etat="${s}">
      <div class="card-row">
        <span class="avatar">${echap(initiales(m))}</span>
        <span class="grow">
          <div class="ligne-nom truncate">${echap(nomComplet(m))}</div>
          <div class="ligne-meta">${m.niveau ? echap(m.niveau) + ' · ' : ''}${
            t.pct === null ? 'nouveau' : t.pct + ' % de présence'}</div>
        </span>
        <button class="icon-btn" data-membre="${m.id}" data-gid="${gid}" aria-label="Fiche de ${echap(nomComplet(m))}">${fleche()}</button>
      </div>
      <div class="seg" data-membre-seg="${m.id}" role="group" aria-label="Présence de ${echap(nomComplet(m))}">
        ${['present', 'retard', 'excuse', 'absent'].map(v =>
          `<button data-v="${v}" data-on="${s === v ? 1 : 0}" aria-pressed="${s === v}"><b>${SIGNE[v]}</b>${ETAT[v]}</button>`).join('')}
      </div>
    </div>`;
  }

  const souvenirs = photosDe(gid, vue.date);
  h += `</div>

  <div class="card" style="margin-top:16px">
    <div class="card-row" style="margin-bottom:12px">
      <h3 class="grow" style="margin:0">Souvenir de l'assise</h3>
      <button class="btn btn-sm btn-soft" data-photo-pour="${gid}">${ico('photo')}Photo</button>
    </div>
    ${souvenirs.length
      ? `<div class="album">${souvenirs.map(p => `<button class="vign" data-photo="${p.id}">
           <img src="${p.vignette}" alt="Photo de l'assise" loading="lazy"></button>`).join('')}</div>`
      : `<p class="faint" style="margin:0">Une photo de groupe à la fin, et l'année se raconte toute seule. Elle reste sur ce téléphone.</p>`}
  </div>

  <div class="card">
    <label class="field" style="margin-bottom:0">
      <span style="display:flex;justify-content:space-between;gap:8px">Remarques sur l'assise
        <em class="etat-save" style="font-style:normal">Enregistré automatiquement</em></span>
      <textarea id="in-commentaire" placeholder="Ce qui a marché, ce qui est à reprendre, les points à suivre…">${echap(a ? a.commentaire || '' : '')}</textarea>
    </label>
  </div>

  <div class="espace-barre"></div>
  <div class="barre-appel">
    <div class="barre-appel-in">
      <div class="progres">
        <b>${pointes} / ${ms.length}</b> <span class="muted">pointé${pointes > 1 ? 's' : ''}</span>
        <div class="jauge accent"><i style="width:${Math.round(pointes / ms.length * 100)}%"></i></div>
      </div>
      ${a && a.terminee
        ? `<button class="btn btn-soft" id="voir-recap">${ico('check')}Appel validé</button>`
        : `<button class="btn btn-primary" id="valider-appel">${ico('check')}Valider l'appel</button>`}
    </div>
  </div>`;
  return h;
}

function assiseCourante(creer) {
  const gid = vue.gid || (D.groupes[0] && D.groupes[0].id);
  let a = trouverAssise(gid, vue.date);
  if (!a && creer) {
    const g = groupe(gid);
    a = { id: id(), groupeId: gid, date: vue.date, encadrant: g ? g.encadrant : '',
          theme: '', commentaire: '', presences: {} };
    D.assises.push(a);
  }
  if (a && !a.presences) a.presences = {};
  return a;
}

function pointer(membreId, valeur) {
  const a = assiseCourante(true);
  if (a.presences[membreId] === valeur) delete a.presences[membreId];
  else a.presences[membreId] = valeur;
  vibrer();
  sauver();
  rendre();
}

async function validerAppel() {
  const a = assiseCourante(true);
  const restants = membresDe(a.groupeId).filter(m => !a.presences[m.id]);
  if (restants.length === membresDe(a.groupeId).length)
    return toast("Personne n'est encore pointé", true);
  if (restants.length) {
    const noms = restants.slice(0, 5).map(nomComplet).join(', ') + (restants.length > 5 ? '…' : '');
    const r = await demander(
      `${pluriel(restants.length, 'jeune')} pas encore pointé${restants.length > 1 ? 's' : ''}`, noms, [
        { label: restants.length > 1 ? 'Les marquer absents et valider' : 'Le marquer absent et valider', val: 'absents' },
        { label: 'Valider quand même', val: 'tel', cls: '' }
      ], "Continuer l'appel");
    if (!r) return;
    if (r === 'absents') restants.forEach(m => { a.presences[m.id] = 'absent'; });
  }
  a.terminee = true;
  a.valideeLe = new Date().toISOString();
  sauver();
  rendre();
  recapAppel(a);
}

function recapAppel(a) {
  const c = compte(a);
  const absents = membresDe(a.groupeId, true).filter(m => a.presences[m.id] === 'absent');
  modale('Appel validé', `
    <p class="muted" style="margin-top:0">${echap(dateCourte(a.date))}${a.theme ? ' · ' + echap(a.theme) : ''}${
      partage.actif ? ' — visible par tous les encadrants.' : '.'}</p>
    <div class="tuiles x4">
      <div class="tuile"><div class="n" style="color:var(--present)">${c.present}</div><div class="l">Présents</div></div>
      <div class="tuile"><div class="n" style="color:var(--retard)">${c.retard}</div><div class="l">Retards</div></div>
      <div class="tuile"><div class="n" style="color:var(--excuse)">${c.excuse}</div><div class="l">Excusés</div></div>
      <div class="tuile"><div class="n" style="color:var(--absent)">${c.absent}</div><div class="l">Absents</div></div>
    </div>
    ${absents.length ? `<div class="section" style="margin-top:20px"><h2>Absents — prendre des nouvelles ?</h2></div>
      <div class="card" style="padding:12px 14px">${absents.map(m => {
        const num = m.contact || m.telephone;
        return `<div class="contact">
          <span class="avatar">${echap(initiales(m))}</span>
          <span class="grow"><span class="ligne-nom" style="display:block">${echap(nomComplet(m))}</span>
            <span class="ligne-meta">${num ? (m.contact ? 'Parent · ' : '') + echap(num) : 'Pas de numéro enregistré'}</span></span>
          ${num ? `<a class="icon-btn" href="sms:${echap(num)}" aria-label="SMS">${ico('sms')}</a>
                   <a class="icon-btn" href="tel:${echap(num)}" aria-label="Appeler">${ico('tel')}</a>` : ''}
        </div>`;
      }).join('')}</div>`
    : `<p style="margin:18px 0 0">Tout le monde était là. Machallah !</p>`}
    <div class="actions">
      <button class="btn btn-soft" data-photo-pour="${a.groupeId}">${ico('photo')}Photo</button>
      <button class="btn btn-primary grow" data-terminer>${ico('check')}Terminer</button>
    </div>`);
}

// ---------------------------------------------------------------- planning --
/* Une assise programmée est une assise comme une autre, simplement sans
   pointage : le jour venu on l'ouvre et on fait l'appel dedans. Pas de second
   objet « séance » à garder synchronisé avec le premier. */
function aVenir() {
  const h = aujourdhui();
  return assisesDe().filter(a => a.date >= h).sort((a, b) => a.date.localeCompare(b.date));
}

function passees() {
  const h = aujourdhui();
  return assisesDe().filter(a => a.date <= h && (a.date < h || compte(a).vide < membresDe(a.groupeId).length || a.terminee));
}

function ecart(iso) {
  const j = Math.round((new Date(iso + 'T12:00:00') - new Date(aujourdhui() + 'T12:00:00')) / 864e5);
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'demain';
  if (j === -1) return 'hier';
  return j > 0 ? `dans ${j} jours` : `il y a ${-j} jours`;
}

function vuePlanning() {
  const futur = aVenir();
  const h0 = aujourdhui();
  const passe = assisesDe().filter(a => a.date < h0).slice(0, 10);

  let h = `<div class="entete"><div class="grow">
      <h1>Planning</h1>
      <p class="sub">Le jour venu, on ouvre l'assise et on fait l'appel dedans.</p>
    </div></div>
  <button class="btn btn-primary btn-wide btn-lg" data-programmer="${gidParDefaut()}">${ico('plus')}Programmer une assise</button>

  <div class="section"><h2>À venir</h2>${futur.length ? `<span class="chip chip-accent">${futur.length}</span>` : ''}</div>`;

  h += futur.length
    ? `<div class="liste">${futur.map(ligneAssise).join('')}</div>`
    : `<div class="empty">${ico('cal').replace('class="ico"', 'class="ico empty-ico"')}Rien de programmé.<br>
       Le plus simple : poser la première date et choisir « chaque semaine ».</div>`;

  if (passe.length) {
    h += `<div class="section"><h2>Déjà passées</h2></div>
          <div class="liste">${passe.map(ligneAssise).join('')}</div>`;
  }
  return h;
}

function choixGroupe(nomChamp, gid) {
  if (profil !== 'tous') return `<input type="hidden" name="${nomChamp}" value="${echap(gid || profil)}">`;
  return `<label class="field"><span>Groupe</span><select name="${nomChamp}" required>
    ${gid ? '' : '<option value="">— choisir —</option>'}
    ${groupesVisibles().map(g => `<option value="${g.id}"${gid === g.id ? ' selected' : ''}>${echap(g.nom)}</option>`).join('')}
  </select></label>`;
}

function formSeance(a, gid) {
  const e = a || { date: aujourdhui(), heure: '', lieu: '' };
  modale(a ? "Modifier l'assise" : 'Programmer une assise', `
    <form id="f-seance">
      ${a ? '' : choixGroupe('groupeId', gid)}
      <div class="field-2">
        <label class="field"><span>Date</span><input type="date" name="date" required value="${echap(e.date)}"></label>
        <label class="field"><span>Heure</span><input type="text" name="heure" placeholder="18h30" value="${echap(e.heure || '')}"></label>
      </div>
      <label class="field"><span>Lieu</span><input type="text" name="lieu" placeholder="Salle du bas…" value="${echap(e.lieu || '')}"></label>
      <label class="field"><span>Thème de l'assise</span><input type="text" name="theme" value="${echap(e.theme || '')}"></label>
      <label class="field"><span>Dars prévu</span>
        <select name="darsId"><option value="">— aucun pour l'instant —</option>
        ${tousLesDars().map(d => `<option value="${d.id}"${e.darsId === d.id ? ' selected' : ''}>${echap(d.titre)}</option>`).join('')}
        </select></label>
      ${a ? '' : `<label class="field"><span>Répéter</span>
        <select name="repeter">
          <option value="1">Cette date seulement</option>
          <option value="4">Chaque semaine, 4 semaines</option>
          <option value="8">Chaque semaine, 8 semaines</option>
          <option value="12">Chaque semaine, un trimestre</option>
        </select></label>`}
      <label class="field"><span>Notes de préparation</span><textarea name="notes" style="min-height:70px">${echap(e.notes || '')}</textarea></label>
      <div class="actions">
        ${a ? `<button type="button" class="icon-btn btn-danger" data-del-assise="${a.id}" aria-label="Supprimer">${ico('poubelle')}</button>`
            : `<button type="button" class="btn" data-fermer>Annuler</button>`}
        <button type="submit" class="btn btn-primary grow">${ico('check')}${a ? 'Enregistrer' : 'Programmer'}</button>
      </div>
    </form>`);

  $('#f-seance').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    if (a) {
      Object.assign(a, { date: f.date, heure: f.heure, lieu: f.lieu,
                         theme: f.theme, darsId: f.darsId, notes: f.notes });
      sauver(); fermerModale(); rendre(); return toast('Assise modifiée');
    }

    const cible = f.groupeId || gid;
    const g = groupe(cible);
    // on saute les dates déjà occupées par une assise du même groupe
    let posees = 0;
    const d0 = new Date(f.date + 'T12:00:00');
    for (let i = 0; i < (+f.repeter || 1); i++) {
      const d = new Date(d0.getTime() + i * 7 * 864e5);
      const jour = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      if (trouverAssise(cible, jour)) continue;
      D.assises.push({ id: id(), groupeId: cible, date: jour, heure: f.heure, lieu: f.lieu,
                       theme: f.theme, darsId: f.darsId, notes: f.notes,
                       encadrant: g ? g.encadrant : '', commentaire: '', presences: {} });
      posees++;
    }
    sauver(); fermerModale(); aller('planning');
    toast(posees ? `${pluriel(posees, 'assise')} programmée${posees > 1 ? 's' : ''}`
                 : 'Ces dates étaient déjà prises', !posees);
  });
}

// ------------------------------------------------------------------ groupes --
function vueGroupes() {
  let h = `<h1>Groupes</h1><p class="sub">Un encadrant par groupe, les jeunes rattachés à l'un ou à l'autre.</p><div class="liste">`;
  for (const g of groupesVisibles()) {
    const ms = membresDe(g.id);
    h += `<button class="item" data-groupe="${g.id}">
      <span class="avatar">${echap((g.nom[0] || 'G').toUpperCase())}</span>
      <span class="grow">
        <span class="ligne-nom" style="display:block">${echap(g.nom)}</span>
        <span class="ligne-meta">${pluriel(ms.length, 'jeune')}${
          g.encadrant ? ' · encadré par ' + echap(g.encadrant) : ''}</span>
      </span>${fleche()}
    </button>`;
  }
  h += `</div>
  <button class="btn btn-wide" id="add-groupe" style="margin-top:14px">${ico('plus')}Nouveau groupe</button>`;
  return h;
}

function vueGroupe(gid) {
  const g = groupe(gid);
  if (!g) { vue.gid = null; return vueGroupes(); }
  const ms = membresDe(gid, true);
  const actifs = ms.filter(m => m.actif !== false).length;
  const as = assisesDe(gid).filter(a => a.date <= aujourdhui());

  let h = `<div class="entete"><div class="grow">
      <h1>${echap(g.nom)}</h1>
      <p class="sub">${g.encadrant ? echap(g.encadrant) + ' · ' : ''}${pluriel(actifs, 'jeune')} · ${pluriel(as.length, 'assise')}</p>
    </div>
    <button class="icon-btn" data-edit-groupe="${gid}" aria-label="Modifier le groupe">${ico('crayon')}</button>
  </div>
  <div class="btn-row">
    <button class="btn btn-primary grow" data-ajout-rapide="${gid}">${ico('ajout')}Ajouter des jeunes</button>
    <button class="btn" data-export-csv="${gid}">Export CSV</button>
  </div>

  <div class="section"><h2>Les jeunes</h2>${ms.length > 8 ? '' : ''}</div>`;

  if (!ms.length) h += `<div class="empty">${ico('users').replace('class="ico"', 'class="ico empty-ico"')}Personne pour l'instant.<br>
    Le plus rapide : <b>Ajouter des jeunes</b>, et coller la liste des prénoms.</div>`;
  else {
    if (ms.length > 8) h += `<div class="recherche" style="margin-top:0">${ico('loupe')}
      <input type="search" id="q-jeunes" placeholder="Chercher un jeune…" autocomplete="off"></div>`;
    h += `<div class="liste" id="liste-jeunes">`;
    for (const m of ms) {
      const t = taux(m.id, gid);
      const alerte = decroche(m.id, gid);
      h += `<button class="item" data-membre="${m.id}" data-gid="${gid}" data-nom="${echap(nomComplet(m).toLowerCase())}"${
        m.actif === false ? ' style="opacity:.6"' : ''}>
        <span class="avatar">${echap(initiales(m))}</span>
        <span class="grow">
          <span class="ligne-nom">${echap(nomComplet(m))}</span>
          ${m.actif === false ? ' <span class="chip">ne vient plus</span>' : ''}${alerte ? ' <span class="chip chip-alert">à rappeler</span>' : ''}
          <span class="ligne-meta" style="display:block">${m.niveau ? echap(m.niveau) + ' · ' : ''}${
            t.pct === null ? 'aucun appel' : `${t.pct} % · ${t.ok}/${t.base} assises`}</span>
          ${t.pct === null ? '' : `<span class="jauge ${classeJauge(t.pct)}"><i style="width:${t.pct}%"></i></span>`}
        </span>${fleche()}
      </button>`;
    }
    h += `</div>
    <button class="btn btn-ghost btn-wide" data-add-membre="${gid}" style="margin-top:6px">${ico('plus')}Inscrire un jeune avec tous ses détails</button>`;
  }

  h += `<div class="section"><h2>Assises</h2></div>`;
  h += as.length ? `<div class="liste">${as.slice(0, 15).map(ligneAssise).join('')}</div>`
                 : `<div class="empty">Aucune assise passée.</div>`;
  return h;
}

// -------------------------------------------------------------- fiche jeune --
function vueMembre(mid) {
  const m = D.membres.find(x => x.id === mid);
  if (!m) { vue.membreId = null; return vueGroupes(); }
  const g = groupe(m.groupeId);
  const t = taux(m.id, m.groupeId);
  const hist = assisesDe(m.groupeId).filter(a => a.presences && a.presences[m.id]);

  const ligneContact = (libelle, num) => num ? `<div class="contact">
      <span class="grow"><span class="faint" style="display:block">${libelle}</span><b>${echap(num)}</b></span>
      <a class="btn btn-soft" href="sms:${echap(num)}">${ico('sms')}SMS</a>
      <a class="btn btn-primary" href="tel:${echap(num)}">${ico('tel')}Appeler</a>
    </div>` : '';

  let h = `<div class="card-row" style="margin:0 0 16px">
    <span class="avatar" style="width:58px;height:58px;font-size:1.15rem">${echap(initiales(m))}</span>
    <div class="grow">
      <h1 style="margin:0">${echap(nomComplet(m))}</h1>
      <p class="muted" style="margin:2px 0 0">${[m.niveau, g && g.nom].filter(Boolean).map(echap).join(' · ')}${
        m.actif === false ? ' · <span class="chip">ne vient plus</span>' : ''}</p>
    </div>
    <button class="icon-btn" data-edit-membre="${m.id}" aria-label="Modifier">${ico('crayon')}</button>
  </div>

  <div class="tuiles x4">
    <div class="tuile"><div class="n">${t.pct === null ? '—' : t.pct + ' %'}</div><div class="l">Présence</div>
      ${t.pct === null ? '' : `<div class="jauge ${classeJauge(t.pct)}"><i style="width:${t.pct}%"></i></div>`}</div>
    <div class="tuile"><div class="n">${t.ok}</div><div class="l">Assises</div></div>
    <div class="tuile"><div class="n">${t.ko}</div><div class="l">Absences</div></div>
    <div class="tuile"><div class="n">${t.exc}</div><div class="l">Excusés</div></div>
  </div>

  ${m.telephone || m.contact ? `<div class="card" style="margin-top:14px">
    ${ligneContact('Téléphone du jeune', m.telephone)}
    ${ligneContact("Contact d'un parent", m.contact)}
  </div>` : `<button class="btn btn-wide btn-ghost" data-edit-membre="${m.id}" style="margin-top:10px">${ico('plus')}Ajouter un numéro de téléphone</button>`}

  <div class="section"><h2>Notes de suivi</h2>
    <button class="btn btn-sm btn-soft" data-note-membre="${m.id}">${ico('plus')}Note</button></div>`;

  // l'indice renvoie à la liste d'origine, pas à la liste triée affichée
  const notes = (m.notes || []).map((n, i) => ({ n, i })).sort((a, b) => (b.n.date || '').localeCompare(a.n.date || ''));
  h += notes.length ? `<div class="liste">${notes.map(({ n, i }) => `
      <div class="card" style="margin:0;padding:12px 8px 12px 14px">
        <div class="card-row"><span class="faint grow">${echap(dateCourte(n.date))}</span>
          <button class="icon-btn" data-del-note="${m.id}:${i}" aria-label="Supprimer la note" style="width:36px;height:36px">${ico('poubelle')}</button></div>
        <div style="white-space:pre-wrap;padding-right:6px">${echap(n.texte)}</div>
      </div>`).join('')}</div>`
    : `<div class="empty">Rien de noté. Un progrès, un besoin, un mot d'un parent : c'est ici.</div>`;

  h += `<div class="section"><h2>Historique de présence</h2></div>`;
  h += hist.length ? `<div class="liste">${hist.map(a => {
      const s = a.presences[m.id];
      return `<button class="item" data-assise="${a.id}">
        ${avatarDate(a.date)}
        <span class="grow"><span class="ligne-nom truncate" style="display:block">${echap(a.theme || 'Assise')}</span>
          <span class="ligne-meta">${echap(dateCourte(a.date))}</span></span>
        <span class="chip c-${s}">${ETAT[s] || '—'}</span></button>`;
    }).join('')}</div>` : `<div class="empty">Aucun appel enregistré.</div>`;

  return h;
}

// --------------------------------------------------------------------- dars --
function tousLesDars() {
  return D.dars.concat(darsPartages.filter(p => !D.dars.some(d => d.id === p.id)))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function vueListeDars() {
  const liste = tousLesDars();
  let h = `<div class="entete"><div class="grow">
      <h1>Dars</h1>
      <p class="sub">Les supports d'assise, communs aux deux groupes.</p>
    </div></div>
  <button class="btn btn-primary btn-wide btn-lg" id="add-dars">${ico('plus')}Nouveau dars</button>
  ${liste.length > 3 ? `<div class="recherche">${ico('loupe')}
    <input type="search" id="q-dars" placeholder="Titre, thème, texte…" value="${echap(vue.q || '')}" autocomplete="off"></div>` : ''}`;

  const q = (vue.q || '').toLowerCase().trim();
  const filtres = liste.filter(d => !q ||
    [d.titre, d.theme, d.objectif, d.plan, d.textes, d.references].join(' ').toLowerCase().includes(q));

  if (!filtres.length) {
    h += `<div class="empty" style="margin-top:14px">${liste.length ? 'Aucun dars ne correspond.' : 'Aucun dars enregistré pour le moment.'}</div>`;
    return h;
  }

  h += `<div class="liste" style="margin-top:14px">`;
  for (const d of filtres) {
    h += `<button class="item" data-dars="${d.id}">
      <span class="avatar" style="border-radius:12px">${ico('livre')}</span>
      <span class="grow">
        <span class="ligne-nom truncate" style="display:block">${echap(d.titre)}</span>
        <span class="ligne-meta truncate" style="display:block">${[d.theme, d.cible, d.duree ? d.duree + ' min' : ''].filter(Boolean).map(echap).join(' · ') || '—'}</span>
      </span>
      ${d.partage ? '<span class="chip chip-accent">modèle</span>' : ''}${fleche()}
    </button>`;
  }
  return h + `</div>${!partage.actif && D.dars.length ? `
    <button class="btn btn-ghost btn-wide" id="export-dars" style="margin-top:10px">Exporter pour partage</button>` : ''}`;
}

function vueDars(did) {
  const d = tousLesDars().find(x => x.id === did);
  if (!d) { vue.darsId = null; return vueListeDars(); }
  const bloc = (titre, txt, cls) => txt
    ? `<div class="dars-bloc"><h3>${titre}</h3><div class="${cls || 'dars-corps'}">${echap(txt)}</div></div>` : '';

  return `<h1>${echap(d.titre)}</h1>
  <p class="sub">${[d.date ? dateFr(d.date, true) : '', d.cible, d.duree ? d.duree + ' min' : '', d.auteur]
    .filter(Boolean).map(echap).join(' · ')}</p>
  <div class="btn-row">
    ${d.partage ? '' : `<button class="btn btn-sm" data-edit-dars="${d.id}">${ico('crayon')}Modifier</button>`}
    <button class="btn btn-sm" id="imprimer">${ico('imprimer')}Imprimer</button>
    ${d.partage ? '' : `<button class="btn btn-sm btn-danger" data-del-dars="${d.id}">${ico('poubelle')}Supprimer</button>`}
  </div>
  <div class="card" style="margin-top:14px">
    ${bloc('Thème', d.theme)}
    ${bloc('Objectif', d.objectif)}
    ${bloc('Plan', d.plan)}
    ${d.arabe ? `<div class="dars-bloc"><h3>Texte</h3><div class="ar">${echap(d.arabe)}</div></div>` : ''}
    ${bloc('Coran &amp; hadith', d.textes, 'cite')}
    ${bloc('Références', d.references)}
    ${d.support ? `<div class="dars-bloc"><h3>Support</h3><a href="${echap(d.support)}" target="_blank" rel="noopener">${echap(d.support)}</a></div>` : ''}
  </div>`;
}

// --------------------------------------------------------------- souvenirs --
function vueSouvenirs() {
  const gs = groupesVisibles();
  const photos = photosDe(null, null);

  let h = `<h1>Souvenirs</h1>
  <p class="sub">Les photos restent sur ce téléphone : elles ne partent ni sur internet, ni chez les autres encadrants.</p>
  <div class="btn-row">
    ${gs.map(g => `<button class="btn btn-primary grow" data-photo-pour="${g.id}">${ico('photo')}${
      profil === 'tous' ? echap(g.nom) : 'Ajouter des photos'}</button>`).join('')}
  </div>`;

  if (!photos.length) {
    return h + `<div class="empty" style="margin-top:16px">${ico('photo').replace('class="ico"', 'class="ico empty-ico"')}Aucune photo pour l'instant.<br>
      Une photo de groupe à la fin de l'assise, et on a la trace de l'année.</div>`;
  }

  // regroupées par journée, la plus récente en premier
  const jours = [];
  for (const p of photos) {
    const cle = p.date + '|' + p.groupeId;
    let j = jours.find(x => x.cle === cle);
    if (!j) jours.push(j = { cle, date: p.date, gid: p.groupeId, liste: [] });
    j.liste.push(p);
  }

  for (const j of jours) {
    const g = groupe(j.gid);
    h += `<div class="section"><h2>${echap(dateCourte(j.date))}${
      g && profil === 'tous' ? ' · ' + echap(g.nom) : ''}</h2>
      <span class="faint">${pluriel(j.liste.length, 'photo')}</span></div>
      <div class="album">${j.liste.map(p => `
        <button class="vign" data-photo="${p.id}">
          <img src="${p.vignette}" alt="${echap(p.legende || 'Photo de l\'assise')}" loading="lazy">
          ${p.legende ? `<span class="lg truncate">${echap(p.legende)}</span>` : ''}
        </button>`).join('')}</div>`;
  }
  return h;
}

async function vuePhoto(pid) {
  const p = album.find(x => x.id === pid);
  if (!p) return;
  const g = groupe(p.groupeId);
  modale('Photo', `<div class="photo-plein"><img id="photo-grande" src="${p.vignette}"
      alt="${echap(p.legende || 'Photo de l\'assise')}"></div>
    <p class="muted" style="margin:10px 0 0">${echap(dateCourte(p.date))}${
      g ? ' · ' + echap(g.nom) : ''} · ${Math.round(p.poids / 1024)} Ko</p>
    <label class="field" style="margin-top:14px"><span>Légende</span>
      <input type="text" id="photo-legende" value="${echap(p.legende || '')}" placeholder="Ce qu'on veut se rappeler" enterkeyhint="done"></label>
    <div class="actions">
      <button class="icon-btn btn-danger" data-photo-supprimer="${p.id}" aria-label="Supprimer">${ico('poubelle')}</button>
      <button class="btn" data-photo-telecharger="${p.id}">Télécharger</button>
      <button class="btn btn-primary grow" data-photo-enregistrer="${p.id}">${ico('check')}Enregistrer</button>
    </div>`);

  // la vignette s'affiche tout de suite, l'original la remplace dès qu'il est lu
  const blob = await idbLire('originaux', pid);
  const img = $('#photo-grande');
  if (blob && img) {
    const url = URL.createObjectURL(blob);
    img.onload = () => setTimeout(() => URL.revokeObjectURL(url), 2000);
    img.src = url;
  }
}

async function supprimerPhoto(pid) {
  if (!await confirmer('Supprimer cette photo ?', 'Elle sera effacée de ce téléphone.', 'Supprimer', true)) return;
  await idbEffacer('originaux', pid);
  await idbEffacer('vignettes', pid);
  album = album.filter(p => p.id !== pid);
  fermerModale(); rendre(); toast('Photo supprimée');
}

async function telechargerPhoto(pid) {
  const p = album.find(x => x.id === pid);
  const blob = await idbLire('originaux', pid);
  if (!blob) return toast('Photo introuvable', true);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `assise-${p.date}-${pid.slice(0, 4)}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------- formulaires --
function boutonsForm(texte, supprimer) {
  return `<div class="actions">
    ${supprimer || '<button type="button" class="btn" data-fermer>Annuler</button>'}
    <button type="submit" class="btn btn-primary grow">${ico('check')}${texte}</button>
  </div>`;
}

function formMembre(m, gid) {
  const e = m || { actif: true, dateArrivee: aujourdhui() };
  modale(m ? 'Modifier le jeune' : 'Inscrire un jeune', `
    <form id="f-membre">
      <div class="field-2">
        <label class="field"><span>Prénom</span><input type="text" name="prenom" required autocapitalize="words" value="${echap(e.prenom || '')}"></label>
        <label class="field"><span>Nom</span><input type="text" name="nom" autocapitalize="words" value="${echap(e.nom || '')}"></label>
      </div>
      <label class="field"><span>Classe / niveau</span><input type="text" name="niveau" placeholder="4ème, 2nde…" value="${echap(e.niveau || '')}"></label>
      ${choixGroupe('groupeId', e.groupeId || gid)}
      <label class="field"><span>Téléphone du jeune</span><input type="tel" name="telephone" inputmode="tel" autocomplete="off" value="${echap(e.telephone || '')}"></label>
      <label class="field"><span>Contact d'un parent</span><input type="tel" name="contact" inputmode="tel" autocomplete="off" value="${echap(e.contact || '')}"></label>
      <div class="field-2">
        <label class="field"><span>Arrivé le</span><input type="date" name="dateArrivee" value="${echap(e.dateArrivee || '')}"></label>
        <label class="field"><span>Vient encore ?</span>
          <select name="actif"><option value="1"${e.actif !== false ? ' selected' : ''}>Oui</option>
          <option value="0"${e.actif === false ? ' selected' : ''}>Non, plus</option></select></label>
      </div>
      ${boutonsForm(m ? 'Enregistrer' : 'Inscrire',
        m ? `<button type="button" class="icon-btn btn-danger" data-del-membre="${m.id}" aria-label="Supprimer">${ico('poubelle')}</button>` : '')}
    </form>`);

  $('#f-membre').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    f.actif = f.actif === '1';
    f.prenom = f.prenom.trim(); f.nom = (f.nom || '').trim();
    if (m) Object.assign(m, f);
    else D.membres.push(Object.assign({ id: id(), notes: [] }, f));
    sauver(); fermerModale(); rendre(); toast(m ? 'Modifications enregistrées' : `${f.prenom} est inscrit`);
  });
}

/* Inscrire toute une liste d'un coup : au début d'année on a les prénoms sur
   un papier, pas envie de remplir dix formulaires. Une ligne = un jeune,
   « Prénom Nom » et, après une virgule, la classe si on l'a. */
function formAjoutRapide(gid) {
  const g = groupe(gid);
  modale('Ajouter des jeunes', `
    <form id="f-rapide">
      ${g ? `<p class="muted" style="margin-top:0">Dans <b>${echap(g.nom)}</b>.</p>` : ''}
      ${profil === 'tous' && !g ? choixGroupe('groupeId', '') : `<input type="hidden" name="groupeId" value="${echap(gid)}">`}
      <label class="field"><span>Un jeune par ligne — prénom, nom, puis la classe après une virgule</span>
        <textarea name="liste" id="liste-rapide" style="min-height:160px" autocapitalize="words" placeholder="Yassin B., 4ème
Ilyas K., 3ème
Anas
Bilal S."></textarea></label>
      <p class="faint" id="apercu-rapide" style="margin:-6px 0 0">Aucun nom pour l'instant.</p>
      <button type="button" class="btn btn-ghost btn-sm" data-add-membre="${echap(gid)}" style="padding-left:0;margin-top:6px">
        Un seul jeune, avec téléphone et détails ›</button>
      ${boutonsForm('Inscrire')}
    </form>`);

  $('#f-rapide').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const cible = fd.get('groupeId') || gid;
    const lignes = lireListe(fd.get('liste'));
    if (!lignes.length) return toast('Écris au moins un prénom', true);
    for (const l of lignes) {
      D.membres.push({
        id: id(), groupeId: cible, prenom: l.prenom, nom: l.nom, niveau: l.niveau,
        telephone: '', contact: '', dateArrivee: aujourdhui(), actif: true, notes: []
      });
    }
    sauver(); fermerModale();
    vue.membreId = null; rendre();   // on reste sur l'écran d'où on vient
    toast(`${pluriel(lignes.length, 'jeune')} inscrit${lignes.length > 1 ? 's' : ''}`);
  });
}

function lireListe(texte) {
  return String(texte || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const [ident, niveau] = l.split(/[,;]/);
    const mots = ident.trim().split(/\s+/);
    return { prenom: mots.shift() || '', nom: mots.join(' '), niveau: (niveau || '').trim() };
  }).filter(l => l.prenom);
}

function formGroupe(g) {
  const e = g || {};
  modale(g ? 'Modifier le groupe' : 'Nouveau groupe', `
    <form id="f-groupe">
      <label class="field"><span>Nom du groupe</span><input type="text" name="nom" required value="${echap(e.nom || '')}"></label>
      <label class="field"><span>Encadrant</span><input type="text" name="encadrant" autocapitalize="words" value="${echap(e.encadrant || '')}"></label>
      ${boutonsForm('Enregistrer', g ? `<button type="button" class="icon-btn btn-danger" data-del-groupe="${g.id}" aria-label="Supprimer">${ico('poubelle')}</button>` : '')}
    </form>`);

  $('#f-groupe').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    if (g) Object.assign(g, f);
    else D.groupes.push(Object.assign({ id: id(), ordre: D.groupes.length + 1 }, f));
    sauver(); fermerModale(); rendre(); toast('Groupe enregistré');
  });
}

function formDars(d) {
  const e = d || { date: aujourdhui() };
  modale(d ? 'Modifier le dars' : 'Nouveau dars', `
    <form id="f-dars">
      <label class="field"><span>Titre</span><input type="text" name="titre" required value="${echap(e.titre || '')}"></label>
      <label class="field"><span>Thème</span><input type="text" name="theme" value="${echap(e.theme || '')}"></label>
      <div class="field-2">
        <label class="field"><span>Date</span><input type="date" name="date" value="${echap(e.date || '')}"></label>
        <label class="field"><span>Durée (min)</span><input type="number" name="duree" inputmode="numeric" min="0" step="5" value="${echap(e.duree || '')}"></label>
      </div>
      <div class="field-2">
        <label class="field"><span>Pour</span><select name="cible">
          <option value="">Les deux</option>
          ${D.groupes.map(g => `<option${e.cible === g.nom ? ' selected' : ''}>${echap(g.nom)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Encadrant</span><input type="text" name="auteur" value="${echap(e.auteur || '')}"></label>
      </div>
      <label class="field"><span>Objectif — ce qu'ils doivent retenir</span><textarea name="objectif" style="min-height:70px">${echap(e.objectif || '')}</textarea></label>
      <label class="field"><span>Plan / déroulé</span><textarea name="plan">${echap(e.plan || '')}</textarea></label>
      <label class="field"><span>Texte en arabe</span><textarea name="arabe" dir="rtl" style="min-height:70px">${echap(e.arabe || '')}</textarea></label>
      <label class="field"><span>Coran &amp; hadith (traduction, références)</span><textarea name="textes" style="min-height:70px">${echap(e.textes || '')}</textarea></label>
      <label class="field"><span>Références / lectures</span><textarea name="references" style="min-height:60px">${echap(e.references || '')}</textarea></label>
      <label class="field"><span>Lien vers un support (PDF, diapos…)</span><input type="text" name="support" inputmode="url" value="${echap(e.support || '')}"></label>
      ${boutonsForm('Enregistrer le dars')}
    </form>`);

  $('#f-dars').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    if (d) Object.assign(d, f);
    else { const n = Object.assign({ id: id() }, f); D.dars.push(n); vue.darsId = n.id; vue.nom = 'dars'; }
    sauver(); fermerModale(); majOnglets(); rendre(); pousser(); toast('Dars enregistré');
  });
}

function formNote(m) {
  modale('Note de suivi', `
    <form id="f-note">
      <p class="muted" style="margin-top:0">Pour <b>${echap(nomComplet(m))}</b>.</p>
      <label class="field"><span>Note</span><textarea name="texte" required placeholder="Un progrès, une difficulté, un échange avec les parents…"></textarea></label>
      <label class="field"><span>Date</span><input type="date" name="date" value="${aujourdhui()}"></label>
      ${boutonsForm('Ajouter la note')}
    </form>`);
  $('#f-note').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    (m.notes = m.notes || []).push(f);
    sauver(); fermerModale(); rendre(); toast('Note ajoutée');
  });
}

function vueAssise(aid) {
  const a = D.assises.find(x => x.id === aid);
  if (!a) return;
  const g = groupe(a.groupeId);
  const c = compte(a);
  const pointee = c.present + c.retard + c.excuse + c.absent > 0;
  const d = a.darsId ? tousLesDars().find(x => x.id === a.darsId) : null;
  const photos = photosDe(a.groupeId, a.date);

  modale(dateCourte(a.date), `
    <p class="muted" style="margin-top:0">${[
      g && profil === 'tous' ? g.nom : '', a.heure, a.lieu, a.theme
    ].filter(Boolean).map(echap).join(' · ') || 'Assise'}</p>

    ${pointee ? `<div class="compte" style="margin-bottom:14px">
      ${a.terminee ? `<span class="chip chip-accent">${ico('check').replace('class="ico"', 'class="ico" style="width:13px;height:13px"')}validé</span>` : ''}
      <span class="chip c-present">${c.present} présents</span>
      ${c.retard ? `<span class="chip c-retard">${c.retard} retards</span>` : ''}
      ${c.excuse ? `<span class="chip c-excuse">${c.excuse} excusés</span>` : ''}
      <span class="chip c-absent">${c.absent} absents</span>
    </div>` : `<p><span class="chip chip-accent">${echap(ecart(a.date))} · pas encore d'appel</span></p>`}

    ${d ? `<button class="item" data-dars="${d.id}" style="margin-bottom:12px">
      <span class="avatar" style="border-radius:12px">${ico('livre')}</span>
      <span class="grow"><span class="faint" style="display:block">Dars prévu</span><span class="ligne-nom">${echap(d.titre)}</span></span>${fleche()}</button>` : ''}
    ${a.notes ? `<div class="card"><span class="faint">Préparation</span>
      <div style="white-space:pre-wrap">${echap(a.notes)}</div></div>` : ''}
    ${a.commentaire ? `<div class="card"><span class="faint">Remarques</span>
      <div style="white-space:pre-wrap">${echap(a.commentaire)}</div></div>` : ''}

    ${photos.length ? `<div class="album" style="margin-bottom:12px">${photos.map(p =>
      `<button class="vign" data-photo="${p.id}"><img src="${p.vignette}" alt="Photo de l'assise" loading="lazy"></button>`
      ).join('')}</div>` : ''}

    ${pointee ? `<div class="liste">${membresDe(a.groupeId, true).map(m => {
      const s = a.presences[m.id];
      return s ? `<div class="item" style="cursor:default;min-height:50px;padding:8px 12px">
        <span class="grow">${echap(nomComplet(m))}</span>
        <span class="chip c-${s}">${ETAT[s]}</span></div>` : '';
    }).join('')}</div>` : ''}

    <div class="actions">
      <button class="icon-btn btn-danger" data-del-assise="${a.id}" aria-label="Supprimer">${ico('poubelle')}</button>
      <button class="btn" data-edit-seance="${a.id}">${ico('crayon')}Modifier</button>
      <button class="btn btn-primary grow" data-ouvrir-appel="${a.id}">${ico('appel')}${
        pointee ? "Reprendre l'appel" : "Faire l'appel"}</button>
    </div>`);
}

// ----------------------------------------------------------------- réglages --
function vueReglages() {
  const th = document.documentElement.dataset.theme || '';
  const photosMo = (album.reduce((n, p) => n + (p.poids || 0), 0) / 1048576).toFixed(1);
  modale('Réglages', `
    <div class="card">
      <h3>Groupe suivi sur ce téléphone</h3>
      <p class="muted">Ce téléphone affiche <b>${echap(nomProfil())}</b>.</p>
      <button class="btn btn-sm" id="r-profil">Changer de groupe</button>
    </div>
    <div class="card">
      <h3>Partage entre encadrants</h3>
      ${partage.actif
        ? `<p class="muted">Les groupes, les jeunes, les appels et les dars sont <b>partagés</b> :
            chaque encadrant voit la même chose, à jour. État : <b>${echap(ETATS[partage.etat] || partage.etat)}</b>.</p>
           <div class="btn-row">
             <button class="btn btn-sm btn-soft" id="r-synchro">Synchroniser maintenant</button>
             <button class="btn btn-sm btn-danger" id="r-deconnecter">Déconnecter ce téléphone</button>
           </div>`
        : `<p class="muted">Pas encore activé : pour l'instant, les données restent <b>sur ce téléphone</b>.
            Pour que tout le monde voie les mêmes groupes, il faut renseigner la base partagée dans
            <code>config.js</code> (voir le README).</p>`}
    </div>
    <div class="card">
      <h3>Sauvegarde</h3>
      <p class="muted">Un fichier de sauvegarde à garder de côté${partage.actif ? '' : ', ou à transmettre à un autre encadrant'}.</p>
      <div class="btn-row">
        <button class="btn btn-sm" id="r-export">Exporter (JSON)</button>
        <button class="btn btn-sm" id="r-import">Importer</button>
        <button class="btn btn-sm" id="r-csv">Présences (CSV)</button>
      </div>
      <input type="file" id="r-file" accept="application/json,.json" hidden>
    </div>
    <div class="card">
      <h3>Photos</h3>
      <p class="muted" style="margin-bottom:0">${pluriel(album.length, 'photo')} sur ce téléphone${album.length ? ` (${photosMo} Mo)` : ''}.
      Elles ne sont <b>jamais partagées</b> — des visages de mineurs n'ont pas à circuler. Chacune se télécharge depuis l'album.</p>
    </div>
    <div class="card">
      <h3>Apparence</h3>
      <div class="btn-row">
        ${[['', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) =>
          `<button class="btn btn-sm${th === v ? ' btn-soft' : ''}" data-theme="${v}">${th === v ? ico('check') : ''}${l}</button>`).join('')}
      </div>
    </div>
    ${partage.actif ? '' : `<div class="card">
      <h3>Remise à zéro</h3>
      <p class="muted">Efface tout sur ce téléphone : groupes, jeunes, assises, dars, photos.</p>
      <button class="btn btn-danger btn-sm" id="r-raz">Tout effacer</button>
    </div>`}
    <p class="faint">${pluriel(D.membres.length, 'jeune')} · ${pluriel(D.assises.length, 'assise')} · ${D.dars.length} dars.</p>`);
}

/* Fusion d'un export venu d'un autre appareil. Chaque groupe étant tenu par un
   seul encadrant, il n'y a pas de conflit à arbitrer : on ajoute ce qui manque
   et on met à jour ce qui existe. Les assises se reconnaissent au couple
   groupe + date, pas seulement à leur identifiant, pour ne pas créer de
   doublon si la même assise a été saisie des deux côtés. */
function fusionner(src) {
  for (const g of src.groupes || [])
    if (!D.groupes.some(x => x.id === g.id)) D.groupes.push(g);

  for (const m of src.membres || []) {
    const ex = D.membres.find(x => x.id === m.id);
    if (ex) Object.assign(ex, m); else D.membres.push(m);
  }

  for (const a of src.assises || []) {
    const ex = D.assises.find(x => x.id === a.id)
            || D.assises.find(x => x.groupeId === a.groupeId && x.date === a.date);
    if (ex) {
      ex.presences   = Object.assign({}, ex.presences, a.presences);
      ex.theme       = a.theme || ex.theme;
      ex.commentaire = a.commentaire || ex.commentaire;
      ex.terminee    = ex.terminee || a.terminee;
    } else D.assises.push(a);
  }

  for (const d of src.dars || [])
    if (!D.dars.some(x => x.id === d.id)) D.dars.push(d);
}

function exporterCSV(gid) {
  const gs = gid ? [groupe(gid)] : D.groupes;
  const lignes = [['Groupe', 'Date', 'Thème', 'Jeune', 'Niveau', 'Statut'].join(';')];
  for (const g of gs) {
    for (const a of assisesDe(g.id).slice().reverse()) {
      for (const m of membresDe(g.id, true)) {
        const s = (a.presences && a.presences[m.id]) || '';
        if (!s) continue;
        lignes.push([g.nom, a.date, (a.theme || '').replace(/;/g, ','), nomComplet(m), m.niveau || '', s].join(';'));
      }
    }
  }
  telecharger(`presences-${gid ? groupe(gid).nom.replace(/\W+/g, '-').toLowerCase() : 'tous'}-${aujourdhui()}.csv`,
    '﻿' + lignes.join('\r\n'), 'text/csv;charset=utf-8');
}

// ------------------------------------------------------------- événements ---
let importEnAttente = null;

document.addEventListener('click', async (ev) => {
  const c = (s) => ev.target.closest(s);
  let el;

  // dialogue de confirmation
  if ((el = c('[data-reponse]'))) return repondre(+el.dataset.reponse);
  if (ev.target.id === 'confirm-back') return repondre(null);

  // choix du groupe suivi par cet appareil
  if ((el = c('[data-profil]'))) return choisirProfil(el.dataset.profil);
  if (c('#titre-profil') && profilOk() && !besoinCode()) return changerProfil();
  if (c('#r-profil')) return changerProfil();
  if (c('#btn-retour')) return retour();
  if (c('#etat-synchro') || c('#r-synchro')) return synchroniserMaintenant();

  if (c('#i-fusion') && importEnAttente) {
    fusionner(importEnAttente); importEnAttente = null;
    sauver(); fermerModale(); aller('accueil'); return toast('Données fusionnées');
  }
  if (c('#i-remplace') && importEnAttente) {
    D = Object.assign(vide(), importEnAttente); importEnAttente = null;
    sauver(); fermerModale(); aller('accueil'); return toast('Données remplacées');
  }

  // navigation
  if ((el = c('.tab'))) return aller(el.dataset.view, { gid: profil === 'tous' ? null : profil });
  if ((el = c('[data-aller]'))) return aller(el.dataset.aller);
  if (c('[data-fermer]')) return fermerModale();
  if (c('[data-terminer]')) { fermerModale(); return aller('accueil'); }

  // pointage
  if ((el = c('.seg button'))) {
    const mid = el.closest('[data-membre-seg]').dataset.membreSeg;
    return pointer(mid, el.dataset.v);
  }
  if (c('#valider-appel')) return validerAppel();
  if (c('#voir-recap'))    { const a = assiseCourante(false); return a && recapAppel(a); }
  if (c('#appel-auj'))     { vue.date = aujourdhui(); remplacer(); return rendre(); }

  if ((el = c('[data-go-appel]')))   return aller('appel', { gid: el.dataset.goAppel, date: aujourdhui() });
  if ((el = c('[data-groupe]')))     return aller('groupes', { gid: el.dataset.groupe });
  if ((el = c('[data-membre]')))     { fermerModale(); return ouvrir({ gid: el.dataset.gid || vue.gid, membreId: el.dataset.membre }); }
  if ((el = c('[data-dars]')))       { fermerModale(); return ouvrir({ nom: 'dars', membreId: null, darsId: el.dataset.dars }); }
  if ((el = c('[data-assise]')))     return vueAssise(el.dataset.assise);

  // planning
  if ((el = c('[data-programmer]')))  return formSeance(null, el.dataset.programmer);
  if ((el = c('[data-edit-seance]'))) return formSeance(D.assises.find(x => x.id === el.dataset.editSeance));

  // photos
  if ((el = c('[data-photo-pour]'))) {
    vue.photoCible = { gid: el.dataset.photoPour, date: vue.nom === 'appel' ? vue.date : aujourdhui() };
    fermerModale();
    $('#photo-file').click();
    return;
  }
  if ((el = c('[data-photo]')))              return vuePhoto(el.dataset.photo);
  if ((el = c('[data-photo-supprimer]')))    return supprimerPhoto(el.dataset.photoSupprimer);
  if ((el = c('[data-photo-telecharger]')))  return telechargerPhoto(el.dataset.photoTelecharger);
  if ((el = c('[data-photo-enregistrer]'))) {
    const p = album.find(x => x.id === el.dataset.photoEnregistrer);
    if (!p) return;
    p.legende = $('#photo-legende').value.trim();
    idbEcrire('vignettes', p).then(() => { fermerModale(); rendre(); toast('Légende enregistrée'); });
    return;
  }

  if ((el = c('[data-ajout-rapide]'))) return formAjoutRapide(el.dataset.ajoutRapide);
  if ((el = c('[data-add-membre]')))  return formMembre(null, el.dataset.addMembre);
  if ((el = c('[data-edit-membre]'))) return formMembre(D.membres.find(m => m.id === el.dataset.editMembre));
  if ((el = c('[data-note-membre]'))) return formNote(D.membres.find(m => m.id === el.dataset.noteMembre));
  if ((el = c('[data-edit-groupe]'))) return formGroupe(groupe(el.dataset.editGroupe));
  if ((el = c('[data-edit-dars]')))   return formDars(D.dars.find(d => d.id === el.dataset.editDars));
  if (c('#add-groupe')) return formGroupe(null);
  if (c('#add-dars'))   return formDars(null);

  const pourTous = partage.actif ? ' Ce sera effacé pour tous les encadrants.' : '';
  if ((el = c('[data-del-membre]'))) {
    const mid = el.dataset.delMembre;
    if (!await confirmer('Supprimer ce jeune ?', 'Son historique de présence part avec lui. Pour un jeune qui ne vient plus, mieux vaut répondre « Non, plus » à « Vient encore ? »' + pourTous, 'Supprimer', true)) return;
    D.membres = D.membres.filter(m => m.id !== mid);
    D.assises.forEach(a => { if (a.presences && a.presences[mid]) delete a.presences[mid]; });
    vue.membreId = null; sauver(); fermerModale(); rendre(); return toast('Jeune supprimé');
  }
  if ((el = c('[data-del-groupe]'))) {
    const gid = el.dataset.delGroupe;
    if (membresDe(gid, true).length) return demander('Groupe non vide', "Déplace d'abord ses jeunes dans un autre groupe.", [], 'Compris');
    if (!await confirmer('Supprimer ce groupe ?', 'Ses assises seront supprimées aussi.' + pourTous, 'Supprimer', true)) return;
    D.groupes = D.groupes.filter(g => g.id !== gid);
    D.assises = D.assises.filter(a => a.groupeId !== gid);
    vue.gid = null; sauver(); fermerModale(); rendre(); return toast('Groupe supprimé');
  }
  if ((el = c('[data-del-dars]'))) {
    const did = el.dataset.delDars;
    if (!await confirmer('Supprimer ce dars ?', pourTous.trim(), 'Supprimer', true)) return;
    D.dars = D.dars.filter(d => d.id !== did);
    sauver(); return retour();
  }
  if ((el = c('[data-del-assise]'))) {
    const aid = el.dataset.delAssise;
    if (!await confirmer('Supprimer cette assise ?', "L'appel qui va avec sera effacé." + pourTous, 'Supprimer', true)) return;
    D.assises = D.assises.filter(a => a.id !== aid);
    sauver(); fermerModale(); rendre(); return toast('Assise supprimée');
  }
  if ((el = c('[data-del-note]'))) {
    const [mid, i] = el.dataset.delNote.split(':');
    const m = D.membres.find(x => x.id === mid);
    if (m && await confirmer('Supprimer cette note ?', '', 'Supprimer', true)) {
      m.notes.splice(+i, 1); sauver(); rendre(); toast('Note supprimée');
    }
    return;
  }

  if ((el = c('[data-ouvrir-appel]'))) {
    const a = D.assises.find(x => x.id === el.dataset.ouvrirAppel);
    fermerModale();
    return aller('appel', { gid: a.groupeId, date: a.date });
  }
  if ((el = c('[data-export-csv]'))) return exporterCSV(el.dataset.exportCsv);

  // appel : actions groupées
  if (c('#tout-present')) {
    const a = assiseCourante(true);
    for (const m of membresDe(a.groupeId)) if (!a.presences[m.id]) a.presences[m.id] = 'present';
    vibrer(); sauver(); return rendre();
  }
  if (c('#raz')) {
    const a = assiseCourante(false);
    if (a && await confirmer("Effacer le pointage ?", "Tous les jeunes repassent « à pointer » pour cette assise.", 'Effacer', true)) {
      a.presences = {}; a.terminee = false; sauver(); rendre();
    }
    return;
  }
  if (c('#imprimer')) return window.print();

  // dars
  if (c('#export-dars')) {
    if (!D.dars.length) return toast('Aucun dars à exporter', true);
    telecharger('dars-partages.json', JSON.stringify(D.dars.map(d =>
      Object.assign({}, d, { partage: true })), null, 2));
    return toast('À déposer dans data/ du dépôt');
  }

  // réglages
  if (c('#btn-reglages')) return vueReglages();
  if (c('#modal-close') || ev.target.id === 'modal-back') return fermerModale();
  if (c('#r-export')) return telecharger(`espace-jeunesse-${aujourdhui()}.json`, JSON.stringify(D, null, 2));
  if (c('#r-csv'))    return exporterCSV(null);
  if (c('#r-import')) return $('#r-file').click();
  if (c('#r-deconnecter')) {
    if (!await confirmer('Déconnecter ce téléphone ?', 'Les données restent dans la base partagée ; ce téléphone oublie sa copie et le code d\'accès. Ce qui n\'est pas encore envoyé sera perdu.', 'Déconnecter', true)) return;
    D = vide(); cacheLocal();
    partage.empreintes = {}; partage.dernier = ''; memoriser();
    profil = ''; localStorage.removeItem(CLE_PROFIL);
    fermerModale(); codeRefuse(); majEtat('local');
    return;
  }
  if (c('#r-raz')) {
    if (!await confirmer('Tout effacer ?', "Groupes, jeunes, assises, dars et photos de ce téléphone. Exporte d'abord si tu veux garder une trace.", 'Continuer', true)) return;
    if (!await confirmer('Vraiment tout effacer ?', 'Suppression définitive, sans retour possible.', 'Tout effacer', true)) return;
    D = vide(); sauver();
    Promise.all(album.map(p => idbEffacer('originaux', p.id).then(() => idbEffacer('vignettes', p.id))))
      .then(() => { album = []; rendre(); });
    fermerModale(); aller('accueil'); return toast('Données effacées');
  }
  if ((el = c('[data-theme]'))) {
    const t = el.dataset.theme;
    if (t) { document.documentElement.dataset.theme = t; localStorage.setItem('ej.theme', t); }
    else { delete document.documentElement.dataset.theme; localStorage.removeItem('ej.theme'); }
    return vueReglages();
  }
});

document.addEventListener('submit', async (ev) => {
  if (ev.target.id !== 'f-code') return;
  ev.preventDefault();
  const champ = ev.target.elements.code;
  const bouton = ev.target.querySelector('button[type=submit]');
  bouton.disabled = true; bouton.textContent = 'Connexion…';
  const err = await essayerCode(champ.value.trim());
  if (err) {
    bouton.disabled = false; bouton.textContent = 'Se connecter';
    const p = $('#code-erreur'); p.textContent = err; p.hidden = false;
  } else toast('Connecté : les données sont partagées');
});

document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.id === 'photo-file') {
    const fichiers = Array.from(t.files || []);
    t.value = '';
    if (fichiers.length && vue.photoCible) {
      toast('Traitement des photos…');
      ajouterPhotos(fichiers, vue.photoCible);
    }
    return;
  }
  if (t.id === 'sel-groupe') { vue.gid = t.value; remplacer(); return rendre(); }
  if (t.id === 'sel-date')   { vue.date = t.value || aujourdhui(); remplacer(); return rendre(); }
  if (t.id === 'r-file') {
    const f = t.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      let d;
      try {
        d = JSON.parse(r.result);
        if (!d.groupes || !d.membres) throw new Error('ce fichier n\'est pas un export de l\'outil');
      } catch (e) {
        return modale('Import impossible', `<p class="muted">${echap(e.message)}</p>`);
      }
      importEnAttente = d;
      const nb = (d.membres || []).length, na = (d.assises || []).length;
      modale('Importer ces données', `
        <p class="muted" style="margin-top:0">Le fichier contient ${pluriel((d.groupes || []).length, 'groupe')},
        ${pluriel(nb, 'jeune')} et ${pluriel(na, 'assise')}.</p>
        <p class="faint">Fusionner ajoute ce qui manque et met à jour le reste${partage.actif
          ? ', puis l\'envoie dans la base partagée.' : '. Remplacer efface ce qui est sur ce téléphone.'}</p>
        <div class="actions">
          ${partage.actif ? '' : '<button class="btn btn-danger" id="i-remplace">Tout remplacer</button>'}
          <button class="btn btn-primary grow" id="i-fusion">${ico('check')}Fusionner</button>
        </div>`);
    };
    r.readAsText(f);
    t.value = '';   // pour pouvoir réimporter le même fichier
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'in-theme' || t.id === 'in-commentaire') {
    const a = assiseCourante(true);
    a[t.id === 'in-theme' ? 'theme' : 'commentaire'] = t.value;
    $$('.etat-save').forEach(e => { e.textContent = 'Enregistrement…'; e.classList.remove('ok'); });
    clearTimeout(document._save);
    document._save = setTimeout(() => {
      sauver();
      $$('.etat-save').forEach(e => { e.textContent = '✓ Enregistré'; e.classList.add('ok'); });
    }, 500);
  }
  if (t.id === 'q-dars') {
    vue.q = t.value;
    clearTimeout(document._q);
    document._q = setTimeout(() => {
      const pos = t.selectionStart;
      rendre();
      const n = $('#q-dars');
      if (n) { n.focus(); n.setSelectionRange(pos, pos); }
    }, 250);
  }
  if (t.id === 'q-jeunes') {
    const q = t.value.toLowerCase().trim();
    $$('#liste-jeunes [data-nom]').forEach(b => { b.hidden = !!q && !b.dataset.nom.includes(q); });
  }
  if (t.id === 'liste-rapide') {
    const l = lireListe(t.value);
    $('#apercu-rapide').textContent = l.length
      ? `${pluriel(l.length, 'jeune')} : ${l.slice(0, 4).map(x => x.prenom + (x.niveau ? ' (' + x.niveau + ')' : '')).join(', ')}${l.length > 4 ? '…' : ''}`
      : "Aucun nom pour l'instant.";
  }
});

document.addEventListener('focusout', () => {
  if (rendreEnAttente) setTimeout(rendreSiPossible, 60);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (repondreA) return repondre(null);
  if (!$('#modal-back').hidden) fermerModale();
});

// ------------------------------------------------------------------ départ --
(function demarrer() {
  const th = localStorage.getItem('ej.theme');
  if (th) document.documentElement.dataset.theme = th;

  fetch('data/dars-partages.json')
    .then(r => r.ok ? r.json() : [])
    .then(l => { if (Array.isArray(l) && l.length) { darsPartages = l; if (vue.nom === 'dars') rendre(); } })
    .catch(() => {});

  idbTout('vignettes')
    .then(l => {
      album = l.sort((a, b) => (b.date + b.ajoutee).localeCompare(a.date + a.ajoutee));
      if (album.length) rendre();
    })
    .catch(e => console.error('Album illisible', e));

  history.replaceState({ v: copieVue(), n: 0 }, '');
  rendre();

  if (partage.actif) {
    majEtat(partage.code ? 'attente' : 'code');
    if (partage.code) recevoir().then(() => envoyer());
    // les autres encadrants pointent aussi : on relève la base régulièrement
    setInterval(() => { if (document.visibilityState === 'visible') recevoir(); }, 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') recevoir();
      else if (aEnvoyer().length) envoyer(true);
    });
    window.addEventListener('online', () => { envoyer(); recevoir(); });
  }
})();
