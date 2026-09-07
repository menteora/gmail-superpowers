# Gmail Superpowers

Tampermonkey userscript that adds a small local workflow layer to Gmail: portable email links, per-conversation statuses, deadlines, Cases, a separate administration dashboard, and Markdown export.

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
- Richiesta preventivo iniziale
- Specifiche tecniche
- Conferma disponibilità fornitore
```

The Case status is independent from the status and deadline of each individual conversation.

## Separate Admin dashboard

Version `0.6.0` replaces the growing set of floating management controls with one **Admin** button in the lower-right corner of Gmail.

Clicking **Admin** opens a separate browser tab at a local Gmail route used by Gmail Superpowers. Because the dashboard stays on the `mail.google.com` origin, it can access the same IndexedDB data without a server or synchronization layer.

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
- conversation deadlines;
- conversation-specific statuses.

### Stati

Shows all conversations that have a saved status, ordered with dated items first, together with their deadline and Case when available.

### Export

Provides an HTML-style preview and allows downloading or copying the Markdown export.

## Markdown export

The export includes Cases, Case statuses, conversations, conversation statuses, and deadlines.

Example:

```md
# Gmail Superpowers

## Casi

### Preventivo Rossi

Stato: Aspetto conferma finale

Conversazioni:
- [email: Richiesta preventivo](https://mail.google.com/mail/#search/...)
  - Stato: Aspetto documentazione tecnica
  - Scadenza: 2026-09-15

## Scadenze

- 2026-09-15 — [email: Richiesta preventivo](https://mail.google.com/mail/#search/...)
  - Stato: Aspetto documentazione tecnica
  - Caso: Preventivo Rossi
```

The exported email links use the same portable subject-search format as the normal Markdown copy action.

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
