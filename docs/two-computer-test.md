# Testing teams on two separate computers

Do this once, with two people (or you on two machines). It takes about ten minutes. Computer A is the admin, computer B
is the person who joins. They can each run the desktop app, the web version, or one of each.

1. **A:** open Vayun (desktop v1.0.7 or the web version), sign in with Google, go to **Team → Start a team**, and give it a
   name. Open **People** and copy the invite code.
2. **B:** open Vayun, sign in with a **different** Google account, **Team → Join a team**, and type the code.
   - Expected: B joins as a **member**. A wrong code is refused.
3. **A:** **New task**, assign it to B, tick **Must do**, pick a due date.
   - Expected on B within about a minute (or at once after clicking the window): the task appears, and on **Home** it is the
     *Start here* card, with the reminder popup.
4. **B:** start the task, then finish it.
   - Expected on A: the status changes to Doing, then Done.
5. **B tries things a member must not do:** rename the task, create a task, add a team event, change a role.
   - Expected: every one is refused.
6. **A:** in **People**, make B a **lead**. On B, give someone a task and add a team event: both work. Try editing A's task: refused.
7. **A:** make B a **member** again. Expected: B can no longer give tasks.
8. **B:** **Leave team**, then join again with the code. **A** tries to leave: refused (the owner cannot leave).
9. Sign out on one computer, sign in on the other: no one sees the other's team data left behind.

Clean up afterwards: in the Firebase console → Firestore Database → Data, delete the test team.
