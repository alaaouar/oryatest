# Antivirus et epuisement des ressources (t52u)

Remplace les reglages de marge de `docs/antivirus-stabilite-t51.md` (timeout 60 s retire).

## Ordre des controles (imports CSV/XLSX et fichiers recus)

1. **Taille** : 413 (imports 5 Mo, fichiers 10 Mo).
2. **Metadonnees ZIP sans decompression** des que le contenu est une archive ZIP, quel que soit son nom
   (`zip-guard.ts`, repertoire central seul) : 200 entrees maximum, 50 Mo decompresses declares, ratio 100:1,
   chemins absolus ou `..` interdits ; `[Content_Types].xml` exige pour un `.xlsx`. Refus 400, clamd jamais
   appele, rien n'est ecrit (BLOC3 EX1/EX2 : moins de 2 s, appels clamd = 0 via un faux clamd espion).
3. **ClamAV** sur tous les octets recus, avant detection du type et avant toute ecriture (EICAR deguise en
   PDF/PNG/HEIC refuse 422 : inchange).
4. **Detection du type** (magic bytes ; `.xlsx` = archive ZIP).

Limite connue : une archive ZIP *precedee* d'octets (offsets relatifs) n'est pas reconnue par l'etape 2 ;
elle reste bornee par les limites clamd ci-dessous puis refusee par l'etape 4 (type non PDF/image).

## API

| Variable | Defaut | Effet |
|---|---|---|
| `CLAMAV_TIMEOUT_MS` | 30000 | delai d'analyse ; depasse = 503, rien n'est ecrit (imports et fichiers) |
| `CLAMAV_MAX_CONCURRENT` | 4 | analyses simultanees par processus API ; au-dela refus immediat 503 « saturee », rien n'est ecrit |
| `UPLOAD_RATE_LIMIT` | 20 / min | justificatifs, agenda, scan du consentement papier (429 sans ecriture) |
| `IMPORT_RATE_LIMIT` | 20 / min | imports (429 sans ecriture) |

Un clamd **injoignable** garde le comportement F11 : fichier recu, marque `error`, jamais telechargeable,
re-analyse par `run-file-pending.ts --rescan`. Seuls le delai et la saturation refusent sans ecrire.

## clamd

Conteneur jetable `orya-test-clamav` : `scripts/clamav/clamd-orya-test.conf`, copie dans le conteneur avant
son demarrage (`docker cp`). Aucun clamd global de la machine n'est modifie.

Reglages recommandes pour la **production** (clamd dedie a ORYA, a appliquer par l'exploitant) :

```
MaxScanTime 20000        # ms, inferieur a CLAMAV_TIMEOUT_MS (30 s) : clamd conclut avant l'API
MaxFileSize 60M          # >= 50 Mo decompresses autorises par le garde ZIP
MaxScanSize 120M
StreamMaxLength 12M      # >= 10 Mo (plus gros fichier accepte) ; au-dela clamd repond ERROR => 503
MaxRecursion 10
MaxFiles 1000            # >= 200 entrees autorisees par le garde ZIP
AlertExceedsMax yes      # echec ferme : limite atteinte = Heuristics.Limits.Exceeded.* FOUND => 422
MaxThreads 10            # >= somme des CLAMAV_MAX_CONCURRENT des instances API
```

## Mesures

Scan d'un fichier legitime de 10 Mo (PDF texte) sur `orya-test-clamav` : voir la ligne
`MESURE t52u` du journal Bloc 3 (premier passage a froid plus lent, puis environ 150 ms).