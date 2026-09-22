/* Espace Jeunesse — suivi des groupes, appel des assises, bibliothèque de dars.
   Tout tient dans le navigateur (localStorage). Aucun serveur, aucune donnée
   envoyée ailleurs. La sauvegarde se fait à chaque modification ; l'export JSON
   des Réglages est le seul moyen de transmettre les données à un autre poste. */

'use strict';

// ---------------------------------------------------------------- stockage --
const CLE = 'espace-jeunesse.v1';

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
   dans l'export — sinon un import changerait la vue de celui qui importe. */
const CLE_PROFIL = 'espace-jeunesse.profil';
let profil = localStorage.getItem(CLE_PROFIL) || '';

function profilOk()      { return profil === 'tous' || !!groupe(profil); }
function estVisible(gid) { return profil === 'tous' || gid === profil; }

function groupesVisibles() {
  return (profil === 'tous' ? D.groupes.slice() : [groupe(profil)].filter(Boolean))
    .sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
}

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
    const d = JSON.parse(brut);
    return Object.assign(vide(), d);
  } catch (e) {
    console.error('Lecture des données impossible', e);
    return vide();
  }
}

function sauver() {
  try {
    localStorage.setItem(CLE, JSON.stringify(D));
  } catch (e) {
    toast('Sauvegarde impossible — mémoire du navigateur pleine ?');
    console.error(e);
  }
}

// ------------------------------------------------------------------ photos --
/* Des photos dans localStorage feraient sauter le quota en une assise. Elles
   vont donc dans IndexedDB, et dans deux magasins séparés : les vignettes,
   légères, qu'on charge d'un bloc pour l'album, et les originaux, qu'on ne lit
   que lorsqu'on ouvre une photo en grand. Elles ne quittent jamais l'appareil
   et ne partent pas dans l'export JSON. */
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
function reduire(fichier, cote, qualite) {
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
  }).then(c => c);
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
      const grand  = await reduire(f, 1600, 0.78);
      const petit  = await reduire(f, 420, 0.6);
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
  toast(n ? `${n} photo${n > 1 ? 's' : ''} ajoutée${n > 1 ? 's' : ''}`
          : 'Aucune photo lisible');
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

const aujourdhui = () => new Date().toISOString().slice(0, 10);

function dateFr(iso, long) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function initiales(m) {
  return ((m.prenom || '')[0] || '?').toUpperCase() + ((m.nom || '')[0] || '').toUpperCase();
}

const nomComplet = (m) => (m.prenom + ' ' + (m.nom || '')).trim();

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

function toast(txt) {
  const t = $('#toast');
  t.textContent = txt;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2600);
}

function modale(titre, html) {
  $('#modal-title').textContent = titre;
  $('#modal-body').innerHTML = html;
  $('#modal-back').hidden = false;
  document.body.style.overflow = 'hidden';
}

function fermerModale() {
  $('#modal-back').hidden = true;
  $('#modal-body').innerHTML = '';
  document.body.style.overflow = '';
}

