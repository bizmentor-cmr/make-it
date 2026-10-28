# Worklog — Make It + Make it Studio

Ce journal conserve les points de reprise et les changements réversibles du workspace.

> **État du dépôt :** aucun dossier Git (`.git`) n’est présent à la racine. Il n’existe donc pas de commit permettant un retour automatique. Chaque entrée ci-dessous liste les fichiers modifiés et les éléments à annuler pour revenir au checkpoint précédent. Ajouter les diffs détaillés ici à chaque nouvelle étape.

## Checkpoint W-2026-10-07-01 — intégration de lancement, authentification et rebranding Studio

**État conservé avant la prochaine intégration interne :** les deux applications sont distinctes; Make It est à la racine et le Studio est sous `Mak-it-studio/`.

### Changements déjà présents au checkpoint

- Lancement conjoint : script racine `dev:all`, Studio sur le port 3001, Make It sur 3000.
- Entrée de navigation Studio dans `src/components/layout/Sidebar.tsx`, qui ouvrait jusque-là le Studio dans un nouvel onglet.
- Auth Make It : client Prisma généré, base initialisée et URL SQLite dans `.env` corrigée vers `file:./prisma/dev.db`. Le compte de démo utilisé pour tester était `demo@makeit.app` / `makeit`.
- Rebranding Make-it Studio : titres de pages, métadonnées, header et textes du Studio remplacés par « Make it Studio »; marque Desktop/Electron, favicon et bundle Vite mis à jour; README et documents réécrits; identifiants locaux desktop/paquet renommés.
- `packages/studio` a été reconstruit. Le bundle Vite a été reconstruit. `npm run build` Next a compilé le code mais a échoué ensuite sur des erreurs ESLint existantes de `setState` dans des effets de `components/StandaloneShell.js`.
- Les tests Electron locaux exécutés alors (chemins/ressources) ont passé.

### Fichiers notables déjà modifiés avant ce point

- Racine : `.env`, `AGENTS.md`, `package.json`.
- App principale : `src/components/layout/Sidebar.tsx` et changements d’auth/Prisma.
- Studio : `Mak-it-studio/app/**`, `components/ApiKeyModal.js`, `components/StandaloneShell.js`, `electron/**`, `build/**`, `scripts/package-linux-deb.js`, `src/lib/i18n.js`, `packages/studio/src/components/**`, `packages/studio/package.json`, `packages/Vibe-Workflow/**`, `README.md`, `project_knowledge.md`, `LICENSE`, `index.html`, `public/make-it-studio.svg`, `docker-compose.yml`, `tests/localInferenceAssets.test.js`.

### Retour à ce checkpoint

Pour annuler uniquement l’étape suivante (vue interne), restaurer les fichiers indiqués dans l’entrée W-2026-10-07-02. Ne pas annuler les corrections Prisma ni le rebranding Studio. Avant un changement ultérieur, ajouter ici le contenu précédent des petits fichiers modifiés et les commandes/tests effectués.

## Checkpoint W-2026-10-07-02 — vue Studio intégrée dans Make It

**Statut :** implémenté et vérifié statiquement.

**But :** remplacer l’ouverture en nouvel onglet par une section interne à l’application principale qui affiche le Studio dans sa propre zone, tout en gardant les deux apps séparées et en utilisant l’URL configurable `NEXT_PUBLIC_STUDIO_URL` (valeur locale par défaut `http://localhost:3001`).

**Plan de retour arrière :** rétablir les versions précédentes de `src/components/layout/Sidebar.tsx`, `src/store/app-store.ts`, `src/app/page.tsx` et supprimer la nouvelle page de section Studio si elle est créée. La route Studio et le démarrage conjoint ne doivent pas être supprimés.

**Fichiers modifiés pour cette étape :**

