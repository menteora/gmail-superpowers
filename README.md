# Gmail Superpowers

Tampermonkey userscript that adds local workflow tools to Gmail: portable search links, per-conversation status notes, **Cases** for grouping related conversations, Markdown export, and an HTML preview of the export.

## Features

### Portable Gmail links

Each message row and opened conversation gets two actions:

- **Link** — copies a Gmail Search URL based on the subject.
- **Markdown** — copies the same search as Markdown.

Example:

```md
[email: Preventivo settembre](https://mail.google.com/mail/#search/...)
```

The portable link intentionally uses a Gmail subject search instead of a mailbox-specific message ID.

### Conversation status

An opened conversation gets a local **Stato** field below the subject:

```text
Stato  Aspetto risposta da Marco   ✓   🗑
```

- `Enter` or ✓ saves.
- Leaving the field saves changed text automatically.
- `Escape` restores the last saved value.
- 🗑 deletes the status.

Saved status is also visible directly in the Gmail message list:

```text
Preventivo Rossi   Stato: Aspetto risposta da Marco
```

### Cases: link separate conversations

A **Case** groups conversations that belong to the same issue, project or follow-up even when they are separate Gmail threads.

Open a conversation and use the **Case** icon next to the URL/Markdown actions. You can:

- create a new Case and attach the current conversation;
- attach it to an existing Case;
- move it to another Case;
- unlink it from its Case.

Example:

```text
Caso: Preventivo Rossi
Stato del caso: Aspetto conferma finale

Conversazioni:
- Richiesta preventivo iniziale
- Specifiche tecniche
- Conferma disponibilità fornitore
```

The Case panel lists all linked conversations as clickable links, so you can move between them quickly.

A conversation that belongs to a Case also gets a compact Case preview in the Gmail list:

```text
Preventivo Rossi   Caso: Preventivo Rossi · Aspetto conferma finale
```

The normal conversation status and the Case status are separate:

- **Conversation status** = note specific to that Gmail thread.
- **Case status** = shared state of the whole issue containing multiple conversations.

A conversation currently belongs to at most one Case.

### Export Markdown

The fixed **Export MD** button downloads a `.md` file containing the local workflow data for the Gmail account currently open:

- every Case;
- the status of each Case;
- every conversation linked to that Case;
- each conversation in the portable Markdown format;
- the conversation-specific status when present;
- conversations that have a saved status but are not linked to a Case.

Example export:

```md
# Gmail Superpowers

## Casi

### Preventivo Rossi

Stato: Aspetto conferma finale

Conversazioni:
- [email: Richiesta preventivo](https://mail.google.com/mail/#search/...)
  - Stato: Aspetto documentazione tecnica
- [email: Conferma disponibilità](https://mail.google.com/mail/#search/...)

## Conversazioni con stato senza caso

- [email: Fattura settembre](https://mail.google.com/mail/#search/...)
  - Stato: Aspetto nota di credito
```

### HTML preview

Version `0.5.1` adds an **Anteprima** button next to **Export MD**.

It opens an in-browser HTML view of the same data before downloading it. The preview shows:

- Cases as separate cards;
- Case status;
- linked conversations as clickable Gmail Search links;
- per-conversation status;
- conversations with a status but no Case.

The preview includes a **Scarica MD** button, so the Markdown file can be downloaded directly from the preview. Clicking outside the dialog, the close button, or pressing `Escape` closes it.

The preview is built with DOM APIs instead of `innerHTML`, matching the script's Trusted Types-safe approach.

The exported email links use the same portable Gmail subject-search format as the normal Markdown copy button; they do not depend on a mailbox-specific Gmail message ID.

Both export and preview are generated completely in the browser. No workflow data is sent to an external service.

## Local storage

Everything is stored locally in the browser using IndexedDB:

```text
gmail-superpowers
├── thread-notes
├── cases
└── case-members
```

Gmail thread identifiers are used locally when available. If Gmail does not expose a usable thread ID, the script can fall back to the normalized subject. Subject fallback is accepted only when the match is unique where ambiguity matters.

The Gmail account slot (`/mail/u/0/`, `/mail/u/1/`, etc.) is included in local records so different Gmail accounts in the same browser remain separated. Export and preview include only the account slot currently open.

Local data:

- is not sent to an external API;
- is not stored inside Gmail;
- is not synchronized automatically across browsers or devices;
- can be lost if the site's browser storage is cleared.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open:

```text
https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
```

3. Confirm installation in Tampermonkey.
4. Reload Gmail.

## Automatic updates

There is only one userscript file. Both update and download URLs point to it:

```javascript
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
```

When publishing a new version, increment `@version` in `gmail-superpowers.user.js`.

## Technical notes

Gmail is a single-page application and its internal DOM can change. The script uses a `MutationObserver` to re-attach controls when Gmail changes views without a full reload.

The script avoids assigning SVG or preview markup through `innerHTML`; UI elements are built through DOM APIs so Gmail's Trusted Types policy does not block them.

## Files

```text
gmail-superpowers.user.js   Main Tampermonkey userscript
README.md                   Documentation
```
