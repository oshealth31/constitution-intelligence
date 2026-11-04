# Two-step sign-in: how-to for staff and organisation administrators

Two-step sign-in means that after your password you also type a 6-digit code from an app on your
phone. Someone who learns your password still cannot get in without your phone.

- **Constitution Intelligence staff (Super Admins):** required. The Control Centre stays closed
  until it is set up.
- **Organisation Owners and Administrators:** optional, and recommended. Turn it on in your
  portal under **My profile → Two-step sign-in**.
- Members and other roles do not see it.

Technical details: [authentication](../security/authentication.md#two-step-sign-in).

## What you need

A phone with an authenticator app. Any of these work: Google Authenticator, Microsoft
Authenticator, 2FAS, Aegis (Android), or a password manager that shows "one-time codes". The app
works without mobile data once it is set up. No text messages (SMS) are used.

## Setting it up (about 3 minutes)

1. Super Admins: sign in to the Control Centre; the setup steps open by themselves.
   Owners and Administrators: open your portal, then **My profile → Set up two-step sign-in**.
2. In the app, choose **Add account** (often a "+" button) and **scan the QR code** on the screen.
   If you are setting up on the same phone, or the camera does not work, choose "enter a setup
   key" in the app and type the key shown under the QR code.
3. The app now shows a 6-digit code for **Constitution Intelligence** that changes every 30
   seconds. Type it and press **Turn on two-step sign-in**.
4. You are shown **10 recovery codes**, once. Write them down or print them, and keep them away
   from your phone (for example at home with other important papers). Each one lets you sign in
   once if you lose your phone. Press **I have saved my recovery codes**.
5. You get an email saying two-step sign-in is on. Any other device where you were signed in is
   signed out.

## Signing in

1. Type your email address and password as usual.
2. Open the app and type the 6-digit code for Constitution Intelligence, then **Continue**.
   You have 5 minutes. If the code is refused, wait for the next one and try again; each code
   works once.
3. No phone with you? Choose **Use a recovery code instead** and type one of your recovery codes.
   You get an email saying a recovery code was used, and how many you have left.

## New recovery codes

When you have used some, or think someone saw them: **My profile** (Super Admins: Control Centre
→ **Support**) → **New recovery codes**, and type a current code. The old codes stop working.

## Turning it off (Owners and Administrators only)

**My profile → Turn off**, then type your password and a current code. You get an email. Super
Admins cannot turn it off.

## Lost or new phone

- **New phone, old phone still working:** Owners and Administrators turn it off and on again with
  the new phone. Super Admins ask another Super Admin for a reset (below), then set it up again.
- **Lost phone, recovery codes at hand:** sign in with a recovery code, then do the same as above.
- **Lost phone and no recovery codes:** contact Constitution Intelligence support. A Super Admin
  will **confirm who you are** (for example by calling you back on the number we have) and then
  reset it. You are signed out everywhere and can set it up again.

## For Super Admins: resetting someone's two-step sign-in

Control Centre → **Support** → **Reset someone's two-step sign-in**: their email address and a
reason (at least 10 characters, including how you confirmed who they are). This is recorded in
the audit log and the person is emailed. You cannot reset your own. If you are the only Super
Admin, follow [incident response → Lost phone](incident-response.md#lost-phone-two-step-sign-in).

Never reset because of an email or message alone: confirm by phone or in person first. Pretending
to have lost a phone is a common way to take over accounts.