- `src/store/app-store.ts` — nouvelle clé de section `studio`.
- `src/components/layout/Sidebar.tsx` — le bouton devient une navigation intégrée, conserve l’état actif et ne fait plus de `window.open`.
- `src/app/page.tsx` — rend la section Studio à l’intérieur de l’AppShell.
- `src/components/layout/AppShell.tsx` — alloue la hauteur/largeur de la fenêtre à l’iframe et masque le pied de page dans cette section.
- `src/components/sections/StudioSection.tsx` — nouvelle vue intégrée qui embarque `/studio/image` depuis `NEXT_PUBLIC_STUDIO_URL` (par défaut `http://localhost:3001`), avec boutons recharger et ouvrir séparément.

**Retour arrière exact :** dans `Sidebar.tsx`, rétablir le bouton précédent qui lisait `NEXT_PUBLIC_STUDIO_URL` puis appelait `window.open(..., "_blank", ...)`; retirer `studio` de `SectionKey`; retirer l’import et le rendu conditionnel Studio de `src/app/page.tsx`; retirer de `AppShell.tsx` la variable `isStudioSection` et ses classes conditionnelles; supprimer `src/components/sections/StudioSection.tsx`.

**Serveurs :** arrêtés avant modification; ports 3000 et 3001 vérifiés sans écoute. Le build Next précédent avait été lancé pendant que `dev:all` était actif; cela explique probablement l’erreur ENOENT `Mak-it-studio/.next/routes-manifest.json` observée dans le terminal. Le Studio a été arrêté avant la prochaine validation pour éviter de modifier `.next` pendant l’exécution du serveur.

**Validation :** ESLint ciblé sur les cinq fichiers racine touchés sans erreur; vérification TypeScript sans erreur sur ces fichiers via le panneau de problèmes. `npx tsc --noEmit` global reste en échec sur quatre erreurs préexistantes dans `src/app/api/video-projects/[id]/render/route.ts`, `src/app/api/video-projects/route.ts`, `src/components/sections/CreateSection.tsx` et `src/components/shared/GenerationProgress.tsx`; aucune ne concerne la vue Studio. Les serveurs restent arrêtés conformément à la demande.

**Note d’intégration :** l’iframe est visuellement intégrée dans Make It, mais le sous-projet reste servi par `NEXT_PUBLIC_STUDIO_URL` (défaut localhost:3001), conformément à la séparation des applications. Le stockage local et la clé MuAPI saisis dans le Studio restent propres à son origine; aucune fusion ou partage d’identité n’a été introduit.

## Checkpoint W-2026-10-07-03 — correction des avertissements VS Code orange

**Demande :** vérifier les éléments orange dans l’explorateur et corriger ceux qui signalent une erreur réelle.

**Correction :** retiré `compilerOptions.baseUrl` des fichiers `Mak-it-studio/jsconfig.json`, `Mak-it-studio/packages/Vibe-Workflow/client/jsconfig.json` et `Mak-it-studio/packages/Open-Poe-AI/client/jsconfig.json`. Le TypeScript présent dans l’éditeur signalait cette option comme dépréciée et la proposait comme unique problème des deux premiers fichiers; la même option était également présente dans la configuration du client Open-Poe-AI.

**Validation :** JSON valide pour les trois fichiers et aucun diagnostic restant dans tout `Mak-it-studio` selon la vérification VS Code. `index.html` n’avait aucune erreur. Les décorations orange sont les changements Git intentionnels du rebranding (métadonnées, titres, icône, docs); les sous-modules `Vibe-Workflow`, `Open-Poe-AI` et `Open-AI-Design-Agent` contiennent aussi les modifications attendues. Elles ne doivent pas être annulées sans demande.

**Retour arrière :** remettre `"baseUrl": ".",` dans les trois fichiers `jsconfig.json` si l’ancien comportement doit être restauré (non recommandé avec la version TypeScript de l’éditeur).

## Checkpoint W-2026-10-07-04 — lancement complet sans Bun

**Demande :** relire le journal, lancer les applications et services du workspace, puis corriger les blocages nécessaires.

**Blocage et correction :** Bun n’est pas installé sur cette machine, ce qui faisait échouer `npm run realtime`. Le service temps réel n’utilise que des annotations TypeScript effaçables; ses scripts `dev` et `start` utilisent maintenant le stripping TypeScript natif de Node.js 22.6+, et le script racine `realtime` le lance via npm. La documentation de lancement et les consignes reflètent désormais les commandes et la version de Node.js requises.

