/* Base partagée (Supabase). Tant que ces deux valeurs sont vides, l'outil
   fonctionne seul sur chaque appareil, comme avant. Une fois remplies, tout
   le monde voit les mêmes groupes, jeunes, assises et dars.

   Ces deux valeurs ne sont pas secrètes : elles disent seulement où est la
   base. Ce qui protège les données, c'est le code d'accès choisi dans
   supabase.sql, demandé une fois sur chaque appareil et jamais écrit ici.
   Voir le README, section « Partager les données ». */
window.EJ_CONFIG = {
  supabaseUrl: '',   // ex. 'https://abcdefgh.supabase.co'
  supabaseKey: ''    // la clé « anon public » (Project Settings → API)
};
