# Lot 9 — Abonnements et administration SaaS

Statut : développé et testé (API). Non validé. **Aucun prix inventé, aucun paiement réel.**

## Sécurité inter-écoles
- Seul chemin inter-écoles : contexte `TenancyService.run` avec `isSuperAdmin: true`, construit uniquement pour un jeton de rôle `super_admin`, vérifié par `JwtAuthGuard` + `RolesGuard` + `MfaGuard` (`@RequireMfa`). Aucun paramètre client ne peut l'activer.
- Journalisé : `platform.overview.viewed`, `school.inspected`, `plan.created|updated`, `subscription.updated` (critique si suspension / résiliation, avec motif), `usage.snapshot`, `invoice.drafted`, `invoice.collect.attempted`.
- La RLS des rôles d'école n'est pas affaiblie ; elle est **renforcée** : `Subscription`, `Invoice`, `UsageSnapshot` sont lisibles par l'école mais écrits par le super-admin seulement ; `Plan` est un catalogue plateforme (lecture libre, écriture super-admin).
- La direction n'atteint aucune route `/admin/*` (403, testé) ; elle lit son abonnement via `GET /billing`.

## Plans (configurables)
- Table `Plan` : `code`, `name`, `maxStudents`, `maxStaff`, `trialDays`, `priceMinor`, `currency`, `toBeDefined`, `isActive`, `notes`.
- Migration : 3 placeholders `plan-a-definir-1..3` (« Plan n (a definir) »), **limites et prix null** = non définis, non appliqués. À remplacer par Ayoub.
- Le champ historique `Subscription.pricePerChildMad` (120, issu du CDC) n'est **pas** utilisé par le lot 9 ; la facturation lit uniquement le prix du plan.

## Statuts et transitions
`trial`, `active`, `past_due`, `suspended`, `cancelled` (+ `expired`, `exempt` existants). Transitions contrôlées (409 sinon) ; motif obligatoire pour suspendre / résilier (400).

| Situation | Effet sur les rôles de l'école |
|---|---|
| `suspended`, `cancelled`, `expired` | Lecture seule : toute écriture → **403** `SUBSCRIPTION_INACTIVE` |
| `trial` avec `trialEndsAt` dépassé | Écriture → **402** `TRIAL_EXPIRED` |
| `past_due` | Accès normal (période de grâce, signalée au super-admin) |
| Limite d'élèves dépassée (import) | **402** `PLAN_LIMIT_REACHED` (limite, actuel, ajout) |
| Limite de personnel dépassée (invitation enseignant / accompagnateur ; invitations en attente comptées) | **402** `PLAN_LIMIT_REACHED` |

Application : `SubscriptionStatusInterceptor` (global, méthodes d'écriture, hors routes `auth` / `me` et super-admin) et `PlanLimitsService` (import, invitations).

## Usage et tableau de bord
- `GET /admin/overview` : totaux, écoles par statut / abonnement, essais finissant sous 30 jours, usage réel par école (groupBy) : élèves, personnel, parents, messages et appels sur 30 jours, stockage, dernière activité (AuditLog).
- `GET /admin/schools/:id` : fiche, usage, factures, instantanés. `POST /admin/schools/:id/usage-snapshots` : instantané `UsageSnapshot`.

## Préparation facturation
- Table `Invoice` (`draft` / `issued` / `void`, période, plan, lignes JSON, `amountMinor` **null tant que le prix est à définir**, fournisseur, référence).
- `POST /admin/schools/:id/invoices` : brouillon calculé sur le nombre d'élèves.
- `BillingProvider` : seul `NotConfiguredBillingProvider` (« Non configuré ») est branché ; `POST /admin/invoices/:id/collect` → **503** `BILLING_PROVIDER_NOT_CONFIGURED`.

## Interface
- `/platform` (super-admin) : synthèse, écoles avec usage et limites, gestion d'abonnement (plan, statut, fin d'essai, motif), instantané, brouillon de facture, plans (création, désactivation).
- `/billing` (direction) : statut, plan, usage / limites, factures.

## Tests
34 cas API « L9 » : tableau de bord et usage réel, 403 direction / enseignant / parent sur `/admin/*`, 401 sans jeton, placeholders null, plan unique, limites élèves et personnel en 402 puis levées, essai expiré 402, suspension (motif obligatoire, 403 en écriture, lecture OK, sans effet sur A), transition interdite 409, réactivation, statut inconnu 400, instantané, facture sans montant inventé, période invalide, encaissement 503, `/billing` isolé (A / B), 404 école inconnue, audit plateforme visible au seul super-admin.

## Reste à faire / décisions Ayoub
- Définir plans, limites, prix, durée d'essai ; choisir un fournisseur de paiement (CMI, virement…).
- Tests SQL de la RLS renforcée (lot 10) ; numérotation légale des factures et mentions fiscales.