**Fichiers modifiés :** `package.json`, `mini-services/realtime-service/package.json`, `README.md`, `AGENTS.md`.

**Retour arrière :** rétablir `package.json` à `"realtime": "cd mini-services/realtime-service && bun run dev"`; rétablir les scripts `dev` et `start` du mini-service à `bun --hot index.ts` et `bun index.ts`; remettre les anciennes commandes de lancement dans `README.md` et `AGENTS.md`.

**Validation :** les deux manifests JSON sont valides. `npm run dev:all` démarre Make It (3000) et Studio (3001); les URL testées renvoient HTTP 200. `npm run realtime` démarre Socket.IO (3003) et l’API interne (3004); `/health` répond HTTP 200 et le handshake Socket.IO réussit. Les ports 3000, 3001, 3003 et 3004 restent à l’écoute. La compilation de développement des routes Make It et Studio testées a réussi.

**État au checkpoint :** les trois processus de développement restent lancés dans les terminaux de cette session. Les builds de production, Electron et opérations de base de données (notamment `db:push`, qui autorise la perte de données) ne sont pas lancés par cette tâche de démarrage.

## Checkpoint W-2026-10-07-05 — redémarrage complet et correction des erreurs TypeScript

**Demande :** relire le worklog, exécuter et lancer l'ensemble, puis corriger les blocages constatés.

**Démarrage et réparation :** les quatre ports répondaient initialement sauf la page Studio. Son ancien processus Next.js, démarré depuis environ 25 minutes, ne répondait plus et utilisait environ 3,8 Go de mémoire. Studio a été redémarré avec `npm --prefix Mak-it-studio run dev`. Le serveur racine Make It a ensuite également cessé de répondre et a été relancé avec `npx next dev -p 3000`. Le service realtime préexistant est resté en place. Les ports 3000, 3001, 3003 et 3004 répondent maintenant.

**Corrections :** les routes vidéo passaient `null` à la métadonnée optionnelle de `ok`; elles passent maintenant `undefined`. Le rendu JSX de `genOutput` vérifie explicitement `null`. Le champ `consumedCredits` final, fourni par le worker, est maintenant transmis jusqu'à l'événement realtime consommé par `GenerationProgress`.

**Fichiers modifiés :** `src/app/api/video-projects/[id]/render/route.ts`, `src/app/api/video-projects/route.ts`, `src/components/sections/CreateSection.tsx`, `src/lib/auth-context.tsx`, `src/lib/realtime-client.ts`, `src/server/core/ai-job.ts`, `src/server/core/realtime.ts`, `WORKLOG.md`.

**Validation :** `npx tsc --noEmit` passe. Les 17 tests sous `Mak-it-studio/tests` passent. Les quatre points de contrôle HTTP (Make It, Studio `/studio/image`, `/health` realtime et handshake Socket.IO) renvoient `200`. ESLint ciblé passe après exclusion des règles React déjà en erreur dans les fichiers touchés. Le lint global reste en échec sur des problèmes préexistants de hooks/refs; `Mak-it-studio` échoue notamment sur quatre `setState` synchrones dans `components/StandaloneShell.js`. Aucun build de production/Electron ni commande DB destructive n'a été lancé.

**Retour arrière :** rétablir `null` dans les deux appels `ok`, remettre la condition `genOutput && ...`; retirer `consumedCredits` des types/emissions de `src/lib/realtime-client.ts`, `src/lib/auth-context.tsx`, `src/server/core/realtime.ts` et `src/server/core/ai-job.ts`; retirer cette entrée du worklog. Les serveurs lancés sont des processus de développement et peuvent être arrêtés séparément.

**État au checkpoint :** Make It, Make-it Studio et le service realtime sont lancés. Les serveurs de développement restent actifs dans les terminaux de cette session. Les commandes `db:push`, `db:reset`, les builds de production et les artefacts Electron restent non exécutés.
