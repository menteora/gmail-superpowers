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

The latest email timestamp reflects the last timestamp known to the app, not necessarily a continuously refreshed Gmail inbox. The operational dashboard is a Google Sheet summary; advanced interactive editing of case rows is not yet implemented. Archiving a case removes its records from the operational source sheet, but **does not archive its actual Gmail messages**. Automatic deployment and installed add-on refresh depend on your Apps Script configuration.

## Dashboard visuale

Il progetto include `Dashboard.html`, `DashboardApi.gs` e `DashboardOperations.gs`. Dopo `clasp push` verifica che `Dashboard.html` sia presente nell'editor Apps Script. Distribuisci il progetto come **App web**, eseguendo come proprietario e limitando l'accesso al solo proprietario. Apri il relativo URL `/exec`. Per provare il codice HEAD puoi usare il deployment di prova `/dev` (accessibile agli editor del progetto).

La dashboard mostra casi, conversazioni, scadenze e archivio. È possibile modificare stato, note e scadenza di una conversazione, scollegarla dal caso, archiviarla o ripristinarla. Effettua un backup del foglio prima di testare azioni distruttive. La UI non sostituisce l'add-on Gmail.
