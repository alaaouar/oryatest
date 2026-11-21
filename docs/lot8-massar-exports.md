# Lot 8 — Préparation Massar et exports

Statut : développé et testé (API). Non validé.

> **Avertissement.** ORYA n'a **aucune connexion officielle** à Massar et ne reproduit **aucun format officiel**. Les exports sont libellés « format ORYA compatible pour saisie Massar ». Les colonnes sont une **hypothèse de travail** (`orya-massar-v1-hypothese`), configurables, **à vérifier avec une vraie école** avant toute saisie.

## Endpoints (direction + MFA, données de l'école uniquement)
| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/v1/massar/check?schoolYear=AAAA-AAAA` | Contrôle des données et rapport d'anomalies (500 premières lignes) |
| GET | `/api/v1/massar/export?report=…&format=csv\|xlsx&schoolYear&from&to` | Export ; `from`/`to` obligatoires pour les absences (≤ 366 jours) |
| GET | `/api/v1/massar/exports` | Historique des 100 derniers exports |

Rapports : `students`, `enrollments`, `absences` (détail par séance, justifiée oui/non + motif), `absence-totals` (par élève), `anomalies`.

## Contrôles
| Code | Gravité | Règle |
|---|---|---|
| `massar_missing` | Bloquant | Code Massar absent |
| `massar_format` | À vérifier | Ne respecte pas `MASSAR_CODE_PATTERN` (défaut supposé `^[A-Z][0-9]{9}$`) |
| `massar_duplicate` | Bloquant | Même code (insensible à la casse) sur plusieurs élèves |
| `birthdate_missing` | Bloquant | Date de naissance absente |
| `birthdate_implausible` | À vérifier | L'âge < 2 ou > 25 ans au début de l'année |
| `not_enrolled` | Bloquant | Aucune classe pour l'année scolaire |
| `name_incomplete` | À vérifier | Un seul mot dans « nom et prénom » |
| `possible_duplicate_student` | À vérifier | Même nom normalisé et même date de naissance |

Non géré (aucune donnée en base, donc aucune colonne inventée) : sexe, lieu de naissance, nom/prénom séparés, nom en arabe. À ajouter si l'école le confirme.

## Préservation des codes Massar
- Base : unicité `(schoolId, massarCode)`.
- Import (lot 2) : un code absent du fichier ne l'efface pas ; **lot 8** : un code différent ne remplace jamais un code déjà enregistré (`massarPreserved` dans le résultat du commit).
- Modification manuelle uniquement depuis la fiche élève, tracée en audit (gravité `warning`, avant / après).

## Colonnes configurables
- `src/massar/massar.columns.ts` : jeux de colonnes et libellés par défaut, version `MASSAR_COLUMNS_VERSION`.
- `MASSAR_COLUMN_LABELS` (JSON `{ "massarCode": "CODE_MASSAR", … }`) : renomme les en-têtes sans changer le code.
- `MASSAR_CODE_PATTERN` : format du code Massar.

## Exports et historique
- CSV UTF-8 avec BOM, séparateur `;` ; XLSX avec un onglet « A lire » qui reprend l'avertissement.
- Anti-injection de formules (`= + - @`, tabulation, retour chariot → préfixe `'`) : fonction partagée avec le lot 7.
- Table `MassarExport` (RLS) : rapport, format, année, période, nombre de lignes et d'anomalies, SHA-256, version des colonnes, auteur, date. Le fichier n'est **pas** conservé (aucune copie de données personnelles) ; il peut être régénéré.
- AuditLog `massar.exported` avec les mêmes métadonnées.
- Migration non destructive `20261030270000_lot8_massar`.

## Interface
`/massar` (direction) : avertissement, synthèse, anomalies filtrables avec lien vers la fiche élève, exports CSV/XLSX (période pour les absences), historique.

## Tests
28 cas API « L8 » : contrôle, mention, codes manquants, format, doublon insensible à la casse puis corrigé, préservation à l'import, 403/401, isolation école B (contrôle et historique), année invalide, exports CSV/XLSX, période obligatoire et plafonnée, historique avec empreinte, audit, nom piégé neutralisé, restauration des données.

## Reste à faire
- Confirmer les colonnes et le format du code avec une école pilote.
- Champs d'identité manquants si demandés (sexe, lieu de naissance, nom arabe).
