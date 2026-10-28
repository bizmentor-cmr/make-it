# AGENTS.md

Ce dépôt contient deux applications distinctes dans le même workspace :

- le projet principal Make It à la racine du dépôt
- le sous-projet Make-it Studio dans [Mak-it-studio](Mak-it-studio)

Les deux doivent être traitées comme des apps séparées sauf si l’utilisateur demande explicitement une intégration ou un pont fonctionnel entre elles.

## 1) Vue d’ensemble du dépôt

- App principale : [README.md](README.md)
- Sous-projet Studio : [Mak-it-studio/README.md](Mak-it-studio/README.md)
- App racine : Next.js + TypeScript + Tailwind + Prisma + NextAuth
- Sous-projet Studio : Next.js / Vite + Electron + packages internes (studio, workflow-builder, agents, design-agent)

## 2) Règles de travail pour les agents

### 2.1 Priorité du contexte

- Si la tâche concerne l’app racine, modifier uniquement les fichiers sous [src](src), [app](src/app), [components](src/components), [lib](src/lib), [server](src/server), [store](src/store), [prisma](prisma), etc.
- Si la tâche concerne le Studio, modifier uniquement les fichiers sous [Mak-it-studio](Mak-it-studio) et surtout les dossiers de composants/packages du sous-projet.
- Ne pas déplacer du code entre les deux apps sans demande explicite.
- Si une fonctionnalité doit traverser les deux apps, créer un point d’intégration clair (route, composant, proxy, scripts, etc.) plutôt que de coupler les projets de façon implicite.

### 2.2 Conventions principales

- Le code racine suit l’App Router de Next.js 16.
- Le styling est géré par Tailwind CSS 4 et shadcn/ui.
- L’état global principal est géré par Zustand dans [src/store/app-store.ts](src/store/app-store.ts).
- Les données et l’auth sont centrées sur Prisma + NextAuth.
- Les appels API doivent rester cohérents avec la structure de l’app ; respecter les helpers dans [src/lib/api-client.ts](src/lib/api-client.ts).
- Les composants UI doivent rester réutilisables et ne pas dépendre des implémentations de l’autre app.

## 3) Commandes de développement

### App principale

```bash
cd "c:/Users/user/Desktop/Projet/make-it"

# install
bun install
# ou npm install

# dev
bun run dev
# ou npm run dev

# build
bun run build

# DB
bun run db:push
bun run db:seed

# realtime service
npm run realtime
```

Le serveur principal est attendu sur :

- http://localhost:3000
- http://localhost:3001 pour Make-it Studio via `npm run dev:all`

Le service temps réel est généralement exposé sur les ports 3003 / 3004 via le mini-service [mini-services/realtime-service](mini-services/realtime-service).
Il se lance avec Node.js 22.6+ et `npm run realtime`.

### Sous-projet Studio

```bash
cd "c:/Users/user/Desktop/Projet/make-it/Mak-it-studio"

npm install
npm run dev
```

Le sous-projet peut être lancé à part avec les scripts Next.js / Vite / Electron selon le besoin exact. Vérifier [Mak-it-studio/package.json](Mak-it-studio/package.json) avant de modifier des scripts ou des commandes de lancement.

## 4) Architecture de projet à retenir

### App principale (racine)

- [src/app](src/app) : pages et routes App Router
- [src/components](src/components) : composants UI et sections métier
- [src/store](src/store) : store Zustand
- [src/lib](src/lib) : clients, utils, helpers, auth, colors
- [prisma](prisma) : schéma et seed
- [mini-services](mini-services) : services annexes (temps réel)

### Sous-projet Studio

- [Mak-it-studio/src](Mak-it-studio/src) : code principal de l’interface
- [Mak-it-studio/packages](Mak-it-studio/packages) : packages internes du studio
- [Mak-it-studio/electron](Mak-it-studio/electron) : Electron app
- [Mak-it-studio/public](Mak-it-studio/public) : assets

## 5) Bonnes pratiques spécifiques

- Écrire du code lisible et explicite ; ce dépôt contient un produit SaaS complexe avec plusieurs sections métier.
- Favoriser des changements centrés sur un seul domaine fonctionnel.
- Avant de créer des fichiers de configuration, vérifier si un workflow déjà existant est présent dans le dépôt.
- Les noms de branches, PR et commits ne sont pas imposés par le code, mais les changements doivent rester cohérents avec la structure actuelle.
- En cas de doute sur l’app concernée, demander confirmation avant d’éditer un fichier dans l’autre app.

## 6) Points de vigilance connus

- Les deux apps sont distinctes et ne partagent pas un framework unifié.
- Le projet racine utilise Bun pour beaucoup de tâches de dev/local ; le sous-projet utilise npm dans sa configuration actuelle.
- Les ports peuvent cohabiter, mais la logique de lancement doit rester explicite.
- Les intégrations cross-app doivent être documentées et limitées à un point d’entrée unique.

## 7) Quand créer une intégration entre les apps

Un pont entre les apps n’est pertinent que si l’utilisateur demande explicitement :

- ouvrir le Studio depuis le menu principal de Make It,
- fédérer le shell global et l’interface Studio,
- ou lancer la fusion des deux applications sous un seul point d’entrée local.

Dans ce cas, privilégier :

1. un lien claire dans le menu / sidebar,
2. un handler de navigation ou redirection explicite,
3. des scripts de lancement distincts pour chaque app, sans casser les flows existants.

## 8) Recommandation générale pour l’IA

Pour un agent coding assistant, le bon comportement est de :

- rester dans le contexte de la partie du dépôt demandée,
- ne pas “fusionner” arbitrairement les deux apps,
- respecter les conventions du framework déjà utilisé,
- documenter les changements de manière concise,
- tester les commandes pertinentes à chaque modification.

---

Cette fiche doit aider un agent à être productif immédiatement sans avoir à relire tout le repo. Pour plus de détails, consulter les documents de référence : [README.md](README.md) et [Mak-it-studio/README.md](Mak-it-studio/README.md).

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
