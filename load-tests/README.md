# Field service load-test planner

Shared checklists use the convention website’s existing sign-in and private planning storage. Contact lists are stored privately and are not included in this public repository.

Each location has the October 24 branded schedule, host confirmation, auditorium access, territory delivery, packet log, literature examples and volunteer rosters. Download editable PDF exports the current entries as interactive AcroForm text fields and checkboxes. Open PDF to print opens the same document in the browser's PDF viewer. Changes made to the downloaded PDF remain in that file; web changes use Save changes.

Sample territory PDFs are optional, test-wide references. Attachments are split into private `reviews` records, verified with SHA-256 when read, and appended once to a complete-test export. No contact lists, territory address lists, or private samples belong in public assets. New locations leave unknown counts blank. Copying a future test resets checklist details, packet logs, and volunteers.

Import file creates a separate copy when IDs match. Update from backup stages a backup with the same ID as the selected saved test; review before Save changes. Saves retain the existing revision conflict check.

Run `node tests/load-tests.mjs` with the bundled `pdf-lib` dependency available to verify editable fields, saved checkbox values, long-note pagination, future-test resets and attachment integrity. The vendored browser library retains its upstream license in `vendor/`.
