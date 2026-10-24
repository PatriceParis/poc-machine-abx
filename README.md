# Machine à leads ABX

Tableau de bord de la machine GTM Engine pour un client : cockpit, comptes, signaux, contacts et grille de scoring, lus en direct dans la base Postgres du client (Neon, région Francfort). Premier tenant : Hirondo.

Le calcul ne vit pas ici. Le schéma, les vues de score (`score_comptes`, `signaux_actifs`, `comptes_a_notifier`), la grille du client et l'import de la base de ciblage sont dans la machine (`gtm-engine/abx-system/machine`, configuration dans `clients/<client>/machine/config.sql`). Cette application lit ces vues et reçoit les événements.

## Pages

Cockpit (chiffres, matrice adéquation par engagement, flux des sources, comptes par score), Comptes (filtres par palier, engagement et activité, fiche par compte), Signaux (chronologie des déclencheurs et intentions), Contacts, Grille (lecture seule). Accès par mot de passe (`DASHBOARD_PASSWORD`).

## Réception

- `GET /t.js` : script de suivi à poser sur le site, sans cookie : `<script async src="https://<domaine>/t.js"></script>`.
- `POST /api/visite` : une page vue. Le réseau d'origine est lu dans IPinfo Lite, rapproché des comptes par domaine puis par nom ; l'adresse IP n'est conservée que sous forme d'empreinte. Ajoute `visite_site`, `visite_page_cle` et `visites_repetees`.
- `POST /api/webhook/<source>?cle=<WEBHOOK_SECRET>` : `brevo`, `reachmcp`, `test`, `linkedin`, `apify`. Rangé brut dans `evenements_bruts`, interprété une fois le format réel connu.

## Variables

Voir `.env.example`. Les fonctions tournent à Francfort (`vercel.json`). Aucune donnée client dans ce dépôt : la base de ciblage s'importe depuis la machine.
