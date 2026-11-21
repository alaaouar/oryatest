# Export des donnees personnelles (droit d'acces) - contenu (t50u)

`POST /me/data-export` (asynchrone, JSON + PDF, disponible 7 jours, URL pre-signee courte).
Format `orya-data-export/1`. Source : `apps/api/src/privacy/data-export.service.ts` (`collect`).

| Bloc | Contenu | Perimetre |
|---|---|---|
| `account`, `profiles` | compte (e-mail, langue, statut, dates), profils | titulaire |
| `guardianRecords` | fiches responsable du titulaire (coordonnees) et enfants lies | titulaire seulement |
| `childrenData` | pour chaque enfant lie a SES fiches : presences (date, creneau, statut), statut du bus 7 jours | enfants auxquels il a droit |
| `justifications` | justificatifs **deposes par le titulaire** (motif, statut, metadonnees de piece) | jamais ceux du co-responsable |
| `parentalConsents`, `consents` | consentements donnes par le titulaire | titulaire |
| `deletionRequests`, `rightsRequests`, `auditTrail` | ses demandes et ses actions journalisees (500 dernieres) | titulaire |
| `student` | compte eleve : presences, statut des justificatifs, bus | eleve lui-meme |

Jamais inclus : contenu des pieces jointes (metadonnees seulement, `included: false`), cles de stockage,
secrets (hash de mot de passe, MFA), coordonnees, justificatifs ou consentements d'un autre responsable,
donnees d'un enfant non lie. Tests : BLOC4 X5-X8 et C4.