function telecharger(nomFichier, contenu, type) {
  const blob = new Blob([contenu], { type: type || 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nomFichier;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// -------------------------------------------------------------- navigation --
const vue = { nom: 'accueil', gid: null, membreId: null, darsId: null, date: aujourdhui() };

function aller(nom, extra) {
  Object.assign(vue, { membreId: null, darsId: null }, extra || {}, { nom });
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.view === nom));
  window.scrollTo(0, 0);
  rendre();
}

function rendre() {
  const app = $('#app');
  majEntete();

  if (!profilOk()) { app.innerHTML = vueBienvenue(); return; }

  // un encadrant ne navigue jamais hors de son groupe
  if (profil !== 'tous') vue.gid = profil;
  if (vue.membreId) {
    const m = D.membres.find(x => x.id === vue.membreId);
    if (!m || !estVisible(m.groupeId)) vue.membreId = null;
  }

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
  const seul = profilOk() && profil !== 'tous';
  t.textContent = profilOk() ? nomProfil() : 'Espace Jeunesse';
  t.classList.toggle('cliquable', profilOk());
  t.title = seul ? 'Changer de groupe' : '';
  $('#tabs').hidden = !profilOk();
}

// ------------------------------------------------------------- bienvenue ---
function vueBienvenue() {
  return `<div class="bienvenue">
    <h1>Espace Jeunesse</h1>
    <p class="sub">Le suivi des groupes, l'appel des assises et les dars.<br>
      Pour commencer : quel groupe suit cet appareil ?</p>
    ${D.groupes.sort((a, b) => (a.ordre || 0) - (b.ordre || 0)).map(g => `
      <button class="choix" data-profil="${g.id}">
        <span class="choix-nom">${echap(g.nom)}</span>
        <span class="choix-sous">${g.encadrant ? 'Encadré par ' + echap(g.encadrant) : 'Sans encadrant'}</span>
      </button>`).join('')}
    <button class="choix" data-profil="tous">
      <span class="choix-nom">Les deux groupes</span>
      <span class="choix-sous">Vue du référent</span>
    </button>
    <p class="faint" style="margin-top:18px">Ce choix se change à tout moment dans les réglages.
      Chaque appareil garde ses propres données.</p>
  </div>`;
}

function changerProfil() {
  modale('Quel groupe suit cet appareil ?', `
    <div class="bienvenue" style="padding:0">
      ${D.groupes.map(g => `<button class="choix${g.id === profil ? ' actif' : ''}" data-profil="${g.id}">
        <span class="choix-nom">${echap(g.nom)}</span>
        <span class="choix-sous">${g.encadrant ? echap(g.encadrant) : '—'} · ${membresDe(g.id).length} jeunes</span>
      </button>`).join('')}
      <button class="choix${profil === 'tous' ? ' actif' : ''}" data-profil="tous">
        <span class="choix-nom">Les deux groupes</span>
        <span class="choix-sous">Vue du référent</span>
      </button>
    </div>
    <p class="faint">Changer de groupe ne change rien aux données enregistrées : ça change ce que
      cet appareil affiche.</p>`);
}

// ----------------------------------------------------------------- accueil --
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

  let h = `<h1>Assalamu alaykum</h1>
  <p class="sub">${profil === 'tous' ? gs.length + ' groupes · ' : echap(nomProfil()) + ' · '}${
    total} jeune${total > 1 ? 's' : ''} suivi${total > 1 ? 's' : ''} · ${assisesDe().length} assises</p>

  <div class="tuiles">
    ${gs.map(g => {
      const ms = membresDe(g.id);
      const as = assisesDe(g.id);
      const der8 = as.slice(0, 8);
      let ok = 0, base = 0;
      for (const a of der8) for (const m of ms) {
        const s = a.presences && a.presences[m.id];
        if (s === 'present' || s === 'retard') { ok++; base++; }
        else if (s === 'absent') base++;
      }
      const pct = base ? Math.round(ok / base * 100) : null;
      return `<div class="tuile">
        <div class="n">${ms.length}</div>
        <div class="l">${echap(g.nom)}</div>
        <div class="muted" style="margin-top:6px">${g.encadrant ? echap(g.encadrant) + ' · ' : ''}${
          pct === null ? 'pas encore d\'appel' : pct + ' % de présence'}</div>
        ${pct === null ? '' : `<div class="jauge ${classeJauge(pct)}"><i style="width:${pct}%"></i></div>`}
      </div>`;
    }).join('')}
  </div>

  <div class="section"><h2>Faire l'appel</h2></div>
  <div class="btn-row">
    ${gs.map(g => `<button class="btn btn-primary" data-go-appel="${g.id}">✓ ${
      profil === 'tous' ? echap(g.nom) : 'Faire l\'appel'}</button>`).join('')}
  </div>

  <div class="section"><h2>Ajouter des jeunes</h2></div>
  <div class="btn-row">
    ${gs.map(g => `<button class="btn" data-ajout-rapide="${g.id}">+ ${
      profil === 'tous' ? echap(g.nom) : 'Inscrire des jeunes'}</button>`).join('')}
  </div>`;

  const prochaine = aVenir()[0];
  if (prochaine) {
    const pg = groupe(prochaine.groupeId);
    h += `<div class="section"><h2>Prochaine assise</h2></div>
    <button class="item" data-assise="${prochaine.id}">
      <span class="avatar">${dateFr(prochaine.date).slice(0, 2)}</span>
      <span class="grow">
        <span class="ligne-nom">${dateFr(prochaine.date, true)}</span>
        <span class="ligne-meta" style="display:block">${[
          prochaine.heure, prochaine.lieu, prochaine.theme,
          pg && profil === 'tous' ? pg.nom : ''].filter(Boolean).map(echap).join(' · ') || 'À préparer'}</span>
      </span>
      <span class="chip chip-accent">${echap(ecart(prochaine.date))}</span>
      <span class="fleche">›</span>
    </button>`;
  }

  if (alertes.length) {
    h += `<div class="section"><h2>À rappeler</h2><span class="chip chip-alert">${alertes.length}</span></div>
    <div class="liste">${alertes.slice(0, 8).map(a => `
      <button class="item" data-membre="${a.m.id}" data-gid="${a.g.id}">
        <span class="avatar">${echap(initiales(a.m))}</span>
        <span class="grow">
          <span class="ligne-nom">${echap(nomComplet(a.m))}</span>
          <span class="ligne-meta" style="display:block">${echap(a.motif)} · ${echap(a.g.nom)}</span>
        </span>
        <span class="fleche">›</span>
      </button>`).join('')}</div>`;
  }

  h += `<div class="section"><h2>Dernières assises</h2></div>`;
  const recentes = assisesDe().slice(0, 6);
  h += recentes.length ? `<div class="liste">${recentes.map(ligneAssise).join('')}</div>`
                       : `<div class="empty">Aucune assise enregistrée pour le moment.</div>`;
  return h;
}

function ligneAssise(a) {
  const g = groupe(a.groupeId);
  const c = compte(a);
  return `<button class="item" data-assise="${a.id}">
    <span class="avatar">${dateFr(a.date).slice(0, 2)}</span>
    <span class="grow">
      <span class="ligne-nom truncate">${echap(a.theme || 'Assise')}</span>
      <span class="ligne-meta">${dateFr(a.date, true)}${g && profil === 'tous' ? ' · ' + echap(g.nom) : ''}</span>
    </span>
    <span class="chip c-present">${c.present + c.retard}</span>
    <span class="fleche">›</span>
  </button>`;
}

function compte(a) {
  const c = { present: 0, retard: 0, excuse: 0, absent: 0, vide: 0 };
  for (const m of membresDe(a.groupeId, true)) {
    const s = a.presences && a.presences[m.id];
    if (c[s] !== undefined) c[s]++; else c.vide++;
  }
  return c;
}

// -------------------------------------------------------------------- appel --
function trouverAssise(gid, date) {
  return D.assises.find(a => a.groupeId === gid && a.date === date);
}

