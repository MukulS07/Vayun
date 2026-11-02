# Assistant server: setup

The Assistant (phones and web) is answered by one Firebase Cloud Function, `ai`, in `functions/`. It
holds the owner's pool of keys, saves each person's own key encrypted, and applies a daily limit.
Keys never live in the app, the website or git.

## What it does

| Call | Purpose |
| --- | --- |
| `status` | Saved keys (last 4 characters only), free messages left, provider list |
| `saveKey` | Finds out which service a pasted key is for, tests it with one tiny request, saves it encrypted |
| `removeKey` | Deletes a saved key |
| `chat` | Answers with the person's own key (no limit), else the shared pool (daily limit), else the project's own Gemini |

### The order answers are tried in

1. The person's own key, if they saved one on the website (no daily limit).
2. **Your pool of keys**, in the order you list them. By default requests rotate over the keys to spread rate
   limits; set `AI_POOL_MODE=priority` to always start with the first key. A key that runs out or is rejected is
   rested for 5 minutes and the next key is tried.
3. **Firebase fallback:** only when every pool key failed, the project's own Gemini (Google Vertex AI) answers.
   It needs no key, is billed to the Firebase project, and counts as one of the person's daily messages.
   Turn it off with `AI_FALLBACK=off`.
4. If all of that fails, the person sees "very busy, try again in a few minutes" and the message is not counted.

Keys are recognised by their start: `sk-ant-` Anthropic, `sk-or-` OpenRouter, `xai-` xAI, `gsk_` Groq,
`nvapi-` NVIDIA, `AIza` Gemini, `sk-` OpenAI, and 32 hex characters for AI/ML API (no prefix, so the server
tests it with a real request before saving). Adding a service means one entry in
`desktop/app/ai-providers.js` (then `node tools/sync-ai.js`).

## One-time setup (about 10 minutes)

1. **Blaze plan.** Cloud Functions need the pay-as-you-go plan on the `vayun-12d1b` Firebase project
   (it has a free allowance). Set a budget alert in Google Cloud Billing.
2. **Install and sign in**
   ```bash
   npm install -g firebase-tools
   firebase login
   cd functions && npm install && cd ..
   ```
3. **Make the encryption secret** (32 random bytes). Copy the output when asked for `ENC_KEY` in the next step.
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
4. **Store the encryption secret.** It is asked for at the prompt and never written to a file in this repo.
   ```bash
   firebase functions:secrets:set ENC_KEY
   ```
5. **Add your pool keys** (as many as you like, up to 20). Copy `functions/pool-keys.example.json` to
   `functions/pool-keys.local.json` (git ignores it), paste a key on each line, then:
   ```bash
   node tools/set-pool-keys.js --dry-run   # checks the list and shows each key as service + last 4 characters
   node tools/set-pool-keys.js             # publishes it as the POOL_KEYS secret
   ```
   The service is worked out from each key, and a key that does not match the service you wrote is refused. To add
   another key later, add a line to the file and run the same two commands, then deploy again. Delete the local file
   when you are done if you like; the secret on the server is what counts. Use an empty list `[]` if you only want
   people to bring their own keys.
6. **Firebase fallback (Gemini, no key).** Enable the API and let the function use it:
   ```bash
   gcloud services enable aiplatform.googleapis.com --project vayun-12d1b
   gcloud projects add-iam-policy-binding vayun-12d1b --member=serviceAccount:578293090527-compute@developer.gserviceaccount.com --role=roles/aiplatform.user
   ```
   (That service account is the default one for second-generation functions; if you changed it, use yours.)
   Set a budget alert, because this fallback is billed to the project.
7. **Settings** (optional): create `functions/.env` (ignored by git) with any of
   ```
   AI_DAILY_LIMIT=20          # free messages per person per day (default 20)
   AI_POOL_MODE=round-robin   # or priority
   AI_FALLBACK=on             # or off
   AI_VERTEX_LOCATION=us-central1
   ```
8. **Deploy** (this also copies the provider list into `functions/` and publishes the Firestore rules that close
   the key and usage collections to every app):
   ```bash
   firebase deploy --only functions,firestore:rules
   ```
9. **Website page.** The page is `/ai-keys` (in the website project). Deploy the website as usual. To point at a
   different server address set `VITE_AI_URL`.
10. **App.** Tell the app where the website is, then build and install:
   ```bash
   VAYUN_SITE_URL=https://your-website node android-app/build.js android-app/app/src/main/assets/www
   ```
   (PowerShell: `$env:VAYUN_SITE_URL = "https://your-website"` first.) The Assistant's settings then show
   "Open the website".

## Safety notes

- Never paste a key into chat, an issue or a commit. `npm test` fails if a key-shaped string is committed.
- Saved keys are AES-256-GCM ciphertext in `users/{uid}/aiKeys/{provider}`. Only the function reads them. A
  superadmin can open the raw documents through the rules fallback but sees ciphertext only.
- Requests, answers and keys are never logged. Errors log only a code and a short message.
- Free use is limited per signed-in person per day, plus 30 requests per minute, 24,000 characters per request and
  2,000 answer tokens. Guests have no sign-in, so they cannot use the free allowance.
- Only providers' own policies apply to keys: use keys from accounts you own, and check each provider's terms
  before rotating several free keys to get around a free limit.

## Tests

`npm test` in `desktop/` runs `ai-providers.test.js` (key recognition, request and answer shapes, error sorting)
and `ai-core.test.js` (encryption, rotation, cooldown, daily limit, refunds) with fake keys and a fake network.
