# Gmail Superpowers

Tampermonkey userscript that adds quick actions to Gmail for copying portable Gmail searches and keeping a local status note for each open conversation.

The generated link does not point to a Gmail-specific message or thread ID. Instead, it opens a Gmail search such as:

```text
subject:"Example subject"
```

This makes the link useful for other people who received the same email, because Gmail searches inside the mailbox of whoever opens it.

## Features

Gmail Superpowers adds two actions to each email row in the Gmail message list and also to an opened email:

- **Link icon** — copies the Gmail Search URL.
- **Markdown icon** — copies the same search as Markdown in the form:

```md
[email: Example subject](https://mail.google.com/mail/#search/...)
```

When a conversation is open, Gmail Superpowers also adds a compact **Stato** field below the subject.

Example:

```text
Stato  Aspetto risposta da X e Y   ✓   🗑
```

The status can be changed directly in the field and saved with the check button or by pressing **Enter**. Leaving the field also saves changes automatically. **Escape** restores the last saved value. The trash button deletes the stored status immediately.

The buttons and status field are added dynamically, so they continue to appear while navigating Gmail without a full page reload.

## Local status storage

Status notes are stored in the browser with **IndexedDB** in a dedicated database:

```text
gmail-superpowers
└── thread-notes
```

Whenever Gmail exposes a thread identifier in the current URL, the note is associated with that thread. If a usable thread identifier is not available, the script falls back to the email subject.

The Gmail account slot (`/mail/u/0/`, `/mail/u/1/`, etc.) is also included in the local key so notes from different Gmail accounts in the same browser do not normally overlap.

These notes are intentionally local:

- they are not sent to any API;
- they are not stored in Gmail;
- they are not synchronized between browsers or devices;
- clearing the site's browser storage can remove them.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in your browser.
2. Open this raw userscript URL:

```text
https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
```

3. Tampermonkey should show the installation page for **Gmail Superpowers**.
4. Confirm the installation.
5. Reload Gmail.

## Automatic updates

The userscript uses the same raw `.user.js` file for both update checking and downloading:

```javascript
// @updateURL    https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
// @downloadURL  https://raw.githubusercontent.com/menteora/gmail-superpowers/main/gmail-superpowers.user.js
```

When publishing a new version, increment `@version` in `gmail-superpowers.user.js`. Tampermonkey can then detect it with **Check for userscript updates**.

There is no separate `.meta.js` file.

## Gmail Search behavior

For an email with subject:

```text
Preventivo settembre
```

The URL button copies a Gmail Search URL equivalent to:

```text
https://mail.google.com/mail/#search/subject%3A%22Preventivo%20settembre%22
```

The Markdown button copies:

```md
[email: Preventivo settembre](https://mail.google.com/mail/#search/subject%3A%22Preventivo%20settembre%22)
```

## Notes

Gmail is a single-page application and its internal DOM can change over time. The script therefore uses a `MutationObserver` to add the actions and status field when Gmail renders new message rows or opens a conversation.

The script deliberately avoids Gmail message IDs and thread IDs for the **portable search link**. Its purpose is to create a search that can also work in another recipient's Gmail account, provided that recipient has the same email and the subject is sufficiently distinctive.

Thread IDs may still be used **locally** as IndexedDB keys for the status note because that information never leaves the current browser.

## Files

```text
gmail-superpowers.user.js   Main Tampermonkey userscript
README.md                   Documentation
```