function vueAppel() {
  const gs = groupesVisibles();
  const gid = (estVisible(vue.gid) && vue.gid) || (gs[0] && gs[0].id);
  if (!gid) return `<div class="empty">Crée d'abord un groupe dans l'onglet Groupes.</div>`;
  const g = groupe(gid);
  const ms = membresDe(gid);
  const a = trouverAssise(gid, vue.date);
  const c = a ? compte(a) : { present: 0, retard: 0, excuse: 0, absent: 0, vide: ms.length };

  let h = `<h1>Appel</h1>
  <p class="sub">${echap(g.nom)}${g.encadrant ? ' · ' + echap(g.encadrant) : ''}</p>

  <div class="card">
    <div class="${gs.length > 1 ? 'field-2' : ''}">
      ${gs.length > 1 ? `<label class="field"><span>Groupe</span>
        <select id="sel-groupe">${gs.map(x =>
          `<option value="${x.id}"${x.id === gid ? ' selected' : ''}>${echap(x.nom)}</option>`).join('')}</select>
      </label>` : ''}
      <label class="field"><span>Date de l'assise</span>
        <input type="date" id="sel-date" value="${vue.date}">
      </label>
    </div>
    <label class="field" style="margin-bottom:0"><span>Thème / dars du jour</span>
      <input type="text" id="in-theme" placeholder="Ex. La sincérité dans l'intention" value="${echap(a ? a.theme || '' : '')}">
    </label>
  </div>`;

  if (!ms.length) {
    return h + `<div class="empty">Aucun jeune inscrit dans ce groupe.<br>
      L'appel se remplira une fois la liste faite.<br><br>
      <button class="btn btn-primary" data-ajout-rapide="${gid}">+ Inscrire les jeunes</button></div>`;
  }

  h += `<div class="appel-head">
    <div class="compte">
      <span class="chip c-present">Présents ${c.present}</span>
      <span class="chip c-retard">Retards ${c.retard}</span>
      <span class="chip c-excuse">Excusés ${c.excuse}</span>
      <span class="chip c-absent">Absents ${c.absent}</span>
      ${c.vide ? `<span class="chip">À pointer ${c.vide}</span>` : ''}
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn btn-sm" id="tout-present">Tout présent</button>
      <button class="btn btn-sm" id="raz">Effacer</button>
      <button class="btn btn-sm" id="imprimer">Imprimer</button>
    </div>
  </div>

  <div class="pointage">`;

  for (const m of ms) {
    const s = (a && a.presences && a.presences[m.id]) || '';
    const t = taux(m.id, gid);
    h += `<div class="ligne">
      <div class="card-row">
        <span class="avatar">${echap(initiales(m))}</span>
        <span class="grow">
          <div class="ligne-nom">${echap(nomComplet(m))}</div>
          <div class="ligne-meta">${m.niveau ? echap(m.niveau) + ' · ' : ''}${
            t.pct === null ? 'nouveau' : t.pct + ' % de présence'}</div>
        </span>
        <button class="icon-btn" data-membre="${m.id}" data-gid="${gid}" title="Fiche">›</button>
      </div>
      <div class="seg" data-membre-seg="${m.id}">
        <button data-v="present" data-on="${s === 'present' ? 1 : 0}">Présent</button>
        <button data-v="retard"  data-on="${s === 'retard'  ? 1 : 0}">Retard</button>
        <button data-v="excuse"  data-on="${s === 'excuse'  ? 1 : 0}">Excusé</button>
        <button data-v="absent"  data-on="${s === 'absent'  ? 1 : 0}">Absent</button>
      </div>
    </div>`;
  }

  const souvenirs = photosDe(gid, vue.date);
  h += `</div>
  <div class="btn-row" style="margin-top:10px">
    <button class="btn btn-wide" data-ajout-rapide="${gid}">+ Un nouveau est venu aujourd'hui</button>
  </div>

  <div class="card" style="margin-top:14px">
    <div class="card-row" style="margin-bottom:10px">
      <h3 class="grow" style="margin:0">Souvenir de l'assise</h3>
      <button class="btn btn-sm" data-photo-pour="${gid}">📷 Photo</button>
    </div>
    ${souvenirs.length
      ? `<div class="album">${souvenirs.map(p => `<button class="vign" data-photo="${p.id}">
           <img src="${p.vignette}" alt="Photo de l'assise" loading="lazy"></button>`).join('')}</div>`
      : `<p class="faint" style="margin:0">Rien pour ce jour. Une photo de groupe à la fin, et l'année se raconte toute seule.</p>`}
  </div>

  <div class="card" style="margin-top:14px">
    <label class="field" style="margin-bottom:0"><span>Remarques sur l'assise</span>
      <textarea id="in-commentaire" placeholder="Ce qui a marché, ce qui est à reprendre, les points à suivre…">${echap(a ? a.commentaire || '' : '')}</textarea>
    </label>
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
  return a;
}

function pointer(membreId, valeur) {
  const a = assiseCourante(true);
  if (a.presences[membreId] === valeur) delete a.presences[membreId];
  else a.presences[membreId] = valeur;
  sauver();
  rendre();
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
  return assisesDe().filter(a => a.date < h);
}

function ecart(iso) {
  const j = Math.round((new Date(iso + 'T12:00:00') - new Date(aujourdhui() + 'T12:00:00')) / 864e5);
  if (j === 0) return "aujourd'hui";
  if (j === 1) return 'demain';
  if (j === -1) return 'hier';
  return j > 0 ? `dans ${j} jours` : `il y a ${-j} jours`;
}

function vuePlanning() {
  const gs = groupesVisibles();
  const futur = aVenir();
  const passe = passees().slice(0, 8);

  const ligne = (a) => {
    const g = groupe(a.groupeId);
    const c = compte(a);
    const pointee = c.present + c.retard + c.excuse + c.absent > 0;
    return `<button class="item" data-assise="${a.id}">
      <span class="avatar">${dateFr(a.date).slice(0, 2)}</span>
      <span class="grow">
        <span class="ligne-nom truncate">${echap(a.theme || 'Assise')}</span>
        <span class="ligne-meta" style="display:block">${dateFr(a.date, true)}${
          a.heure ? ' · ' + echap(a.heure) : ''}${a.lieu ? ' · ' + echap(a.lieu) : ''}${
          g && profil === 'tous' ? ' · ' + echap(g.nom) : ''}</span>
      </span>
      ${pointee ? `<span class="chip c-present">${c.present + c.retard}</span>`
                : `<span class="chip">${echap(ecart(a.date))}</span>`}
      <span class="fleche">›</span>
    </button>`;
  };

  let h = `<h1>Planning</h1>
  <p class="sub">Les assises programmées. Le jour venu, on l'ouvre et on fait l'appel dedans.</p>
  <div class="btn-row">
    ${gs.map(g => `<button class="btn btn-primary" data-programmer="${g.id}">+ Programmer${
      profil === 'tous' ? ' — ' + echap(g.nom) : ' une assise'}</button>`).join('')}
  </div>

  <div class="section"><h2>À venir</h2>${futur.length ? `<span class="chip chip-accent">${futur.length}</span>` : ''}</div>`;

  h += futur.length
    ? `<div class="liste">${futur.map(ligne).join('')}</div>`
    : `<div class="empty">Rien de programmé.<br>
       Le plus simple : poser la première date et cocher « chaque semaine ».</div>`;

  if (passe.length) {
    h += `<div class="section"><h2>Déjà passées</h2></div>
          <div class="liste">${passe.map(ligne).join('')}</div>`;
  }
  return h;
}

