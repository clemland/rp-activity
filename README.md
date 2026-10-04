# Activity : fiche, boutique, navigation

Le site affiché dans Discord, et son API (dossier `api/`, fonctions Vercel).

- `shared/game.js` : toutes les règles du jeu (utilisées par l'API et par le mode démo)
- `api/` : `token` (connexion Discord), `state` (chargement), `action` (actions des joueurs), `staff` (outils MJ), `bot` (appels du bot)
- `src/` : l'interface

```bash
npm install
npm run dev     # mode démo hors Discord
npm test
npm run build
```

Le guide de mise en place complet est dans le README à la racine du projet.
