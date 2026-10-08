# Aeonis — Chroniques des mondes (V2)

God game / simulateur de mondes et de civilisations pour **Android** (et navigateur), 100 % hors‑ligne.
Monde procédural, habitants individuels avec familles et génétique, cultures, religions, royaumes,
empires, diplomatie, guerres, économie, routes commerciales, technologies de la préhistoire à l’ère
spatiale, écosystème, climat, catastrophes et pouvoirs divins. Tous les graphismes et sons sont
générés procéduralement (aucun asset propriétaire).

## Choix du moteur

Le dépôt était vide. Unity ne peut être ni installé ni licencié dans l’environnement de développement
(conteneur Linux headless), un projet Unity n’y aurait donc été ni compilable ni testable.
Le jeu est construit en **TypeScript + Canvas 2D** (rendu hybride 2D/pseudo‑3D) empaqueté en
application Android native avec **Capacitor** (WebView Chrome accélérée GPU). Avantages :
build Android reproductible (Gradle), tests automatisés de la simulation sous Node, test réel du jeu
dans Chromium, APK léger (~5 Mo). Le code ne contient pas de bibliothèques natives : l’APK tourne sur
toutes les architectures (ARM64 compris). IL2CPP est spécifique à Unity et n’a pas d’équivalent ici.

## Commandes

```bash
npm install
npm run dev            # jeu dans le navigateur (http://localhost:5173)
npm test               # tests de simulation (TEST 1 à 13 + longue durée 250 ans)
npm run test:long      # simulation longue : 3 mondes × 600 ans
npm run build:debug && npm run smoke   # test end-to-end dans Chromium (captures dans test-output/)
npm run assets         # régénère icône, mipmaps et splash
npm run android:debug  # APK debug  -> android/app/build/outputs/apk/debug/app-debug.apk
./scripts/make-keystore.sh             # une seule fois : clé de signature release (à conserver !)
npm run android:release # APK + AAB signés -> android/app/build/outputs/{apk,bundle}/release/
```

Prérequis Android : JDK 21, Android SDK 35 (`ANDROID_HOME` ou `android/local.properties`).
La CI GitHub (`.github/workflows/android.yml`) teste et produit l’APK debug à chaque push ; elle produit
aussi l’APK/AAB release si les secrets `ANDROID_KEYSTORE_B64` et `ANDROID_KEY_PASSWORD` sont définis.

Outils de développement : `npx vite-node scripts/sim-bench.ts -- 300 256 42` (benchmark + chronique),
`node scripts/profile.mjs 20 250` (profil CPU), `npx vite-node scripts/preview-map.ts -- out 42 320`.

## Architecture

```
src/
  core/        RNG à graine, bruit simplex, langues procédurales, hash spatial, bus d’événements
  data/        données (biomes, espèces, traits, métiers, technologies, bâtiments, animaux) — extensibles
  world/       carte en tableaux typés + chunks versionnés, générateur, classification, pathfinding A*
  sim/         simulation par ticks :
               world (état), simulation (ordonnanceur), population, person (génétique), settlement
               (économie, construction, territoire, colons), kingdom (politique), culture, diplomacy,
               war, trade, tech, ecosystem, climate, disasters, events, history, space, powers,
               modes, quests, setup
  save/        sérialisation versionnée + migrations, gzip, IndexedDB multi‑slots, progression hors‑ligne
  render/      caméra, terrain par chunks (cache LRU), calques/filtres, bâtiments 3D, entités, effets, météo
  input/       gestes tactiles (pan inertiel, pinch, double‑tap, appui long, pinceau)
  audio/       musique générative, effets et ambiances synthétisés (bus musique/effets/ambiance)
  ui/          HUD, roue des pouvoirs, panneaux, menus (DOM, tactile)
  platform/    Capacitor : haptique, bouton retour, pause/reprise
  debug/       overlay de debug (inclus seulement dans les builds debug)
  game.ts      contrôleur : boucle, budget CPU, sauvegardes, pouvoirs, sélection
```

### Simulation
* **Ticks** : 1 tick = 1 jour, mois = 10 jours, an = 120 jours. Comportements individuels chaque tick,
  économie/vie/politique mensuelles étalées sur les 10 jours par identifiant, statistiques annuelles.
* **LOD de simulation** : près de la caméra mise à jour à chaque tick, à distance moyenne 1 tick sur 3,
  au loin 1 sur 12 sans déplacement fin ; au‑delà du plafond d’individus, la population devient
  **agrégée** (statistique) par ville. Le monde entier continue de vivre.
* **Budget CPU** : la boucle simule autant de ticks que possible dans ~11 ms par image, sans jamais geler
  le rendu (vitesse effective réduite et signalée ⚠️ si saturée).
* **Pathfinding** : A* en tableaux typés, file de requêtes avec budget par tick, cache LRU invalidé
  quand le terrain change ; les habitants se déplacent localement par pilotage simple.

### Sauvegardes
Format JSON versionné (`SAVE_VERSION`), compressé gzip, stocké dans IndexedDB (plusieurs mondes,
planètes colonisées rattachées à leur monde d’origine). `src/save/migrations.ts` définit les règles de
compatibilité : une V3 ajoute une étape de migration, jamais de suppression silencieuse. Les champs ajoutés
reçoivent automatiquement leur valeur par défaut. Une sauvegarde d’une version plus récente est refusée
proprement. Sauvegarde automatique (réglable), à la mise en arrière‑plan et à la fermeture.

### Hors‑ligne
Aucune connexion requise. Au retour, le temps écoulé est simulé (1 an par 3 minutes d’absence, 100 ans
max) puis l’écran « Pendant votre absence… » résume les événements majeurs.

## Modes
Bac à sable, Survie, Apocalypse, Civilisation, Chaos, Scénarios (5), Évolution, Infini, Éditeur de monde.

## Renommer le jeu
Nom et identifiant : `capacitor.config.json`, `android/app/build.gradle` (applicationId),
`android/app/src/main/res/values/strings.xml`, `index.html`, `src/ui/menus.ts`.
