# Espace Jeunesse

Outil de suivi pour les deux groupes jeunesse : l'appel des assises, le suivi de
chaque jeune, et la bibliothèque des dars. Page web simple, pensée pour le
téléphone, partagée entre tous les encadrants.

**En ligne :** https://haris692.github.io/espace-jeunesse/

## Un appareil, un groupe

Au premier lancement, l'outil demande **quel groupe suit cet appareil** :

- *Collège — 4ème / 3ème* (Amine)
- *Lycée* (Adel)
- *Les deux groupes* — la vue du référent

Le choix est tenu partout : un encadrant ne voit que ses jeunes, ses assises et
ses alertes. Pas de sélecteur de groupe à l'appel, pas de liste de groupes à
traverser, aucun risque de pointer dans le mauvais. Le nom du groupe reste
affiché en haut ; un appui dessus permet d'en changer, comme dans les réglages.

Les dars, eux, restent communs aux deux groupes : c'est une bibliothèque, chacun
y puise.

## Ce que ça fait

| Onglet | À quoi ça sert |
|---|---|
| **Accueil** | Effectifs, taux de présence des 8 dernières assises, la prochaine assise, et la liste des jeunes à rappeler (3 absences de suite, ou moins de 50 % de présence). |
| **Appel** | La feuille d'appel : un appui par jeune — Présent / Retard / Excusé / Absent, enregistré au fur et à mesure. En bas, la progression (*3 / 12 pointés*) et le bouton **Valider l'appel**, qui propose de marquer absents ceux qui restent puis affiche le récap, avec les absents à appeler. |
| **Planning** | Les assises programmées : date, heure, lieu, thème, dars prévu, notes de préparation. Le jour venu on ouvre l'assise et on fait l'appel dedans. |
| **Jeunes** | Le groupe et son encadrant, la liste des jeunes avec leur assiduité, et la fiche individuelle (contacts, historique, notes de suivi). |
| **Dars** | Les supports d'assise : objectif, plan, texte arabe, Coran et hadith, références, lien vers un PDF. Recherche plein texte. |
| **Photos** | L'album des assises, groupé par date, avec légendes. |

## Le planning

Une assise programmée *est* une assise, simplement sans pointage — il n'y a pas
deux objets à garder d'accord. On pose une date, éventuellement l'heure, le lieu
et le dars prévu, et on peut **répéter chaque semaine** jusqu'à un trimestre
d'un coup : les dates déjà occupées sont sautées, donc reprogrammer ne crée
jamais de doublon. Le jour J, on ouvre l'assise et on fait l'appel dedans.

## Les photos

Prises depuis l'appel (*Souvenir de l'assise*) ou depuis l'onglet Photos. Chaque
image est **réduite à 1600 px dans le navigateur** avant d'être rangée — une
photo de téléphone de 4 Mo en pèse environ 250 Ko, et les photos tournées de
travers sont redressées via leur orientation EXIF.

Elles ne vont pas dans `localStorage`, qui exploserait, mais dans **IndexedDB**,
en deux magasins : les vignettes (chargées d'un bloc pour l'album) et les
originaux (lus seulement à l'ouverture d'une photo).

**Elles ne partent pas dans l'export JSON**, volontairement : des visages de
mineurs n'ont pas à circuler dans un fichier qu'on s'échange. Elles restent sur
l'appareil qui les a prises ; chaque photo se télécharge une par une depuis
l'album si on veut la sortir.

## Inscrire les jeunes

Deux chemins, depuis l'accueil, l'appel ou la fiche du groupe :

- **Ajouter des jeunes** — on colle la liste, un par ligne. `Yassin B., 4ème`
  donne prénom, nom et classe ; une ligne avec juste `Anas` marche aussi.
- **Un seul, en détail** — le formulaire complet : contacts, date d'arrivée,
  et le cas d'un jeune qui ne vient plus.

## Où vivent les données

**Dans une base partagée** (Supabase, gratuite) : les groupes, les jeunes, les
appels et les dars sont les mêmes pour tous les encadrants. Ce qu'Amine pointe
apparaît chez Adel et chez le référent quelques secondes plus tard. La pastille
en haut de l'écran dit où on en est : *À jour*, *Envoi…*, *Hors ligne*.

Chaque téléphone garde aussi une copie : l'appli s'ouvre tout de suite et
continue de marcher sans réseau. Ce qui est saisi hors ligne part dès que la
connexion revient.

**Les photos ne sont jamais partagées** : elles restent sur le téléphone qui les
a prises (voir plus haut).

Tant que `config.js` est vide, l'outil fonctionne comme avant : chaque
téléphone garde ses données pour lui.

### Mettre en route le partage (une fois, ~10 minutes)

1. Créer un compte sur [supabase.com](https://supabase.com), puis un projet
   (région *Europe*, plan gratuit).
2. Dans le projet : **SQL Editor → New query**. Coller le contenu de
   [`supabase.sql`](supabase.sql), **remplacer `CHANGE-MOI` par le code d'accès
   choisi**, puis *Run*.
3. **Project Settings → API** : copier la *Project URL* et la clé
   *anon public* (ou *publishable*) dans [`config.js`](config.js), puis pousser.
4. Sur chaque téléphone, l'appli demande le code d'accès une seule fois.

Le dépôt est public : l'adresse et la clé de `config.js` le sont aussi, et ce
n'est pas grave — elles ne disent que *où* est la base. Sans le code d'accès,
la base paraît vide et refuse toute écriture. Ce code n'est écrit nulle part
dans le dépôt ; ne le partager qu'avec les encadrants.

Les données déjà saisies sur un téléphone avant la mise en route partent dans
la base à la première connexion de ce téléphone ; une assise saisie des deux
côtés (même groupe, même date) se recolle en une seule.

### Sauvegardes

*Réglages → Exporter (JSON)* garde un fichier de côté ; *Importer → Fusionner*
le remet. L'export CSV des présences s'ouvre dans Excel ou LibreOffice.

## Les dars modèles

Avec la base partagée, un dars créé dans l'appli est visible de tous. Le fichier
`data/dars-partages.json` sert en plus à livrer des dars **modèles** avec le
site (lecture seule). Sans base partagée, c'est le seul moyen de partager un
dars :

1. *Dars → Exporter pour partage* : on obtient un `dars-partages.json`.
2. Déposer son contenu dans `data/dars-partages.json` du dépôt et pousser.
3. Au chargement suivant, le dars apparaît chez tous, marqué **partagé**
   (lecture seule : il se modifie dans le dépôt, pas dans l'application).

## Faire tourner en local

Un simple double-clic sur `index.html` suffit pour tout sauf les dars partagés
(`fetch` est bloqué sur `file://`). Pour tout avoir :

```bash
python -m http.server 8000
# puis http://localhost:8000
```

## Structure

```
index.html   coquille, navigation du bas, fenêtres
styles.css   thème clair/sombre, mobile d'abord, feuille d'appel imprimable
app.js       données, partage, vues et événements — un seul fichier, sans dépendance
config.js    adresse de la base partagée (vide = chaque téléphone pour soi)
supabase.sql la table et le code d'accès, à lancer une fois dans Supabase
data/dars-partages.json   les dars communs, versionnés dans le dépôt
```

Les listes de jeunes ne sont **pas** versionnées (`.gitignore`) : le dépôt est
public. Elles vivent dans la base partagée, protégée par le code d'accès.
