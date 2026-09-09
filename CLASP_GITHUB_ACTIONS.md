# Deploy automatico Apps Script con GitHub Actions

Il workflow `.github/workflows/deploy-apps-script.yml` esegue `clasp push --force` quando cambiano i file Apps Script su `main` oppure quando viene avviato manualmente.

## Prerequisito Google

Abilita Apps Script API per l'account Google che possiede o puo modificare il progetto:

https://script.google.com/home/usersettings

## 1. Genera le credenziali clasp sul tuo PC

Installa clasp e fai login con lo stesso account Google:

```bash
npm install -g @google/clasp
clasp login
```

Il login crea il file globale:

```text
~/.clasprc.json
```

Su Windows, normalmente si trova nella home dell'utente, ad esempio:

```text
C:\Users\TUO_UTENTE\.clasprc.json
```

Il file contiene anche un refresh token: non commetterlo mai nel repository.

## 2. Crea il mapping del progetto

Recupera lo Script ID da Apps Script > Project Settings e prepara questo JSON:

```json
{
  "scriptId": "IL_TUO_SCRIPT_ID",
  "rootDir": "."
}
```

## 3. Crea i GitHub Secrets

Nel repository apri:

Settings > Secrets and variables > Actions > New repository secret

Crea due secret.

### `CLASPRC_JSON`

Come valore incolla l'intero contenuto di `~/.clasprc.json` generato da `clasp login`.

### `CLASP_JSON`

Come valore incolla il JSON con `scriptId` e `rootDir` mostrato sopra.

Il workflow ricrea i due file solo nel runner temporaneo di GitHub Actions, verifica che siano JSON validi, controlla il login e poi esegue il push.

## 4. Primo deploy dopo il cambio scope Gmail

Questa versione usa GmailApp per creare, applicare e rimuovere label. Il manifest richiede quindi un'autorizzazione Gmail piu ampia rispetto alla precedente versione read-only.

Dopo il primo `clasp push`, apri il progetto Apps Script o reinstalla/aggiorna il test deployment dell'add-on e completa la nuova autorizzazione Google quando richiesta.

## Sicurezza

`CLASPRC_JSON` equivale a una credenziale OAuth persistente. Non stamparlo nei log, non inserirlo nei file del repository e revocalo/rigeneralo se viene esposto.
