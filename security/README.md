# Planning account permissions

This GitHub Pages site uses Firebase Authentication and Firestore. The owner UID is protected in both the client model and server rules. Other users must verify their email and have an enabled email-matched policy in `reviews/site-access-<lowercase email>`.

## Activation

1. Run the **Check planning access rules** GitHub Actions workflow and confirm it passes. It uses a local Firebase emulator and no production credentials or data.
2. Back up the existing Firestore rules in the Firebase console for project `convention-fs`.
3. Publish `security/firestore.rules` in **Firestore Database → Rules**. `bus-access/photo-storage/firestore.rules` is an identical compatibility copy.
4. Open `/access/`, sign in with the existing main account, and use **Check setup**. The capability probe uses a server read; invited access fails closed before the rules are installed.
5. Add each user's email and choose section permissions. Users create their own login on `/access/`, verify their email, and sign in. No passwords are stored in Firestore. Saving a policy does not create a Firebase Auth user or send an invitation email.

Disabling a policy removes its shared access. Deleting an Auth account, changing its email, or resetting someone else's password remains a Firebase Authentication console operation. The owner cannot lock itself out using this access screen.

Public map records in `halls` and static maps/data remain public. “Public only” removes private reads and shared edits, not access to information already published publicly. The Operating Plan remains a separate application with its own plan password. Shared photos retain the existing owner-only Storage rules; this change does not require new cross-product Storage permissions.

Read queries must be filtered by authorized record types. Editors cannot change a record's type, overwrite another section, grant themselves permissions or access another user's policy. Owner-only legacy record types remain owner-only. Custom meeting location creation in South DTC Rail requires Bus Access & Meeting Locations editing permission.
