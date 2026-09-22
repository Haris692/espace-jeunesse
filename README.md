# Espace Jeunesse

Outil de suivi pour les deux groupes jeunesse : l'appel des assises, le suivi de
chaque jeune, et la bibliothèque des dars. Page web simple, sans serveur, qui
marche sur téléphone comme sur ordinateur.

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
| **Accueil** | Effectifs, taux de présence des 8 dernières assises, et la liste des jeunes à rappeler (3 absences de suite, ou moins de 50 % de présence). |
| **Appel** | La feuille d'appel : date, thème du jour, puis un appui par jeune — Présent / Retard / Excusé / Absent. Enregistré au fur et à mesure. Un bouton permet d'inscrire sur place un jeune qui vient pour la première fois. |
| **Groupes** | Le groupe et son encadrant, la liste des jeunes avec leur assiduité, et la fiche individuelle (contacts, historique, notes de suivi). |
| **Dars** | Les supports d'assise : objectif, plan, texte arabe, Coran et hadith, références, lien vers un PDF. Recherche plein texte. |

## Inscrire les jeunes

Deux chemins, depuis l'accueil, l'appel ou la fiche du groupe :

- **Ajouter des jeunes** — on colle la liste, un par ligne. `Yassin B., 4ème`
  donne prénom, nom et classe ; une ligne avec juste `Anas` marche aussi.
- **Un seul, en détail** — le formulaire complet : contacts, date d'arrivée,
  et le cas d'un jeune qui ne vient plus.

## Où vivent les données

Dans le navigateur de chaque encadrant (`localStorage`), et nulle part ailleurs.
Rien ne part sur un serveur — ce qui est voulu vu ce qu'on note sur des mineurs,
mais qui a deux conséquences à connaître :

1. **Les données ne se synchronisent pas** entre Adel, Amine et le référent.
   Chacun tient son groupe sur son téléphone. Pour regrouper : *Réglages →
   Exporter (JSON)*, puis chez le référent *Importer → **Fusionner***, qui
   ajoute ce qui manque sans écraser l'autre groupe. Réimporter deux fois le
   même fichier ne crée pas de doublon, et une assise déjà saisie des deux
   côtés (même groupe, même date) se recolle en une seule.
2. **Vider les données du navigateur efface tout.** Exporter de temps en temps.

L'export CSV des présences s'ouvre directement dans Excel ou LibreOffice.

## Partager un dars aux deux encadrants

Les dars créés dans l'application restent locaux, comme le reste. Pour qu'un
dars soit visible par tout le monde :

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
index.html   coquille, onglets, modale
styles.css   thème clair/sombre, mobile d'abord, feuille d'appel imprimable
app.js       données, vues et événements — un seul fichier, sans dépendance
data/dars-partages.json   les dars communs, versionnés dans le dépôt
```

## Si le besoin de synchronisation devient réel

Le format de données est un seul objet JSON (`groupes`, `membres`, `assises`,
`dars`). Le jour où il faut du vrai partage en temps réel, on remplace les deux
fonctions `charger()` et `sauver()` de `app.js` par des appels à un Supabase ou
un Firebase — le reste de l'application ne bouge pas. C'est le seul endroit qui
touche au stockage.
