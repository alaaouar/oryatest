# @orya/web — console web ORYA

Console de la direction et du super-admin (Next.js 16, React 19). Elle appelle
l'API en **cross-origin** ; le CORS est configuré côté API par `CORS_ORIGINS`.
Aucune réécriture Next n'est utilisée (elle ne s'appliquait pas de façon fiable en
Next 16).

## Démarrage

```powershell
# 1. API (port libre : 3001 est souvent occupé par un autre projet)
cd ..\api
Copy-Item .env.example .env      # API_PORT=3010 dans cet exemple
npm run start:dev

# 2. Console
cd ..\web
Copy-Item .env.example .env.local
#   NEXT_PUBLIC_API_BASE="http://localhost:3010/api/v1"
npm install
npm run build                    # la valeur est figée au build
npm run dev                      # http://localhost:3000
```

`NEXT_PUBLIC_API_BASE` est **intégré au build** : modifiez-le avant `npm run build`,
pas après.

## Écrans livrés (Lot 1)

| Écran | Route | Contenu |
|---|---|---|
| Connexion | `/login` | e-mail + mot de passe, puis second facteur (enrôlement TOTP ou vérification) |
| Tableau de bord | `/dashboard` | profil actif, statut de l'établissement, état du second facteur, liste des accès |
| Écoles | `/schools` | **super-admin** : création, liste, validation (aucun déploiement) |
| Journal d'audit | `/audit` | **direction et super-admin** : 100 derniers événements |
| Attente de validation | `/pending` | établissement non validé : aucun écran de données, redirection automatique |

## Charte (CDC §14)

- marine `#0B2142`, teal `#1AA99A`, crème `#F7F4EE`, absence `#E05A4F`, retard `#D4A017` ;
- police **Inter** via `next/font` ;
- grille de 8 px (`--space-1` à `--space-5`), boutons de **48 px** minimum, arrondis 12/16 px ;
- le texte blanc n'est **jamais** posé sur le teal (contraste 2,9:1) : le bouton teal
  utilise du texte marine (5,5:1).

## Limites assumées

1. **Jetons en `sessionStorage`** : effacés à la fermeture de l'onglet, mais lisibles
   par un XSS. Cible : cookies `httpOnly` + BFF Next.
2. **Wordmark officiel absent** : le logo vectoriel ORYA (point teal dans le O) n'est
   pas encore livré ; l'en-tête affiche le nom en texte, sans substitut graphique.
3. **Pas encore d'écran** : invitations, élèves, appel, import Massar (lots suivants).

## Vérification

```powershell
npm run build
```

Le build doit produire les routes `/`, `/login`, `/dashboard`, `/schools`, `/audit`,
`/pending`.
