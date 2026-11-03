# Public form links: setup and cost

A form made in Vayun can be shared as a web link. Anyone with the link fills it in on a plain web page (no account, no app),
and the answers come back to the form's dashboard in the app.

How it fits together:

- `functions/forms-core.js` holds the rules, `functions/forms-page.js` is the page people fill in, and `exports.forms` in
  `functions/index.js` is the one Cloud Function that serves both. Nothing needs hosting on the website.
- The app side is `desktop/forms-cloud.js` (the calls) and the **Web link** card on a form page (Build and Responses tabs).
- Documents: `publicForms/{id}` (the form and its counters) and `publicForms/{id}/responses/{n}`. `firestore.rules` closes both to
  every app and website; only the function reads or writes them.

## Deploy (you run these)

The Firebase project and sign-in are the same ones the Assistant server uses (see `ai-setup.md`). From the repository root:

```bash
firebase deploy --only functions:forms,firestore:rules
```

The first deploy prints the function's address, `https://us-central1-<project>.cloudfunctions.net/forms`. The links the app
makes are that address plus `/f/<form id>`.

## What it costs Firebase

The free plan allows 50,000 reads and 20,000 writes a day. Nothing runs in the background and nothing listens live.

| Action | Reads | Writes |
| --- | --- | --- |
| Someone opens the link | 0 (the form is kept in memory for a minute; at most 1 per server instance per minute) | 0 |
| Someone submits | 1 (+1 if the form was not in memory) | 2 |
| You open Responses or press Sync | 1, plus 1 per **new** response | 0 |
| Publish or update | 0 | 1 |

So the free plan covers roughly 10,000 submitted responses a day. Limits that keep one runaway link from using it up
(`LIMITS` in `functions/forms-core.js`):

- 5,000 responses in total and 1,000 per day for each form; after that the page says the form is full or busy.
- 25 published forms per person.
- A visitor can submit 12 times a minute and open the page 120 times a minute (per server instance).
- A submitted answer sheet is at most 20,000 characters, and every answer is checked against the published questions.

To change a limit, edit `LIMITS` and redeploy. A form's own total and daily caps are copied into its document when it is
first published, so edit those two fields on the document (`cap`, `dayCap`) to change an existing form.
