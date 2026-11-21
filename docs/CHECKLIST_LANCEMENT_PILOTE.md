# Checklist de lancement pilote ORYA

> Aucune case n'est cochée par l'agent : chaque point est à valider par Ayoub.

## Technique
- [ ] Hébergement choisi, domaine et TLS en place
- [ ] Secrets de production générés (JWT, MFA, mots de passe BD) et stockés hors dépôt
- [ ] `docker-compose.prod.yml` dérivé de l'exemple, `COOKIE_SECURE=true`, `CORS_ORIGINS` exact
- [ ] Migrations + RLS appliquées ; API connectée avec `orya_app` (pas le super-utilisateur)
- [ ] Sauvegarde quotidienne active + une restauration testée sur base jetable
- [ ] `npm run test:api`, `test:db`, E2E verts sur la version livrée
- [ ] Supervision (santé `/api/v1/health`, disque, erreurs) et alerte
- [ ] Montée Prisma 7 planifiée (dette documentée)

## École pilote
- [ ] Contrat / accord pilote et clauses de protection des données (loi 09-08, CNDP) validés
- [ ] Plan et conditions définis (aucun prix inventé dans l'outil)
- [ ] Compte direction créé, MFA activé
- [ ] Import élèves/parents vérifié sur un échantillon
- [ ] Affectations professeurs / classes pour l'année en cours
- [ ] Export Massar vérifié par la direction (format ORYA compatible pour saisie Massar)

## Accompagnement
- [ ] Guides direction / professeur / parent remis
- [ ] Formation courte direction + professeurs
- [ ] Canal de support et délai de réponse annoncés
- [ ] Point de retour à J+7 et J+30
