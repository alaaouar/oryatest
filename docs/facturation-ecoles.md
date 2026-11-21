# Facturation des écoles (bloc 5, Avenant n°1)

**Principe.** L'école collecte 120 DH TTC par enfant et par an auprès des familles, puis paie ORYA en **un seul virement bancaire annuel**. Il n'y a **aucun paiement en ligne des parents** et **aucun prestataire de paiement** (PSP). `NotConfiguredBillingProvider` reste le seul fournisseur.

## Contrat
- Un contrat par école (`SchoolContract`, référence `CTR-<code école>`), créé ou modifié par le super-admin avec MFA. Chaque changement est audité (`billing.contract.created` / `billing.contract.updated`, avec l'avant et l'après).
- Le prix par enfant est paramétrable : 100,00 DH HT par défaut (`unitPriceHtMinor = 10000`), TVA 20 % (`vatRateBp = 2000`), soit 120,00 DH TTC (calculé, jamais saisi).
- Durées paramétrables : fin d'essai (`trialEndsOn`), délai de paiement (`paymentTermDays`, 30 j par défaut) et préavis avant suspension (`noticeDays`, 15 j par défaut).

## Règle de comptage des enfants facturés
Un élève est facturé s'il a une inscription (`Enrollment`) pour l'année scolaire **et** qu'il est **actif à la date de référence** :

`(startsOn absent OU startsOn <= référence) ET (endsOn absent OU endsOn > référence)`

- La date de référence est le 31 octobre par défaut (`referenceMonthDay = "10-31"`, paramétrable par contrat), ou une date explicite comprise dans l'année scolaire (du 1er septembre au 31 août).
- Un élève inscrit avant la référence ou le jour même est compté. Un élève sorti après la référence est compté, car l'année est due.
- Un élève sorti avant la référence, ou le jour même, n'est pas compté.
- Un élève arrivé après la référence n'est pas compté sur la facture annuelle ; il est facturé par une **facture complémentaire**.
- Un élève sans inscription pour cette année n'est pas compté.
- Les identifiants des élèves comptés (sans nom) sont figés sur la facture (`countedStudentIds`).
- Les dates d'entrée et de sortie sont saisies par la direction (`PATCH billing/school/enrollments/:studentId`, audité).
- Tests : BLOC5 C1-C3 et F1 (inscrit, parti avant, parti après, arrivé après, arrivé le jour J, parti le jour J, non inscrit).

Implémentation : `isActiveAt` dans `apps/api/src/school-billing/billing-rules.ts`.

## Documents
- **Facture annuelle** : une seule par école et par année scolaire (`annualKey` unique). Un doublon, même concurrent, renvoie 409.
- **Facture complémentaire** : pour les élèves devenus actifs après la référence et pas encore facturés.
- **Avoir** : série distincte `AV`, rattaché à la facture annuelle, dans la limite des quantités nettes facturées.
- **Numérotation** : `ORYA-<FA|AV>-<année>-<000001>`, continue et sans trou par série et par année civile d'émission. Le compteur `InvoiceSequence` est incrémenté **dans la même transaction** que l'insertion. Une tentative échouée annule tout, numéro compris (DB B5DB4-B5DB7, BLOC5 F5 : 8 émissions concurrentes, 3 doublons refusés, compteur = nombre = maximum).
- **Immuabilité** : les déclencheurs PostgreSQL refusent tout UPDATE ou DELETE d'un document émis ou d'un rapprochement, même par le propriétaire de la base (DB B5DB2-B5DB3, BLOC5 X6). On corrige toujours par un avoir.
- Le PDF est généré à la demande à partir du document immuable.

## Rapprochement et statuts
- Le rapprochement manuel d'un virement reçu est réservé au **super-admin avec MFA**. Il est audité en `critical` et ne peut jamais être modifié. Le montant ne peut pas dépasser le solde dû, et la date ne peut pas être dans le futur.
- Statuts dérivés, jamais saisis à la main :
  - **essai** : aucun document émis.
  - **payé** : solde inférieur ou égal à 0.
  - **facturé** : l'échéance la plus ancienne encore due n'est pas dépassée.
  - **en retard** : de l'échéance + 1 jour à l'échéance + préavis.
  - **suspendu** : au-delà du préavis.
- Échéance = date d'émission (ou fin d'essai si elle est postérieure) + délai de paiement.
- Évaluation par le job `SchoolBillingJob` (toutes les 6 h) ou par `POST admin/billing/evaluate`. Une date simulée (`asOf`) n'est acceptée que hors production.

## Suspension
- La suspension passe l'école en **lecture seule** (`Subscription.status = suspended`, intercepteur `SUBSCRIPTION_INACTIVE`). Elle ne supprime et ne masque **jamais** de données (BLOC5 S3, S5, S19).
- La suspension ne bloque jamais les actions suivantes (liste fermée `isSuspensionExempt`, `subscription.interceptor.ts`) :
  - sécurité : connexion, MFA, rafraîchissement, déconnexion, révocation de session (S10, S11, S12, S18) ;
  - export des données (S13) ;
  - retrait d'un consentement par le parent ou par l'école (S14, S15) ;
  - suppression de compte, du sien ou de celui d'un enfant (S16, S17) ;
  - demandes de rectification ou d'opposition.
- Aucune route de changement de mot de passe n'existe aujourd'hui dans l'API ; ce cas n'est donc pas testé.
- Les écritures ordinaires restent refusées en 403 (S4, S19). Le rapprochement du virement rétablit le statut « payé » et l'écriture (S6).

## Identité légale ORYA
Le dépôt ne contient **aucun identifiant réel** (ICE, IF, RC, RIB). Les valeurs viennent de `BILLING_ISSUER_NAME`, `_ADDRESS`, `_ICE`, `_IF`, `_RC`, `_RIB` et `_BANK`, avec des valeurs par défaut **FICTIVES** (« EXEMPLE FICTIF », zéros). En production, l'émission est refusée tant qu'une valeur fictive subsiste.

## Export comptable
`GET admin/billing/export.csv?from=&to=` (super-admin + MFA, audité) : UTF-8 avec BOM, séparateur `;`, montants `120,00`, avoirs en négatif, formules neutralisées.

## Écrans
- Direction : /billing, section « Facturation ORYA », en lecture seule. Elle affiche le contrat, le statut, le prix, le solde, les factures et avoirs avec leur PDF, et les instructions de virement (valeurs FICTIVES). Aucun bouton de paiement.
- Super-admin : /facturation-ecoles. On y trouve les contrats, la création et la mise à jour d'un contrat, l'aperçu et l'émission de la facture annuelle, le complément, l'avoir, le rapprochement d'un virement, la réévaluation des statuts et l'export CSV.
- Test : E2E 08 dans un navigateur réel.

## À valider
- Par l'expert-comptable : mentions obligatoires de la facture, arrondi de la TVA, numérotation par année civile.
- Par le juriste : date de référence par défaut, délais de paiement et de préavis.