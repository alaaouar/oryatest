# Prototype legacy (racine)

Les dossiers src/, prisma/, public/ et les fichiers Next de la racine sont l'ancien prototype.
Ils sont exclus de la plateforme (P0-9) : hors tsconfig racine, hors contexte Docker (.dockerignore),
et les scripts racine db:up / db:down (qui pilotaient le conteneur orya-postgres) sont retires.
Rien n'a ete supprime. La plateforme vit dans apps/api et apps/web.