function formSeance(a, gid) {
  const e = a || { date: aujourdhui(), heure: '', lieu: '' };
  const g = groupe(a ? a.groupeId : gid);
  modale(a ? "Modifier l'assise" : 'Programmer une assise', `
    <form id="f-seance">
      ${a ? '' : `<p class="muted" style="margin-top:0">Dans <b>${echap(g.nom)}</b>.</p>`}
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
      ${a ? '' : `<label class="field"><span>Répéter chaque semaine</span>
        <select name="repeter">
          <option value="1">Cette date seulement</option>
          <option value="4">4 semaines</option>
          <option value="8">8 semaines</option>
          <option value="12">12 semaines (un trimestre)</option>
        </select></label>`}
      <label class="field"><span>Notes de préparation</span><textarea name="notes" style="min-height:70px">${echap(e.notes || '')}</textarea></label>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary grow">${a ? 'Enregistrer' : 'Programmer'}</button>
        ${a ? `<button type="button" class="btn btn-danger" data-del-assise="${a.id}">Supprimer</button>` : ''}
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

    // on saute les dates déjà occupées par une assise du même groupe
    let posees = 0;
    const d0 = new Date(f.date + 'T12:00:00');
    for (let i = 0; i < (+f.repeter || 1); i++) {
      const jour = new Date(d0.getTime() + i * 7 * 864e5).toISOString().slice(0, 10);
      if (trouverAssise(gid, jour)) continue;
      D.assises.push({ id: id(), groupeId: gid, date: jour, heure: f.heure, lieu: f.lieu,
                       theme: f.theme, darsId: f.darsId, notes: f.notes,
                       encadrant: g ? g.encadrant : '', commentaire: '', presences: {} });
      posees++;
    }
    sauver(); fermerModale(); aller('planning');
    toast(posees ? `${posees} assise${posees > 1 ? 's' : ''} programmée${posees > 1 ? 's' : ''}`
                 : 'Ces dates étaient déjà prises');
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
        <span class="ligne-nom">${echap(g.nom)}</span>
        <span class="ligne-meta" style="display:block">${ms.length} jeune${ms.length > 1 ? 's' : ''}${
          g.encadrant ? ' · encadré par ' + echap(g.encadrant) : ''}</span>
      </span>
      <span class="fleche">›</span>
    </button>`;
  }
  h += `</div>
  <div class="btn-row" style="margin-top:16px">
    <button class="btn" id="add-groupe">+ Nouveau groupe</button>
  </div>`;
  return h;
}

function vueGroupe(gid) {
  const g = groupe(gid);
  if (!g) { vue.gid = null; return vueGroupes(); }
  const ms = membresDe(gid, true);
  const as = assisesDe(gid);

  let h = `${profil === 'tous' ? '<button class="btn btn-ghost btn-sm" data-retour-groupes>‹ Groupes</button>' : ''}
  <h1>${echap(g.nom)}</h1>
  <p class="sub">${g.encadrant ? 'Encadrant : ' + echap(g.encadrant) + ' · ' : ''}${ms.filter(m => m.actif !== false).length} jeunes · ${as.length} assises</p>
  <div class="btn-row">
    <button class="btn btn-primary btn-sm" data-ajout-rapide="${gid}">+ Ajouter des jeunes</button>
    <button class="btn btn-sm" data-add-membre="${gid}">+ Un seul, en détail</button>
    <button class="btn btn-sm" data-edit-groupe="${gid}">Modifier le groupe</button>
    <button class="btn btn-sm" data-export-csv="${gid}">Export CSV</button>
  </div>

  <div class="section"><h2>Les jeunes</h2></div>`;

  if (!ms.length) h += `<div class="empty">Personne pour l'instant.<br>
    Le plus rapide : <b>Ajouter des jeunes</b>, et coller la liste des prénoms.</div>`;
  else {
    h += `<div class="liste">`;
    for (const m of ms) {
      const t = taux(m.id, gid);
      const alerte = decroche(m.id, gid);
      h += `<button class="item" data-membre="${m.id}" data-gid="${gid}">
        <span class="avatar">${echap(initiales(m))}</span>
        <span class="grow">
          <span class="ligne-nom">${echap(nomComplet(m))} ${m.actif === false ? '<span class="chip">inactif</span>' : ''}${
            alerte ? ' <span class="chip chip-alert">à rappeler</span>' : ''}</span>
          <span class="ligne-meta" style="display:block">${m.niveau ? echap(m.niveau) + ' · ' : ''}${
            t.pct === null ? 'aucun appel' : `${t.pct} % · ${t.ok}/${t.base} assises`}</span>
          ${t.pct === null ? '' : `<span class="jauge ${classeJauge(t.pct)}"><i style="width:${t.pct}%"></i></span>`}
        </span>
        <span class="fleche">›</span>
      </button>`;
    }
    h += `</div>`;
  }

  h += `<div class="section"><h2>Assises</h2></div>`;
  h += as.length ? `<div class="liste">${as.slice(0, 15).map(ligneAssise).join('')}</div>`
                 : `<div class="empty">Aucune assise enregistrée.</div>`;
  return h;
}

