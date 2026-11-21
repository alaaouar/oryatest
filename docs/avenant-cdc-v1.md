# Avenant n° 1 au CDC ORYA v2.0 — périmètre de la version 1

**Date :** 29 octobre 2026
**Référence :** « ORYA Complète — Cahier des charges final, Version 2.0, octobre 2026 »
**Statut :** décisions prises par le porteur de projet, à conserver avec le CDC.

> Pourquoi ce document existe : le CDC v2.0 indique que « toutes les fonctionnalités sont
> dans le périmètre ». Sans avenant écrit, tout ce qui est reporté est une non-conformité.
> Cet avenant rend les reports explicites et vérifiables.

---

## 1. Arbitrages de référence

| Sujet | Décision | Référence CDC |
|---|---|---|
| Marque | Le CDC §14 fait foi. Le brief antérieur (bleu `#0B1F44`, logo végétal, Plus Jakarta Sans) est abandonné. | §14 |
| Nom | **ORYA**, sous-titre « L'école et la famille, au même endroit ». | §14 |
| Signe | Wordmark ORYA, point teal `#1AA99A` dans le O, décalé en bas à droite. **Jamais** de maison dans le O. | §14 |
| Mobile | **Flutter** pour les profils terrain. | §11 |
| Console | **Next.js / React** pour Direction et Super-admin. | §11 |
| API | **Node.js / NestJS**, versionnée. | §11 |
| Base | **PostgreSQL** multi-tenant, isolation par **RLS**. | §8, §11 |

---

## 2. Éléments reportés hors de la version 1

### 2.1 Module paiement et abonnement — **hors V1**

| Exigence CDC | Décision |
|---|---|
| §7 abonnement par enfant et par an, 120 DH TTC paramétrable | Reporté |
| §7 statuts essai / à payer / payé / expiré / exonéré | Reporté |
| §7 paiement en ligne via opérateur marocain, webhook, réconciliation | Reporté |
| §7 reçu, historique, rappels avant échéance | Reporté |
| §6 ligne « abonnement à renouveler, paiement reçu » | Reporté |
| §15 critère « paiement testé en environnement de test » | Non applicable V1 |
| §12 entités `Subscription`, `Payment`, `Receipt` | Reportées |

**Conséquence à assumer :** la ligne « Payer l'abonnement » de la matrice des droits (§3.5),
la ligne « Abonnement » du tableau de bord école (§4 M9) et la ligne « abonnement » du
tableau super-admin (§4 M10) restent **non livrées** en V1.

### 2.2 Application mobile — décalée au Lot 2 et suivants

L'application Flutter n'est pas construite pendant le Lot 1 (Fondations). Elle démarre
quand l'API, l'authentification et le RLS sont prouvés par des tests.

### 2.3 École sur mobile — **web uniquement en V1**

Le CDC §13 mentionne « École (web et mobile) ». En V1, la direction utilise la console web.
L'ajout d'une interface École en Flutter est reporté (§ à trancher ultérieurement).

---

## 3. Précision demandée : l'accompagnateur

Le CDC §5.3 exige une application terrain pour l'accompagnateur : feuille de route,
montée/descente en un tap, **fonctionnement hors ligne**, signalement d'incident,
bouton d'urgence, clôture du trajet.

**Décision proposée, à confirmer :** l'accompagnateur est un profil **mobile Flutter**
au même titre que Parent, Enseignant et Élève. Sans téléphone, le module transport
du CDC est impossible. Ce point ne bloque pas le Lot 1.

---

## 4. Ce qui n'est pas modifié

Tout le reste du CDC reste contractuel et non négociable, notamment :

- isolation stricte par école avec RLS et tests automatisés de non-fuite (§8 S-1, §15) ;
- Argon2/bcrypt, MFA obligatoire pour École et Super-admin (§8 S-2) ;
- journal d'audit inaltérable (§8 S-5) ;
- aucun SMS ni WhatsApp dans le code (§6, §15) ;
- Loi 09-08 / CNDP avant toute collecte réelle (§9, §15) ;
- aucun affichage « synchronisé avec Massar » (§1) ;
- français et arabe (RTL) (§2, §10).

---

## 5. Suivi

| Élément reporté | Lot cible | Référence |
|---|---|---|
| Paiement / abonnement | Lot 6 (après décision) | §7 |
| Application Flutter | Lots 2 à 5 | §11, §13 |
| Interface École mobile | non planifié | §13 |
| Accompagnateur mobile | Lot 5 (à confirmer) | §5.3 |

---

## Mise a jour du 29 octobre 2026 — decisions du porteur de projet

| Sujet | Decision | Impact |
|---|---|---|
| Application mobile | Flutter, Lot 5 | L'accompagnateur et le transport demarrent au Lot 5 |
| Interface Ecole | Web responsive d'abord, mobile Ecole plus tard | Pas de Flutter pour la direction en V1 |
| Paiement | Lot 6, non supprime | Le schema Subscription est pose des maintenant ; tous les etablissements sont en essai (trial) |
| Accompagnateur | Mobile Flutter (Lot 5) | Coherent avec le CDC 5.3 (hors ligne, un tap) |

Consequence technique : la table Subscription existe deja, avec status = trial par
defaut, pricePerChildMad = 120 et trialEndsAt. Aucun encaissement avant le Lot 6.
