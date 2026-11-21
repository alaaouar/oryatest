# t51u : stabilite antivirus et refus ZIP

Diagnostic seul (b7f4cb3, trois piles neuves) : PING/PONG et VERSION disponibles,
400 explicite du garde ZIP, aucune ecriture d'import/fichier ; 19,092 / 19,158 /
19,220 s. Le journal du run initial contient un timeout du scan (ancien plafond
20 s). Le statut HTTP initial n'avait pas ete capture : timeout probable, pas
preuve d'un demarrage non pret.

- verify-all attend PING/PONG ET VERSION sur TCP clamd (meme canal que INSTREAM),
  au maximum 120 s supplementaires ; echec distinct `ClamAV non pret` (code 78).
  La creation initiale de clamd reste bornee a 600 s et utilise le meme message.
- Scan avant le garde ZIP, ordre INCHANGE. Defaut CLAMAV_TIMEOUT_MS : 60 000 ms
  (marge pour les 19 s observes). Un delai depasse reste un scan inconnu : jamais
  considere propre, jamais traite. Le timeout d'import renvoie un 503 distinct.
- Deux proprietes testees separement : scanner indisponible => 503 sans ecriture ;
  bombe ZIP => 400 explicite sans ecriture. La condition ZIP n'a pas ete elargie.
- Une fixture TCP silencieuse (loopback 55437, API test 3271, timeout 1000 ms)
  prouve aussi le chemin timeout : HTTP 503, message distinct, aucun ImportJob,
  ImportRowError ni StoredFile. Elle n'est jamais utilisee pour autoriser un scan.
- La suite API compare aussi les fichiers locaux avant/apres le refus ZIP.
  Les trois scenarios n'affaiblissent ni le fail-closed ni le controle ZIP.

Deux verify-all consecutifs sur le meme commit sont requis avant toute suite.
Aucun test de preproduction dans cette procedure.