// -------------------------------------------------------------- fiche jeune --
function vueMembre(mid) {
  const m = D.membres.find(x => x.id === mid);
  if (!m) { vue.membreId = null; return vueGroupes(); }
  const g = groupe(m.groupeId);
  const t = taux(m.id, m.groupeId);
  const hist = assisesDe(m.groupeId).filter(a => a.presences && a.presences[m.id]);

  const etiq = { present: ['Présent', 'c-present'], retard: ['Retard', 'c-retard'],
                 excuse: ['Excusé', 'c-excuse'], absent: ['Absent', 'c-absent'] };

  let h = `<button class="btn btn-ghost btn-sm" data-retour-membre>‹ Retour</button>
  <div class="card-row" style="margin:6px 0 14px">
    <span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${echap(initiales(m))}</span>
    <div class="grow">
      <h1 style="margin:0">${echap(nomComplet(m))}</h1>
      <p class="muted" style="margin:2px 0 0">${[m.niveau, g && g.nom].filter(Boolean).map(echap).join(' · ')}</p>
    </div>
  </div>

  <div class="tuiles">
    <div class="tuile"><div class="n">${t.pct === null ? '—' : t.pct + ' %'}</div><div class="l">Présence</div>
      ${t.pct === null ? '' : `<div class="jauge ${classeJauge(t.pct)}"><i style="width:${t.pct}%"></i></div>`}</div>
    <div class="tuile"><div class="n">${t.ok}</div><div class="l">Assises suivies</div></div>
    <div class="tuile"><div class="n">${t.ko}</div><div class="l">Absences</div></div>
    <div class="tuile"><div class="n">${t.exc}</div><div class="l">Excusés</div></div>
  </div>

  <div class="card" style="margin-top:14px">
    ${m.telephone   ? `<div class="card-row"><span class="muted grow">Téléphone</span><a href="tel:${echap(m.telephone)}">${echap(m.telephone)}</a></div>` : ''}
    ${m.contact     ? `<div class="card-row"><span class="muted grow">Contact parent</span><a href="tel:${echap(m.contact)}">${echap(m.contact)}</a></div>` : ''}
    ${m.dateArrivee ? `<div class="card-row"><span class="muted grow">Arrivé le</span><span>${dateFr(m.dateArrivee)}</span></div>` : ''}
    <div class="btn-row" style="margin-top:10px">
      <button class="btn btn-sm" data-edit-membre="${m.id}">Modifier</button>
      <button class="btn btn-sm" data-note-membre="${m.id}">+ Note de suivi</button>
    </div>
  </div>

  <div class="section"><h2>Notes de suivi</h2></div>`;

  const notes = (m.notes || []).slice().sort((a, b) => b.date.localeCompare(a.date));
  h += notes.length ? `<div class="liste">${notes.map((n, i) => `
      <div class="card">
        <div class="card-row"><span class="faint grow">${dateFr(n.date, true)}</span>
          <button class="icon-btn" data-del-note="${m.id}:${i}" title="Supprimer">✕</button></div>
        <div style="white-space:pre-wrap">${echap(n.texte)}</div>
      </div>`).join('')}</div>`
    : `<div class="empty">Rien de noté. Une remarque, un besoin, un mot d'un parent : c'est ici.</div>`;

  h += `<div class="section"><h2>Historique de présence</h2></div>`;
  h += hist.length ? `<div class="liste">${hist.map(a => {
      const s = a.presences[m.id];
      const e = etiq[s] || ['—', ''];
      return `<button class="item" data-assise="${a.id}">
        <span class="grow"><span class="ligne-nom">${dateFr(a.date, true)}</span>
          <span class="ligne-meta" style="display:block">${echap(a.theme || '—')}</span></span>
        <span class="chip ${e[1]}">${e[0]}</span></button>`;
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
  let h = `<h1>Dars</h1>
  <p class="sub">Les supports d'assise : plan, textes, objectif. Réutilisables d'un groupe à l'autre.</p>
  <div class="btn-row">
    <button class="btn btn-primary btn-sm" id="add-dars">+ Nouveau dars</button>
    <button class="btn btn-sm" id="export-dars">Exporter pour partage</button>
  </div>
  <label class="field" style="margin-top:14px"><span>Rechercher</span>
    <input type="text" id="q-dars" placeholder="Titre, thème, texte…" value="${echap(vue.q || '')}"></label>`;

  const q = (vue.q || '').toLowerCase().trim();
  const filtres = liste.filter(d => !q ||
    [d.titre, d.theme, d.objectif, d.plan, d.textes, d.references].join(' ').toLowerCase().includes(q));

  if (!filtres.length) {
    h += `<div class="empty">${liste.length ? 'Aucun dars ne correspond.' : 'Aucun dars enregistré. Le premier se crée en haut de page.'}</div>`;
    return h;
  }

  h += `<div class="liste" style="margin-top:6px">`;
  for (const d of filtres) {
    h += `<button class="item" data-dars="${d.id}">
      <span class="avatar">▤</span>
      <span class="grow">
        <span class="ligne-nom truncate">${echap(d.titre)}</span>
        <span class="ligne-meta" style="display:block">${[d.date ? dateFr(d.date) : '', d.cible, d.auteur].filter(Boolean).map(echap).join(' · ')}</span>
      </span>
      ${d.partage ? '<span class="chip chip-accent">partagé</span>' : ''}
      <span class="fleche">›</span>
    </button>`;
  }
  return h + `</div>`;
}

function vueDars(did) {
  const d = tousLesDars().find(x => x.id === did);
  if (!d) { vue.darsId = null; return vueListeDars(); }
  const bloc = (titre, txt, cls) => txt
    ? `<div class="dars-bloc"><h3>${titre}</h3><div class="${cls || 'dars-corps'}">${echap(txt)}</div></div>` : '';

  return `<button class="btn btn-ghost btn-sm" data-retour-dars>‹ Dars</button>
  <h1>${echap(d.titre)}</h1>
  <p class="sub">${[d.date ? dateFr(d.date, true) : '', d.cible, d.duree ? d.duree + ' min' : '', d.auteur]
    .filter(Boolean).map(echap).join(' · ')}</p>
  ${d.partage ? '' : `<div class="btn-row"><button class="btn btn-sm" data-edit-dars="${d.id}">Modifier</button>
    <button class="btn btn-sm btn-danger" data-del-dars="${d.id}">Supprimer</button>
    <button class="btn btn-sm" onclick="window.print()">Imprimer</button></div>`}
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
  <p class="sub">Les photos des assises. Elles restent sur cet appareil : elles ne partent
  ni sur internet, ni dans l'export.</p>
  <div class="btn-row">
    ${gs.map(g => `<button class="btn btn-primary" data-photo-pour="${g.id}">📷 ${
      profil === 'tous' ? echap(g.nom) : 'Ajouter des photos'}</button>`).join('')}
  </div>`;

  if (!photos.length) {
    return h + `<div class="empty" style="margin-top:16px">Aucune photo pour l'instant.<br>
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
    h += `<div class="section"><h2>${dateFr(j.date, true)}${
      g && profil === 'tous' ? ' · ' + echap(g.nom) : ''}</h2>
      <span class="faint">${j.liste.length} photo${j.liste.length > 1 ? 's' : ''}</span></div>
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
    <p class="muted" style="margin:10px 0 0">${dateFr(p.date, true)}${
      g ? ' · ' + echap(g.nom) : ''} · ${Math.round(p.poids / 1024)} Ko</p>
    <label class="field" style="margin-top:12px"><span>Légende</span>
      <input type="text" id="photo-legende" value="${echap(p.legende || '')}" placeholder="Ce qu'on veut se rappeler"></label>
    <div class="btn-row">
      <button class="btn btn-primary grow" data-photo-enregistrer="${p.id}">Enregistrer la légende</button>
      <button class="btn" data-photo-telecharger="${p.id}">Télécharger</button>
      <button class="btn btn-danger" data-photo-supprimer="${p.id}">Supprimer</button>
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
  await idbEffacer('originaux', pid);
  await idbEffacer('vignettes', pid);
  album = album.filter(p => p.id !== pid);
  fermerModale(); rendre(); toast('Photo supprimée');
}

async function telechargerPhoto(pid) {
  const p = album.find(x => x.id === pid);
  const blob = await idbLire('originaux', pid);
  if (!blob) return toast('Photo introuvable');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `assise-${p.date}-${pid.slice(0, 4)}.jpg`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------- formulaires --
function formMembre(m, gid) {
  const e = m || { actif: true, dateArrivee: aujourdhui() };
  modale(m ? 'Modifier le jeune' : 'Ajouter un jeune', `
    <form id="f-membre">
      <div class="field-2">
        <label class="field"><span>Prénom</span><input type="text" name="prenom" required value="${echap(e.prenom || '')}"></label>
        <label class="field"><span>Nom</span><input type="text" name="nom" value="${echap(e.nom || '')}"></label>
      </div>
      <div class="field-2">
        <label class="field"><span>Classe / niveau</span><input type="text" name="niveau" placeholder="4ème, 2nde…" value="${echap(e.niveau || '')}"></label>
        ${profil === 'tous'
          ? `<label class="field"><span>Groupe</span><select name="groupeId">${D.groupes.map(g =>
              `<option value="${g.id}"${(e.groupeId || gid) === g.id ? ' selected' : ''}>${echap(g.nom)}</option>`).join('')}</select></label>`
          : `<input type="hidden" name="groupeId" value="${echap(e.groupeId || gid || profil)}">`}
      </div>
      <div class="field-2">
        <label class="field"><span>Téléphone du jeune</span><input type="tel" name="telephone" value="${echap(e.telephone || '')}"></label>
        <label class="field"><span>Contact d'un parent</span><input type="tel" name="contact" value="${echap(e.contact || '')}"></label>
      </div>
      <label class="field"><span>Arrivé le</span><input type="date" name="dateArrivee" value="${echap(e.dateArrivee || '')}"></label>
      <label class="field"><span>Suit encore le groupe</span>
        <select name="actif"><option value="1"${e.actif !== false ? ' selected' : ''}>Oui</option>
        <option value="0"${e.actif === false ? ' selected' : ''}>Non, ne vient plus</option></select></label>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary grow">Enregistrer</button>
        ${m ? `<button type="button" class="btn btn-danger" data-del-membre="${m.id}">Supprimer</button>` : ''}
      </div>
    </form>`);

  $('#f-membre').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    f.actif = f.actif === '1';
    if (m) Object.assign(m, f);
    else D.membres.push(Object.assign({ id: id(), notes: [] }, f));
    sauver(); fermerModale(); rendre(); toast('Enregistré');
  });
}

/* Inscrire toute une liste d'un coup : au début d'année on a les prénoms sur
   un papier, pas envie de remplir dix formulaires. Une ligne = un jeune,
   « Prénom Nom » et, après une virgule, la classe si on l'a. */
function formAjoutRapide(gid) {
  const g = groupe(gid);
  modale('Ajouter des jeunes', `
    <p class="muted" style="margin-top:0">Dans <b>${echap(g.nom)}</b>. Un jeune par ligne :
    prénom, nom si tu l'as, puis une virgule et la classe.</p>
    <form id="f-rapide">
      <label class="field"><span>La liste</span>
        <textarea name="liste" style="min-height:150px" placeholder="Yassin B., 4ème
Ilyas K., 3ème
Anas
Bilal S."></textarea></label>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary grow">Inscrire</button>
        <button type="button" class="btn" data-add-membre="${gid}">Un seul, en détail</button>
      </div>
    </form>`);

  $('#f-rapide').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const lignes = new FormData(ev.target).get('liste').split('\n')
      .map(l => l.trim()).filter(Boolean);
    let n = 0;
    for (const l of lignes) {
      const [ident, niveau] = l.split(/[,;]/);
      const mots = ident.trim().split(/\s+/);
      const prenom = mots.shift();
      if (!prenom) continue;
      D.membres.push({
        id: id(), groupeId: gid, prenom,
        nom: mots.join(' '), niveau: (niveau || '').trim(),
        telephone: '', contact: '', dateArrivee: aujourdhui(), actif: true, notes: []
      });
      n++;
    }
    sauver(); fermerModale();
    vue.gid = gid; vue.membreId = null; rendre();   // on reste sur l'écran d'où on vient
    toast(n ? `${n} jeune${n > 1 ? 's' : ''} inscrit${n > 1 ? 's' : ''}` : 'Aucun nom lu');
  });
}

function formGroupe(g) {
  const e = g || {};
  modale(g ? 'Modifier le groupe' : 'Nouveau groupe', `
    <form id="f-groupe">
      <label class="field"><span>Nom du groupe</span><input type="text" name="nom" required value="${echap(e.nom || '')}"></label>
      <label class="field"><span>Encadrant</span><input type="text" name="encadrant" value="${echap(e.encadrant || '')}"></label>
      <div class="btn-row">
        <button type="submit" class="btn btn-primary grow">Enregistrer</button>
        ${g ? `<button type="button" class="btn btn-danger" data-del-groupe="${g.id}">Supprimer</button>` : ''}
      </div>
    </form>`);

  $('#f-groupe').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    if (g) Object.assign(g, f);
    else D.groupes.push(Object.assign({ id: id(), ordre: D.groupes.length + 1 }, f));
    sauver(); fermerModale(); rendre(); toast('Enregistré');
  });
}

function formDars(d) {
  const e = d || { date: aujourdhui() };
  modale(d ? 'Modifier le dars' : 'Nouveau dars', `
    <form id="f-dars">
      <label class="field"><span>Titre</span><input type="text" name="titre" required value="${echap(e.titre || '')}"></label>
      <div class="field-2">
        <label class="field"><span>Date</span><input type="date" name="date" value="${echap(e.date || '')}"></label>
        <label class="field"><span>Pour quel groupe</span><select name="cible">
          <option value="">Les deux</option>
          ${D.groupes.map(g => `<option${e.cible === g.nom ? ' selected' : ''}>${echap(g.nom)}</option>`).join('')}
        </select></label>
      </div>
      <div class="field-2">
        <label class="field"><span>Encadrant</span><input type="text" name="auteur" value="${echap(e.auteur || '')}"></label>
        <label class="field"><span>Durée (min)</span><input type="number" name="duree" min="0" step="5" value="${echap(e.duree || '')}"></label>
      </div>
      <label class="field"><span>Thème</span><input type="text" name="theme" value="${echap(e.theme || '')}"></label>
      <label class="field"><span>Objectif — ce qu'ils doivent retenir</span><textarea name="objectif" style="min-height:70px">${echap(e.objectif || '')}</textarea></label>
      <label class="field"><span>Plan / déroulé</span><textarea name="plan">${echap(e.plan || '')}</textarea></label>
      <label class="field"><span>Texte en arabe</span><textarea name="arabe" dir="rtl" style="min-height:70px">${echap(e.arabe || '')}</textarea></label>
      <label class="field"><span>Coran &amp; hadith (traduction, références)</span><textarea name="textes" style="min-height:70px">${echap(e.textes || '')}</textarea></label>
      <label class="field"><span>Références / lectures</span><textarea name="references" style="min-height:60px">${echap(e.references || '')}</textarea></label>
      <label class="field"><span>Lien vers un support (PDF, diapos…)</span><input type="text" name="support" value="${echap(e.support || '')}"></label>
      <div class="btn-row"><button type="submit" class="btn btn-primary btn-wide">Enregistrer</button></div>
    </form>`);

  $('#f-dars').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target).entries());
    if (d) Object.assign(d, f);
    else { const n = Object.assign({ id: id() }, f); D.dars.push(n); vue.darsId = n.id; }
    sauver(); fermerModale(); rendre(); toast('Dars enregistré');
  });
}

function formNote(m) {
  modale('Note de suivi', `
    <form id="f-note">
      <label class="field"><span>Date</span><input type="date" name="date" value="${aujourdhui()}"></label>
      <label class="field"><span>Note</span><textarea name="texte" required placeholder="Un progrès, une difficulté, un échange avec les parents…"></textarea></label>
      <div class="btn-row"><button type="submit" class="btn btn-primary btn-wide">Ajouter</button></div>
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
  const etat = { present: 'Présent', retard: 'Retard', excuse: 'Excusé', absent: 'Absent' };

  modale(dateFr(a.date, true), `
    <p class="muted" style="margin-top:0">${[
      g && profil === 'tous' ? g.nom : '', a.heure, a.lieu, a.theme
    ].filter(Boolean).map(echap).join(' · ') || 'Assise'}</p>

    ${pointee ? `<div class="compte" style="margin-bottom:12px">
      <span class="chip c-present">Présents ${c.present}</span>
      <span class="chip c-retard">Retards ${c.retard}</span>
      <span class="chip c-excuse">Excusés ${c.excuse}</span>
      <span class="chip c-absent">Absents ${c.absent}</span>
    </div>` : `<p class="chip chip-accent">${echap(ecart(a.date))} · pas encore pointée</p>`}

    ${d ? `<div class="card"><span class="faint">Dars prévu</span><br>
      <button class="btn btn-ghost btn-sm" data-dars="${d.id}" style="padding-left:0">▤ ${echap(d.titre)}</button></div>` : ''}
    ${a.notes ? `<div class="card"><span class="faint">Préparation</span>
      <div style="white-space:pre-wrap">${echap(a.notes)}</div></div>` : ''}
    ${a.commentaire ? `<div class="card"><span class="faint">Remarques</span>
      <div style="white-space:pre-wrap">${echap(a.commentaire)}</div></div>` : ''}

    ${photos.length ? `<div class="album" style="margin-bottom:12px">${photos.map(p =>
      `<button class="vign" data-photo="${p.id}"><img src="${p.vignette}" alt="Photo de l'assise" loading="lazy"></button>`
      ).join('')}</div>` : ''}

    <div class="liste">${membresDe(a.groupeId, true).map(m => {
      const s = a.presences[m.id];
      return s ? `<div class="item" style="cursor:default"><span class="grow">${echap(nomComplet(m))}</span>
        <span class="chip c-${s}">${etat[s]}</span></div>` : '';
    }).join('')}</div>

    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-primary grow" data-ouvrir-appel="${a.id}">${
        pointee ? "Reprendre l'appel" : "Faire l'appel"}</button>
      <button class="btn" data-edit-seance="${a.id}">Modifier</button>
      <button class="btn btn-danger" data-del-assise="${a.id}">Supprimer</button>
    </div>`);
}

