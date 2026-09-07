# Gmail Superpowers

Tampermonkey userscript that adds quick actions to Gmail for copying a portable Gmail search based on the email subject.

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

The buttons are added dynamically, so they continue to appear while navigating Gmail without a full page reload.

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

## Current behavior

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

Gmail is a single-page application and its internal DOM can change over time. The script therefore uses a `MutationObserver` to add the actions when Gmail renders new message rows or opens a conversation.

The script deliberately avoids Gmail message IDs and thread IDs for the portable link. Its purpose is to create a search that can also work in another recipient's Gmail account, provided that recipient has the same email and the subject is sufficiently distinctive.

## Files

```text
gmail-superpowers.user.js   Main Tampermonkey userscript
README.md                   Documentation
```
