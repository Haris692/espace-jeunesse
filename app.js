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

function assisesDe(gid) {
  return D.assises
    .filter(a => !gid || a.groupeId === gid)
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
  if (vue.membreId)      app.innerHTML = vueMembre(vue.membreId);
  else if (vue.darsId)   app.innerHTML = vueDars(vue.darsId);
  else if (vue.nom === 'accueil') app.innerHTML = vueAccueil();
  else if (vue.nom === 'appel')   app.innerHTML = vueAppel();
  else if (vue.nom === 'groupes') app.innerHTML = vue.gid ? vueGroupe(vue.gid) : vueGroupes();
  else if (vue.nom === 'dars')    app.innerHTML = vueListeDars();
}

// ----------------------------------------------------------------- accueil --
function vueAccueil() {
  const total = D.membres.filter(m => m.actif !== false).length;
  const der = assisesDe()[0];
  const alertes = [];
  for (const g of D.groupes) {
    for (const m of membresDe(g.id)) {
      if (decroche(m.id, g.id)) alertes.push({ m, g, motif: '3 absences de suite' });
      else {
        const t = taux(m.id, g.id);
        if (t.base >= 4 && t.pct < 50) alertes.push({ m, g, motif: 'moins de 50 % de présence' });
      }
    }
  }

  let h = `<h1>Assalamu alaykum</h1>
  <p class="sub">${D.groupes.length} groupes · ${total} jeunes suivis · ${D.assises.length} assises enregistrées</p>

  <div class="tuiles">
    ${D.groupes.map(g => {
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
    ${D.groupes.map(g => `<button class="btn btn-primary" data-go-appel="${g.id}">✓ ${echap(g.nom)}</button>`).join('')}
  </div>`;

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
      <span class="ligne-nom truncate">${echap(a.theme || (g ? g.nom : 'Assise'))}</span>
      <span class="ligne-meta">${dateFr(a.date, true)}${g ? ' · ' + echap(g.nom) : ''}</span>
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
  const gid = vue.gid || (D.groupes[0] && D.groupes[0].id);
  if (!gid) return `<div class="empty">Crée d'abord un groupe dans l'onglet Groupes.</div>`;
  const g = groupe(gid);
  const ms = membresDe(gid);
  const a = trouverAssise(gid, vue.date);
  const c = a ? compte(a) : { present: 0, retard: 0, excuse: 0, absent: 0, vide: ms.length };

  let h = `<h1>Appel</h1>
  <p class="sub">${echap(g.nom)}${g.encadrant ? ' · ' + echap(g.encadrant) : ''}</p>

  <div class="card">
    <div class="field-2">
      <label class="field"><span>Groupe</span>
        <select id="sel-groupe">${D.groupes.map(x =>
          `<option value="${x.id}"${x.id === gid ? ' selected' : ''}>${echap(x.nom)}</option>`).join('')}</select>
      </label>
      <label class="field"><span>Date de l'assise</span>
        <input type="date" id="sel-date" value="${vue.date}">
      </label>
    </div>
    <label class="field" style="margin-bottom:0"><span>Thème / dars du jour</span>
      <input type="text" id="in-theme" placeholder="Ex. La sincérité dans l'intention" value="${echap(a ? a.theme || '' : '')}">
    </label>
  </div>`;

  if (!ms.length) {
    return h + `<div class="empty">Aucun jeune dans ce groupe.<br><br>
      <button class="btn btn-primary btn-sm" data-add-membre="${gid}">+ Ajouter un jeune</button></div>`;
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

  h += `</div>
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

// ------------------------------------------------------------------ groupes --
function vueGroupes() {
  let h = `<h1>Groupes</h1><p class="sub">Un encadrant par groupe, les jeunes rattachés à l'un ou à l'autre.</p><div class="liste">`;
  for (const g of D.groupes.slice().sort((a, b) => (a.ordre || 0) - (b.ordre || 0))) {
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

  let h = `<button class="btn btn-ghost btn-sm" data-retour-groupes>‹ Groupes</button>
  <h1>${echap(g.nom)}</h1>
  <p class="sub">${g.encadrant ? 'Encadrant : ' + echap(g.encadrant) + ' · ' : ''}${ms.filter(m => m.actif !== false).length} jeunes · ${as.length} assises</p>
  <div class="btn-row">
    <button class="btn btn-primary btn-sm" data-add-membre="${gid}">+ Ajouter un jeune</button>
    <button class="btn btn-sm" data-edit-groupe="${gid}">Modifier le groupe</button>
    <button class="btn btn-sm" data-export-csv="${gid}">Export CSV</button>
  </div>

  <div class="section"><h2>Les jeunes</h2></div>`;

  if (!ms.length) h += `<div class="empty">Personne pour l'instant.</div>`;
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
        <label class="field"><span>Groupe</span><select name="groupeId">${D.groupes.map(g =>
          `<option value="${g.id}"${(e.groupeId || gid) === g.id ? ' selected' : ''}>${echap(g.nom)}</option>`).join('')}</select></label>
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
  const etat = { present: 'Présent', retard: 'Retard', excuse: 'Excusé', absent: 'Absent' };
  modale(dateFr(a.date, true), `
    <p class="muted" style="margin-top:0">${g ? echap(g.nom) : ''}${a.theme ? ' · ' + echap(a.theme) : ''}</p>
    <div class="compte" style="margin-bottom:12px">
      <span class="chip c-present">Présents ${c.present}</span>
      <span class="chip c-retard">Retards ${c.retard}</span>
      <span class="chip c-excuse">Excusés ${c.excuse}</span>
      <span class="chip c-absent">Absents ${c.absent}</span>
    </div>
    ${a.commentaire ? `<div class="card" style="white-space:pre-wrap">${echap(a.commentaire)}</div>` : ''}
    <div class="liste">${membresDe(a.groupeId, true).map(m => {
      const s = a.presences[m.id];
      return s ? `<div class="item" style="cursor:default"><span class="grow">${echap(nomComplet(m))}</span>
        <span class="chip c-${s}">${etat[s]}</span></div>` : '';
    }).join('')}</div>
    <div class="btn-row" style="margin-top:14px">
      <button class="btn btn-primary grow" data-ouvrir-appel="${a.id}">Reprendre l'appel</button>
      <button class="btn btn-danger" data-del-assise="${a.id}">Supprimer</button>
    </div>`);
}

// ----------------------------------------------------------------- réglages --
function vueReglages() {
  modale('Réglages', `
    <div class="card">
      <h3>Sauvegarde</h3>
      <p class="muted">Les données vivent dans ce navigateur uniquement. Exporte régulièrement :
      c'est aussi le seul moyen de transmettre le suivi à un autre encadrant.</p>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" id="r-export">Exporter (JSON)</button>
        <button class="btn btn-sm" id="r-import">Importer</button>
        <button class="btn btn-sm" id="r-csv">Présences (CSV)</button>
      </div>
      <input type="file" id="r-file" accept="application/json,.json" hidden>
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
document.addEventListener('click', (ev) => {
  const c = (s) => ev.target.closest(s);
  let el;

  // navigation par onglets
  if ((el = c('.tab'))) return aller(el.dataset.view, { gid: null });

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
    if (!confirm('Tout effacer ? Exporte d\'abord si tu veux garder une trace.')) return;
    if (!confirm('Confirmer : suppression définitive de toutes les données.')) return;
    D = vide(); sauver(); fermerModale(); aller('accueil'); return toast('Données effacées');
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
  if (t.id === 'sel-groupe') { vue.gid = t.value; return rendre(); }
  if (t.id === 'sel-date')   { vue.date = t.value || aujourdhui(); return rendre(); }
  if (t.id === 'r-file') {
    const f = t.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d.groupes || !d.membres) throw new Error('format');
        if (!confirm('Remplacer les données actuelles par ce fichier ?')) return;
        D = Object.assign(vide(), d);
        sauver(); fermerModale(); aller('accueil'); toast('Données importées');
      } catch (e) { alert('Fichier illisible : ' + e.message); }
    };
    r.readAsText(f);
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

  rendre();
})();