// ----------------------------------------------------------------- réglages --
function vueReglages() {
  modale('Réglages', `
    <div class="card">
      <h3>Groupe de cet appareil</h3>
      <p class="muted">Cet appareil affiche <b>${echap(nomProfil())}</b>.
      Chaque encadrant ouvre le sien : les deux groupes ne se mélangent pas à l'écran.</p>
      <button class="btn btn-sm" id="r-profil">Changer de groupe</button>
    </div>
    <div class="card">
      <h3>Sauvegarde</h3>
      <p class="muted">Les données vivent dans ce navigateur uniquement. Exporte régulièrement :
      c'est aussi le seul moyen de transmettre le suivi à un autre encadrant.</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="r-export">Exporter (JSON)</button>
        <button class="btn btn-sm" id="r-import">Importer</button>
        <button class="btn btn-sm" id="r-csv">Présences (CSV)</button>
      </div>
      <p class="faint">À l'import, on te demandera si tu fusionnes — c'est ce qu'il faut pour
      réunir le collège et le lycée chez le référent sans écraser l'un avec l'autre.</p>
      <input type="file" id="r-file" accept="application/json,.json" hidden>
    </div>
    <div class="card">
      <h3>Photos</h3>
      <p class="muted">${album.length} photo${album.length > 1 ? 's' : ''} sur cet appareil${
        album.length ? ` (${(album.reduce((n, p) => n + (p.poids || 0), 0) / 1048576).toFixed(1)} Mo)` : ''}.
      Elles sont stockées à part du reste et <b>ne partent pas dans l'export JSON</b> —
      volontairement : des visages de mineurs n'ont pas à circuler dans un fichier.
      Chaque photo se télécharge une par une depuis l'album.</p>
    </div>
    <div class="card">
      <h3>Apparence</h3>
      <div class="btn-row">
        <button class="btn btn-sm" data-theme="">Automatique</button>
        <button class="btn btn-sm" data-theme="light">Clair</button>
        <button class="btn btn-sm" data-theme="dark">Sombre</button>
      </div>
    </div>
    <div class="card">
      <h3>Remise à zéro</h3>
      <p class="muted">Efface tout : groupes, jeunes, assises, dars. Sans retour possible.</p>
      <button class="btn btn-danger btn-sm" id="r-raz">Tout effacer</button>
    </div>
    <p class="faint">${D.membres.length} jeunes · ${D.assises.length} assises · ${D.dars.length} dars enregistrés ici.</p>`);
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
      ex.presences  = Object.assign({}, ex.presences, a.presences);
      ex.theme      = a.theme || ex.theme;
      ex.commentaire = a.commentaire || ex.commentaire;
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

document.addEventListener('click', (ev) => {
  const c = (s) => ev.target.closest(s);
  let el;

  // choix du groupe suivi par cet appareil
  if ((el = c('[data-profil]'))) return choisirProfil(el.dataset.profil);
  if (c('#titre-profil') && profilOk()) return changerProfil();
  if (c('#r-profil')) return changerProfil();

  if (c('#i-fusion') && importEnAttente) {
    fusionner(importEnAttente); importEnAttente = null;
    sauver(); fermerModale(); aller('accueil'); return toast('Données fusionnées');
  }
  if (c('#i-remplace') && importEnAttente) {
    D = Object.assign(vide(), importEnAttente); importEnAttente = null;
    sauver(); fermerModale(); aller('accueil'); return toast('Données remplacées');
  }

  // navigation par onglets
  if ((el = c('.tab'))) return aller(el.dataset.view, { gid: profil === 'tous' ? null : profil });

  // pointage
  if ((el = c('.seg button'))) {
    const mid = el.closest('[data-membre-seg]').dataset.membreSeg;
    return pointer(mid, el.dataset.v);
  }

  if ((el = c('[data-go-appel]')))   return aller('appel', { gid: el.dataset.goAppel, date: aujourdhui() });
  if ((el = c('[data-groupe]')))     { vue.gid = el.dataset.groupe; return aller('groupes', { gid: el.dataset.groupe }); }
  if ((el = c('[data-membre]')))     { vue.gid = el.dataset.gid || vue.gid; vue.membreId = el.dataset.membre; window.scrollTo(0,0); return rendre(); }
  if ((el = c('[data-dars]')))       { vue.darsId = el.dataset.dars; window.scrollTo(0,0); return rendre(); }
  if ((el = c('[data-assise]')))     return vueAssise(el.dataset.assise);

  if (c('[data-retour-groupes]')) { vue.gid = null; return rendre(); }
  if (c('[data-retour-membre]'))  { vue.membreId = null; return rendre(); }
  if (c('[data-retour-dars]'))    { vue.darsId = null; return rendre(); }

  // planning
  if ((el = c('[data-programmer]')))  return formSeance(null, el.dataset.programmer);
  if ((el = c('[data-edit-seance]'))) return formSeance(D.assises.find(x => x.id === el.dataset.editSeance));

  // photos
  if ((el = c('[data-photo-pour]'))) {
    vue.photoCible = { gid: el.dataset.photoPour, date: vue.nom === 'appel' ? vue.date : aujourdhui() };
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

  if ((el = c('[data-del-membre]'))) {
    if (!confirm('Supprimer ce jeune et son historique ?')) return;
    D.membres = D.membres.filter(m => m.id !== el.dataset.delMembre);
    D.assises.forEach(a => { delete a.presences[el.dataset.delMembre]; });
    vue.membreId = null; sauver(); fermerModale(); rendre(); return toast('Supprimé');
  }
  if ((el = c('[data-del-groupe]'))) {
    const gid = el.dataset.delGroupe;
    if (membresDe(gid, true).length) return alert('Déplace d\'abord les jeunes de ce groupe.');
    if (!confirm('Supprimer ce groupe ?')) return;
    D.groupes = D.groupes.filter(g => g.id !== gid);
    D.assises = D.assises.filter(a => a.groupeId !== gid);
    vue.gid = null; sauver(); fermerModale(); rendre(); return;
  }
  if ((el = c('[data-del-dars]'))) {
    if (!confirm('Supprimer ce dars ?')) return;
    D.dars = D.dars.filter(d => d.id !== el.dataset.delDars);
    vue.darsId = null; sauver(); rendre(); return toast('Supprimé');
  }
  if ((el = c('[data-del-assise]'))) {
    if (!confirm('Supprimer cette assise et son appel ?')) return;
    D.assises = D.assises.filter(a => a.id !== el.dataset.delAssise);
    sauver(); fermerModale(); rendre(); return;
  }
  if ((el = c('[data-del-note]'))) {
    const [mid, i] = el.dataset.delNote.split(':');
    const m = D.membres.find(x => x.id === mid);
    if (m && confirm('Supprimer cette note ?')) { m.notes.splice(+i, 1); sauver(); rendre(); }
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
    sauver(); return rendre();
  }
  if (c('#raz')) {
    const a = assiseCourante(false);
    if (a && confirm('Effacer tout le pointage de cette assise ?')) { a.presences = {}; sauver(); rendre(); }
    return;
  }
  if (c('#imprimer')) return window.print();

  // dars
  if (c('#export-dars')) {
    if (!D.dars.length) return toast('Aucun dars à exporter');
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
  if (c('#r-raz')) {
    if (!confirm('Tout effacer, photos comprises ? Exporte d\'abord si tu veux garder une trace.')) return;
    if (!confirm('Confirmer : suppression définitive de toutes les données.')) return;
    D = vide(); sauver();
    Promise.all(album.map(p => idbEffacer('originaux', p.id).then(() => idbEffacer('vignettes', p.id))))
      .then(() => { album = []; rendre(); });
    fermerModale(); aller('accueil'); return toast('Données effacées');
  }
  if ((el = c('[data-theme]'))) {
    const t = el.dataset.theme;
    if (t) { document.documentElement.dataset.theme = t; localStorage.setItem('ej.theme', t); }
    else { delete document.documentElement.dataset.theme; localStorage.removeItem('ej.theme'); }
    return;
  }
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
  if (t.id === 'sel-groupe') { vue.gid = t.value; return rendre(); }
  if (t.id === 'sel-date')   { vue.date = t.value || aujourdhui(); return rendre(); }
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
        <p class="muted" style="margin-top:0">Le fichier contient ${(d.groupes || []).length} groupe(s),
        ${nb} jeune(s) et ${na} assise(s).</p>
        <div class="btn-row">
          <button class="btn btn-primary grow" id="i-fusion">Fusionner avec l'existant</button>
          <button class="btn btn-danger" id="i-remplace">Tout remplacer</button>
        </div>
        <p class="faint">Fusionner ajoute ce qui manque et met à jour le reste : c'est ce qu'il faut
        pour réunir les deux groupes. Remplacer efface ce qui est sur cet appareil.</p>`);
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
    clearTimeout(document._save);
    document._save = setTimeout(sauver, 400);
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
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !$('#modal-back').hidden) fermerModale();
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

  rendre();
})();
