# Gmail Superpowers

Google Workspace Gmail add-on with **Google Sheets as the only data store**. No Tampermonkey, IndexedDB, browser synchronization or legacy /exec bridge is needed.

## Data model

The protected source of truth is the `records` worksheet, with existing logical record types:

- `case`: a named collection of related conversations. Cases **have no status**.
- `member`: a Gmail conversation linked to a case, or an independent conversation.
- `note`: per-conversation state and notes.
- `deadline`: per-conversation due date.

The `dashboard` worksheet is automatically rebuilt as a **single row per case**, plus one row per ungrouped conversation. A case row summarizes linked conversation count, individual email statuses, earliest deadline and latest known message timestamp. The detail column contains the linked conversation descriptions. The dashboard is a derived overview, not the editable source of truth.

The `archivio` worksheet is a concise list of closed cases and conversations, while the hidden `_archivio_dati` worksheet retains their complete JSON record snapshots. Archived records are removed from the operative `records` worksheet and can be restored from the Gmail add-on home. The archive thus preserves IDs and historical metadata without cluttering the operational sheets.

### Operations

Within the Gmail add-on for an opened conversation, users can:
- select or create a case, edit that conversation's status, notes and due date;
- **Scollega questa email dal caso**: unlink one conversation while retaining its notes and deadline as an independent item;
- **Chiudi e archivia questa email**: archive a single conversation without deleting the Gmail message;
- **Chiudi e archivia caso**: archive the case together with all linked conversations and their metadata.

From the add-on home, `Ripristina` restores the selected archive entry. Restoration is refused when conflicting record IDs already exist in the operational data.

### Migration

The add-on keeps the original `GSP_STORAGE_SPREADSHEET_ID` setting and the existing `records` worksheet. On first access, the legacy free-text case status is transferred into the case's `notes` field as `Stato precedente del caso: …`, then the former `status` field is cleared. Existing case names, IDs, conversation links, statuses, notes and due dates are retained. Re-running the migration is safe. **Make a backup of the spreadsheet before deploying or running the migration.**

The Gmail label namespace `gs/` continues to represent case membership, and `gss/` continues to represent individual email statuses only. The bulk sync action reconciles legacy case-derived status labels.

## Installation

Use a standalone Google Apps Script project with the files `Code.gs`, `Operational.gs`, and `appsscript.json`. Configure `.clasp.json` using `.clasp.json.example` and run `clasp push`, or deploy with your existing GitHub Actions setup. Install the project as a test Gmail Workspace add-on, authorize access to Gmail and Google Sheets, and use the add-on home to initialize storage.

Do not use old Tampermonkey scripts or the old sync-bridge setup. The old bridge authentication endpoint and token have been removed from the code; if a previously deployed web app exposed this endpoint, disable the old deployment separately in Google Apps Script.

## Files

- `Code.gs` — native Gmail add-on cards, persistence and Gmail label management.
- `Operational.gs` — one-row-per-case dashboard, data migration, archive and restore.
- `appsscript.json` — Workspace add-on manifest.
- `.github/workflows/deploy-apps-script.yml` — configured deployment workflow.

### Important limits

The latest email timestamp reflects the last timestamp known to the app, not necessarily a continuously refreshed Gmail inbox. The operational dashboard is a Google Sheet summary; the Sheet itself is a read-only summary; editing individual conversations is available in the separately deployed web dashboard. Archiving a case removes its records from the operational source sheet, but **does not archive its actual Gmail messages**. Automatic deployment and installed add-on refresh depend on your Apps Script configuration.

## Dashboard visuale

La dashboard web è servita dallo **stesso progetto Apps Script** dell'add-on Gmail tramite `doGet()` in `DashboardApi.gs`. Utilizza Google Sheets come unica origine dati. La pubblicazione come **App web** è un'operazione manuale, separata da `clasp push` e dall'installazione dell'add-on.

### Prima pubblicazione: operazioni manuali (obbligatorie)

1. Aggiorna il repository locale e carica il codice nello **stesso progetto Apps Script** usato dall'add-on:

   ```bash
   git pull origin main
   clasp push
   clasp open
   ```

   Se hai già eseguito `clasp push` con il codice aggiornato, non serve ripeterlo. Nell'editor Apps Script verifica che siano presenti `Dashboard.html`, `DashboardApi.gs` e `DashboardOperations.gs`. Il file `.claspignore` deve consentire i file `.html`.

