# ADR-003 - Appel hors ligne : PWA, file IndexedDB, synchronisation idempotente

**Date :** 15 novembre 2026
**Statut :** accepte (partie serveur livree en t87u-5 ; partie console livree en t89)
**Exigences couvertes :** CDC 2 (hors-ligne d'abord), F03 / B11 (appel hors ligne, file de synchronisation, conflits)

## Contexte

L'enseignant fait l'appel en classe, ou le reseau est souvent absent ou instable. Le CDC
exige que l'appel reste possible hors ligne, sans perte, avec une reprise automatique et
une regle de conflit explicite. Le modele avait deja prepare le terrain :
`AttendanceRow.clientMutationId` (UUID, unique) et `AttendanceSession.version` / `AttendanceRow.version`.

## Decision

### 1. Console en PWA (livree en t89)

- Service worker (portee `/attendance`) : met en cache la coquille de l'ecran d'appel et ses
  ressources statiques ; jamais les reponses d'API authentifiees (cookies httpOnly, donnees d'eleves).
- Liste de classe : copie locale minimale dans IndexedDB (identifiant, nom affiche, code eleve)
  pour les sessions du jour, purgee a la deconnexion et apres cloture.
- File de mutations dans IndexedDB : `{ clientMutationId (UUID v4 genere par l'appareil),
  sessionId, studentId, status, recordedAt (heure de l'appareil) }`. Chaque changement de
  statut ajoute une mutation ; rien n'est supprime avant l'accuse du serveur.
- Indicateur de synchronisation visible : "Hors ligne - n modifications en attente",
  "Synchronisation...", "A jour", "Appel cloture : n modifications non appliquees".
- Reprise : a l'evenement `online`, au retour au premier plan et toutes les 30 s tant que la
  file n'est pas vide ; envoi par lots de 200 au plus.
- Ouverture d'une session hors ligne : l'appareil garde la demande ; a la reconnexion il ouvre
  la session (`POST attendance/sessions`) ou, si elle existe deja (409), la retrouve
  (`GET attendance/sessions?classroomId&date&slot`) puis rejoue la file.
  **Non livre en t89** : la session doit avoir ete ouverte une fois en ligne (liste de classe en copie locale) ;
  l'ouverture d'une nouvelle session sans reseau reste a faire.

Realisation t89 : `apps/web/public/sw-attendance.js` (reseau d'abord, cache en secours, uniquement
`/_next/` et `/attendance` de meme origine, jamais l'API ni une requete autre que GET),
`apps/web/lib/offline-attendance.ts` (IndexedDB `orya-offline` : `snapshots` et `queue`, synchronisation par lots),
ecran `attendance/[sessionId]` (indicateur `data-testid=sync-indicator`, notices stale / rejected / closed).
La copie du profil de l'onglet (`sessionStorage`, sans jeton) permet le rechargement de l'ecran sans reseau.
A la deconnexion, les copies de listes et la coquille sont purgees ; la file (identifiants et statuts, sans nom)
est conservee pour ne perdre aucune saisie et n'est rejouee qu'avec une session valide (RLS, affectation).

### 2. Synchronisation idempotente cote serveur (livree)

`POST /api/v1/attendance/sessions/:id/sync`, corps `{ mutations: [{ clientMutationId, studentId,
status, recordedAt }] }` (1 a 200), memes roles, MFA, RLS et controle d'affectation que la
saisie en ligne. Reponse 200 `{ sessionStatus, version, results: [{ clientMutationId, studentId,
result, status }] }`, un resultat par mutation :

| Resultat | Regle |
|---|---|
| `closed` | session cloturee : **le serveur gagne**, rien n'est ecrit ; pas de 409 pour que l'appareil purge sa file et affiche les modifications non appliquees |
| `duplicate` | `clientMutationId` deja present sur la meme ligne (rejeu) : aucun effet, version inchangee |
| `rejected` | identifiant deja present sur une autre ligne, ou eleve non inscrit dans la classe |
| `stale` | session ouverte, **dernier ecrit gagne** sur l'heure de saisie : mutation plus ancienne que la ligne en base, ignoree |
| `applied` | ecrite ; `recordedAt` = heure de l'appareil bornee a l'heure serveur (jamais dans le futur) |

Les mutations d'un lot sont traitees par heure croissante. Chaque appel est audite
(`attendance.rows.synced` : compteurs par resultat et changements, sans donnee personnelle
supplementaire). Les regles pures sont dans `attendance/attendance-rules.ts`
(`effectiveClientTime`, `syncDecision`).

### 3. Limite assumee

Sans journal des mutations, la deduplication par identifiant porte sur la **derniere**
mutation de chaque ligne. Une ancienne mutation rejouee sur la meme ligne reste sans effet
(regle du dernier ecrit : `stale`) ; en revanche un identifiant ancien reutilise sur un autre
eleve n'est pas detecte (cas d'un appareil defaillant, sans enjeu de securite : RLS et
affectation s'appliquent toujours). Si une idempotence stricte par identifiant devient
necessaire, ajouter une table `AttendanceMutation` (identifiant client en cle, RLS par ecole).

## Consequences

- Le serveur reste la source de verite ; la cloture fige l'appel (la reouverture par la
  direction reste la seule voie de correction apres cloture).
- L'horloge de l'appareil compte dans l'arbitrage ; elle ne peut pas avancer au-dela de
  l'heure serveur.
- Tests : API SYNC-1 a SYNC-11 (`test/api/run-api-tests.ps1`), unitaires
  (`test/unit/attendance-rules.test.ts`), E2E Playwright `e2e/tests/13-appel-hors-ligne.spec.ts` (t89) :
  saisie sans reseau, rechargement sans reseau, reconnexion et file videe, indicateur, resultats
  `stale`, `rejected` et `closed` affiches.