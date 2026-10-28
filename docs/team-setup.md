# Switching on teams (one time, about 5 minutes)

Teams keep their data (teams, tasks, team events, member names) in **Cloud Firestore**, inside Vayun's own Firebase
project (`vayun-12d1b`). Personal pages and notes never go there; they stay on each person's PC. Do the steps below once,
and everyone who uses Vayun gets teams.

## 1. Create the database

Firebase console → **Build → Firestore Database → Create database**.

- Edition: **Standard**.
- Location: the region closest to your people. **It cannot be changed later.** For India, `asia-south1` (Mumbai).
- Start in **production mode** (the rules in step 2 replace the default).

## 2. Publish the rules

Firestore Database → **Rules** tab → replace everything with the contents of [`firestore.rules`](../firestore.rules) →
**Publish**. These rules are what stop a member from assigning tasks, or a stranger from reading a team, so do not skip them.

## 3. Let the Firebase key use Firestore

Google Cloud console → **APIs & Services → Credentials** → the *Browser key (auto created by Firebase)* → **API restrictions**.
The list must include **Cloud Firestore API**. If you narrow the key, keep these three: **Identity Toolkit API**,
**Token Service API** and **Cloud Firestore API**.

## 4. Stay on the free plan

Keep the project on Firebase's free **Spark** plan and do not add a billing account, so nothing can be charged.

| Free each day | Limit |
| :--- | :--- |
| Documents read | 50,000 |
| Documents written | 20,000 |
| Storage | 1 GiB in total |

If a day's limit is passed, team sync pauses until it resets (midnight Pacific time) and nothing is billed. Vayun checks
for changes about once every 90 seconds, only while its window is in use, so a small team stays far below the limit.

## 5. First use

- People who signed in before teams existed see **One more sign-in needed** on the Team page. One click on
  **Sign in again** fixes it.
- The head opens **Team → Start a team**, then shares the 8-character **invite code** from **Members**. Everyone else
  uses **Join a team** and types the code.

## Trying it without Firebase

A built-in demo team lets you click through the whole page with no setup and no network.

```bash
# the signed-in person is the head of a demo team
VAYUN_TEAM_BACKEND=memory npm start

# the signed-in person is a member whose tasks were given by someone else
VAYUN_TEAM_BACKEND=memory VAYUN_TEAM_DEMO=member npm start
```

```powershell
$env:VAYUN_TEAM_BACKEND = 'memory'; npm start
```

## Where things are

| File | What it does |
| :--- | :--- |
| `firestore.rules` | Who may read and change what in the database |
| `desktop/app/team-logic.js` | The same permission rules in code, plus sorting and grouping |
| `desktop/team-service.js` | Keeps a local copy and checks for changes on a schedule |
| `desktop/team-store-firestore.js` | The only code that talks to Firestore (`team-store-memory.js` is the reference it must match) |
| `desktop/app/team.js` | The Team page |

To move to another backend later, write a new store with the same methods as `team-store-memory.js`; the shared tests in
`desktop/test/helpers/team-contract.js` say what it has to do.