2. Prima di provare archiviazione o modifiche, **crea una copia di backup del Google Sheet**. Verifica che l'add-on sia già stato inizializzato e che la proprietà script `GSP_STORAGE_SPREADSHEET_ID` punti al foglio corretto. Se non hai mai inizializzato l'add-on, fallo dalla sua home in Gmail.

3. Nell'editor di [Google Apps Script](https://script.google.com/home/projects) apri **Distribuisci → Nuovo deployment**.
4. In **Seleziona tipo**, scegli **App web** (icona a forma di ingranaggio, se mostrata).
5. Configura il deployment:
   - **Descrizione:** ad esempio `Gmail Superpowers Dashboard`.
   - **Esegui come:** **Me (il proprietario)**, così la dashboard usa le autorizzazioni del tuo account.
   - **Chi può accedere:** **Solo io**. Non pubblicare come `Chiunque`: la dashboard contiene metadati delle email.
6. Premi **Distribuisci**, completa le eventuali richieste di autorizzazione e copia l'**URL dell'app web** (termina con `/exec`).
7. Apri l'URL `/exec` con lo **stesso account Google** che possiede lo script. Verifica che si carichino panoramica, casi, email senza caso e archivio. Per le azioni di scrittura, usa inizialmente dati di prova.

> **Importante:** `clasp push` carica i sorgenti nel progetto Apps Script, **ma non pubblica né aggiorna automaticamente** una versione già distribuita della Web App. Il link `/exec` usa la versione selezionata nel deployment.

### Aggiornare una Web App già pubblicata

Dopo ogni modifica al codice:

1. Esegui `git pull origin main` e `clasp push` (se non sono già stati eseguiti).
2. Nell'editor Apps Script vai su **Distribuisci → Gestisci deployment**.
3. Seleziona il deployment della dashboard e premi **Modifica** (icona della matita).
4. Alla voce **Versione**, scegli **Nuova versione**, poi **Distribuisci**.
5. Riapri il precedente URL `/exec`: normalmente rimane invariato perché hai aggiornato il deployment esistente.

Per provare il codice più recente *prima* di creare una nuova versione, usa **Distribuisci → Deployment di prova → App web** e apri l'URL `/dev` (accessibile agli editor dello script). Il deployment di prova non sostituisce la pubblicazione dell'URL `/exec`.

La Web App e l'add-on Gmail convivono nello stesso progetto: **non occorre reinstallare l'add-on per pubblicare la dashboard**. La dashboard permette ricerca, scadenze, modifica dello stato delle singole email, note, scollegamento, archiviazione e ripristino. L'archiviazione sposta i record tra fogli, ma non archivia i messaggi nella casella Gmail.

### Accesso diretto dall'add-on Gmail e diagnosi della dashboard vuota

Dopo la pubblicazione della Web App, l'add-on Gmail mostra **Apri dashboard visuale** nella home e nel dettaglio delle conversazioni. Il pulsante usa l'URL del deployment dello stesso progetto Apps Script. Se non compare, imposta nelle **Impostazioni progetto → Proprietà script** la chiave `GSP_DASHBOARD_WEBAPP_URL` con l'URL `/exec` del deployment; quindi ricarica l'add-on. **Apri riepilogo Google Sheet** continua ad aprire il foglio di riepilogo, non la dashboard web.

Se la dashboard non mostra casi o email, verifica che `GSP_STORAGE_SPREADSHEET_ID` nelle proprietà script sia l'ID del Google Sheet già usato dall'add-on e che tu abbia aperto la Web App pubblicata dallo **stesso progetto Apps Script**. Non inizializzare un nuovo archivio per risolvere un problema di collegamento: potresti ottenere un foglio vuoto diverso dal precedente. Se i dati non si caricano, la dashboard ora segnala esplicitamente la configurazione mancante. Dopo `clasp push` aggiorna il deployment della Web App a **Nuova versione**.

### Eliminazione dei casi

Dalla dashboard visuale puoi **Chiudere e archiviare** un caso (ripristinabile) oppure **Eliminare caso**: quest'ultima operazione rimuove il contenitore e scollega le conversazioni, conservando i messaggi Gmail, i relativi stati, note e scadenze. Nella vista **Archivio** è possibile anche **Eliminare definitivamente** un caso archiviato, confermandone il nome esatto: vengono eliminati solo i record archiviati, non le email Gmail. Nell'add-on Gmail, la scheda del caso espone **Elimina caso (conserva le email)**. Prima delle eliminazioni fai una copia di backup del foglio. Dopo il merge esegui `git pull`, `clasp push` e aggiorna la versione della Web App.
