# Screen-reader check (task T2, manual part)

Automatic checks (axe-core on 25 pages, and the keyboard walkthrough in
`apps/web/e2e/keyboard.spec.ts`) find many problems, but not whether the site makes sense when
**listened to**. This 10–15 minute check needs a person with a phone. Use the test site with
fictional data.

## Turn the screen reader on

- **Android: TalkBack.** Settings → Accessibility → TalkBack → On. Swipe right/left to move
  between items, double-tap to activate. (Turn off the same way; or hold both volume keys for
  3 seconds if the shortcut is set up.)
- **iPhone: VoiceOver.** Settings → Accessibility → VoiceOver → On. Swipe right/left to move,
  double-tap to activate. (Or ask Siri "turn off VoiceOver".)

Practise for a minute on the phone's own settings screen first.

## Steps

Write ✅ (clear), ⚠️ (works but confusing; say what was read out), or ❌ (could not do it).

| #   | Do this                                                                 | Listen for                                                                       | Result |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------ |
| 1   | Open the portal sign-in page                                            | The organisation's name and "Sign in" as a heading                               |        |
| 2   | Move to the email field                                                 | "Email address, edit box" (not the whole sentence around it)                     |        |
| 3   | Type and sign in                                                        | It says you are signed in / reads the welcome heading                            |        |
| 4   | Swipe through the home page from the top                                | First item: "Skip to main content"; the menu items have clear names              |        |
| 5   | Open **Search**, search for "quorum"                                    | How many results were found; each result's clause number and title               |        |
| 6   | Open a result                                                           | The clause number and heading, then the text                                     |        |
| 7   | On a phone screen, open **Contents** in the reader                      | "Contents, dialog"; Close is read first; swiping stays inside the panel           |        |
| 8   | Close Contents                                                          | You are back on the Contents button                                               |        |
| 9   | Open **My profile**, move to a field with a hint below it               | The field's name first, then the hint as extra information                       |        |
| 10  | Make a mistake on purpose (for example a short new password) and submit | The error message is read out without having to look for it                      |        |
| 11  | Sign out                                                                | It confirms you are signed out                                                    |        |

## Results

| Date | Phone and screen reader | Tester | Results (by step number) | Notes |
| ---- | ----------------------- | ------ | ------------------------ | ----- |
|      |                         |        |                          |       |
