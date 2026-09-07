# Gmail Superpowers

Tampermonkey userscript that adds a small local workflow layer to Gmail: portable email links, per-conversation statuses, deadlines, Cases, a separate administration dashboard, Markdown export, and JSON backup/import.

All workflow data is stored locally in the browser with IndexedDB. No external backend is required.

## Quick actions inside Gmail

Each message row and opened conversation keeps the lightweight actions that are useful while reading email:

- **Link** — copies a portable Gmail Search URL based on the subject.
- **Markdown** — copies the same search as Markdown.
- **Case** — links the opened conversation to a Case.

Example portable link:

```md
[email: Preventivo settembre](https://mail.google.com/mail/#search/...)
```

The link intentionally uses a subject search rather than a mailbox-specific message ID, so another recipient who has the same email can use it too.

## Conversation status

An opened conversation has a local **Stato** field:

```text
Stato  Aspetto risposta da Marco   ✓   🗑
```

- `Enter` or ✓ saves.
- Leaving the field saves changes automatically.
- `Escape` restores the last saved value.
- 🗑 removes the status.

The saved status is also visible as a compact badge in the Gmail message list.

## Deadlines

Version `0.6.0` adds a **Scadenza** field to every opened conversation.

```text
Scadenza  [ 15/09/2026 ]   ✓   🗑
```

A deadline is stored independently from the conversation status, so an email can have:

- a deadline without a status;
- a status without a deadline;
- both.

The deadline is also shown directly in the Gmail list. Expired, today, and future deadlines use different visual states.

## Cases

A **Case** groups multiple separate Gmail conversations that belong to the same issue, project, order, follow-up, or decision.

Example:

```text
Caso: Preventivo Rossi
Stato del caso: Aspetto conferma finale

Conversazioni:
- Richiesta preventivo iniziale · ultima email 05/09/2026 14:32
- Specifiche tecniche · ultima email 06/09/2026 09:18
- Conferma disponibilità fornitore · ultima email 07/09/2026 11:04
```

Version `0.6.1` stores and shows the date/time of the latest message known for each conversation linked to a Case. The value is captured when the conversation is linked, refreshed when that conversation is opened again, and can also be backfilled from the Gmail message list when Gmail exposes the row date.

Existing Case memberships remain valid: their latest-email date appears after Gmail Superpowers can observe that conversation again.

The Case status is independent from the status and deadline of each individual conversation.

## Separate Admin dashboard

The **Admin** button in the lower-right corner of Gmail opens a separate browser tab at a local Gmail route used by Gmail Superpowers.

Because the dashboard stays on the `mail.google.com` origin, it can access the same IndexedDB data without a server or synchronization layer.

The dashboard is visually isolated from Gmail and has four sections:

### Scadenze

The default view lists conversations ordered by due date and provides filters for:

- all deadlines;
- overdue;
- today;
- next 7 days;
- next 30 days.

Each row shows:

```text
Scadenza | Email | Stato | Caso
```

The date is editable directly from the dashboard.

### Casi

Shows every Case with:

- Case status;
- linked conversations;
- latest known email date/time for each linked conversation;
- conversation deadlines;
- conversation-specific statuses.

### Stati

Shows all conversations that have a saved status, ordered with dated items first, together with their deadline and Case when available.

### Export / Import

Version `0.7.0` adds a full JSON backup/import workflow to the Admin dashboard.

The page now provides:

- **Scarica Markdown** — human-readable export;
- **Copia Markdown** — copies the same Markdown to the clipboard;
- **Backup JSON** — lossless local backup;
- **Import JSON** — restores a previously generated Gmail Superpowers backup.

The JSON backup contains:

```text
notes
Deadlines
Cases
Case memberships
latest-known email dates
record timestamps and IDs
```

The backup also records the source Gmail account slot (`u0`, `u1`, etc.). During import, storage keys are rebased to the Gmail account slot currently open, so a backup created while the same mailbox was loaded in a different Gmail slot can still be restored cleanly.

Two import modes are available:

- **Merge — aggiungi/aggiorna**: existing data remains; imported records with the same key or Case ID replace those records.
- **Sostituisci i dati correnti**: deletes Gmail Superpowers data for the currently open Gmail account slot before importing the backup. This mode requires an explicit confirmation.

Replace mode does not delete Gmail Superpowers data belonging to other Gmail account slots in the same browser.

Markdown is intentionally not used as the restore format because it is designed for reading and sharing rather than preserving internal IDs and exact relationships.

## Markdown export

The Markdown export includes Cases, Case statuses, conversations, the latest known email date for linked conversations, conversation statuses, and deadlines.

Example:

```md
# Gmail Superpowers

## Casi

### Preventivo Rossi

Stato: Aspetto conferma finale

Conversazioni:
- [email: Richiesta preventivo](https://mail.google.com/mail/#search/...)
  - Ultima email: 05/09/2026 14:32
  - Stato: Aspetto documentazione tecnica
  - Scadenza: 2026-09-15

## Scadenze

- 2026-09-15 - [email: Richiesta preventivo](https://mail.google.com/mail/#search/...)
  - Stato: Aspetto documentazione tecnica
  - Caso: Preventivo Rossi
```

The exported email links use the same portable subject-search format as the normal Markdown copy action.

## JSON backup format

The backup file is versioned independently from the userscript:

```json
{
  "format": "gmail-superpowers-backup",
  "schemaVersion": 1,
  "appVersion": "0.7.0",
  "exportedAt": "2026-09-07T14:00:00.000Z",
  "sourceAccount": "u0",
  "data": {
    "notes": [],
    "deadlines": [],
    "cases": [],
    "members": []
  }
}
```

Import validates both the backup marker and schema version before writing data.

## Local storage

Data is stored in IndexedDB:

```text
gmail-superpowers
├── thread-notes
├── deadlines
├── cases
└── case-members
```

Gmail thread identifiers are used locally when available. When Gmail does not expose a usable thread identifier, the script can fall back to a normalized subject where the match is unambiguous.

The Gmail account slot (`/mail/u/0/`, `/mail/u/1/`, etc.) is part of the local data model so different Gmail accounts in the same browser stay separated.

Local data:

- is not sent to an external API;
- is not stored in Gmail itself;
- is not automatically synchronized between browsers or devices;
- can be removed if browser storage for Gmail is cleared.

For this reason, **Backup JSON** is the recommended way to preserve or move Gmail Superpowers data.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open:

```text
https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
```

3. Confirm the installation in Tampermonkey.
4. Reload Gmail.

## Automatic updates

There is only one userscript file. Both update and download URLs point to it:

```javascript
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
```

When publishing a new version, increment `@version` in `gmail-superpowers.user.js`.

## Technical notes

Gmail is a single-page application. The normal Gmail integration uses a `MutationObserver` to re-attach lightweight controls while navigating without a full page reload.

The Admin dashboard runs on a dedicated `#gsp-admin` route in a separate tab and uses a Shadow DOM so Gmail's styles do not leak into the administrative interface.

SVG icons are built through DOM APIs instead of assigning SVG markup with `innerHTML`, avoiding Gmail Trusted Types restrictions.

## Files

```text
gmail-superpowers.user.js   Main Tampermonkey userscript
README.md                   Documentation
```
