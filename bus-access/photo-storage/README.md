# Location photos: deployment and storage

The Bus Access page supports several interior and exterior photos per location,
thumbnail previews, editable captions, saved PDF selections, and a downloadable
US Letter PDF with saved public location details and selected photos. Existing
reviews, contacts, maps, traffic layouts, and public status records are separate.

## Enabled now

- Administrator-only photo controls, using existing Firebase sign-in.
- Device library: IndexedDB, isolated by Firebase user UID and location ID.
- Multiple JPG/PNG/WebP inputs, 20 MB input and 60 megapixel limits.
- Canvas re-encoding strips EXIF/GPS, limits the long edge to 2400 pixels and the
  stored JPEG to 2 MB; separate thumbnails are at most 200 KB.
- Captions and PDF inclusion persist with each photo. Up to 40 per location in
  each library. Failed saves are reported and are never labeled successful.
- PDF embeds the image bytes, so it remains printable without online photo links.
  Private contacts, internal notes, and unsaved review edits are excluded.
- Signed-out visitors can generate a public location summary without photos.

Device storage is not cloud backup or encryption against another person using
the same browser profile. Clearing site data, changing browsers, or moving to
another device does not preserve this library. Keep original photos. Sign-out
hides the library and revokes its display/PDF blob URLs; saved device data stays
available when the same administrator signs back in. Downloaded PDFs remain on
the device and should only be shared with the intended recipients.

## Shared storage configuration

On November 4, 2026, the owner approved and activated Blaze pay-as-you-go with
a $5 monthly project budget alert. Email alerts to billing admins and users
trigger at 50%, 90%, and 100% of actual spend. The account was upgraded from
trial-only to full pay-as-you-go so the service can continue after trial credits
expire. The alert does not cap spending.

The `convention-fs.firebasestorage.app` bucket is provisioned in `us-central1`,
with public access prevention enabled and the origin-specific CORS policy
published. Storage and Firestore rules are published using the existing
administrator UID verified in Firebase Authentication. The emulator suite
verifies access and preserves existing map/review behavior.
`photos-config.mjs` enables shared photos in this release. Shared storage is
the default after administrator sign-in; device-only photos remain available
through the library selector and can be copied to shared storage.

Recommended architecture:

1. Keep the public static site on GitHub Pages and existing Firebase Auth.
2. Store image and thumbnail blobs in private Firebase Storage at
   `bus-location-photos/{encodedLocationId}/{photoUuid}/photo.jpg` and `thumb.jpg`.
3. Store metadata in the existing private Firestore `reviews` collection in a
   dedicated `photo-library-{encodedLocationId}` document. This avoids overwriting
   each location's review and contacts. Transactions modify one photo at a time.
4. Authorize reads and writes server-side for the approved administrator UID.
   The email check in the browser is UI behavior, not an access-control boundary.
5. Read bytes through authenticated `getBlob` and temporary browser blob URLs.
   Do not publish Firebase download-token URLs, Drive share URLs, or image files
   in the public repository. PDFs are produced locally in the browser.

Deployment and verification sequence (also use for future reprovisioning):

1. Approve/link Firebase Blaze billing and choose budget alerts. Alerts are not
   a spending cap. Review current prices and storage location before provisioning.
2. Provision the expected `convention-fs.firebasestorage.app` bucket in
   `us-central1` with Standard storage (or update the existing Firebase
   configuration if Firebase assigns a different name). This matches the
   existing Firestore region and qualifies for the regional Storage free tier.
3. Reconfirm the administrator UID in `storage.rules`. Merge this path into the
   actual bucket's rules without replacing rules
   needed by other features. Remove overlapping public grants for this path.
4. Inspect the deployed Firestore rules before publishing `firestore.rules`.
   The supplied file preserves the rules read from the console on November 4,
   2026 and restricts the photo prefix by UID. Ensure the `reviews/photo-library-*`
   records are readable/writable only by the same administrator, including direct
   requests. A narrower rule cannot override a broader permissive match. Keep
   the public `halls` permissions and all unrelated records unchanged.
5. Apply the origin-specific `cors.json` to this bucket; add localhost only to a
   development bucket. CORS does not replace authentication or security rules.
6. Verify in Firebase emulators or a dedicated test environment: unauthenticated
   and other-user reads/writes denied; approved-user upload/read/delete allowed;
   invalid content types and oversize uploads denied; metadata private; no public
   object ACLs or token links. Check App Check in monitoring mode before enforcing
   it, to avoid blocking existing clients.
7. Set `SHARED_PHOTOS_ENABLED = true`, deploy, and test with disposable synthetic
   photos. Verify upload, reload from another browser/device, selections, PDF,
   deletion, sign-out, and denied access. Only then use real location photographs.
8. Shared storage becomes the default library at administrator sign-in. Device
   libraries offer **Copy selected photos to shared storage** once enabled.
   Copies preserve device originals; switch libraries to confirm shared results.

Storage and Firestore are not one atomic service. Uploads finish before metadata
is committed; failures can leave private orphan objects, not broken saved entries.
Deletion removes metadata first and reports any object-cleanup failure. Periodic
administrator maintenance should remove orphaned UUID folders after checking
metadata, and clean up a removed location's independent photo libraries. Location
removal deliberately does not silently destroy stored photos.

## Why not personal Google Drive links?

Drive is useful for keeping original photos and exported PDFs. It is a weaker fit
as this application's image backend: private files need Google OAuth permissions,
Drive thumbnail links expire, and the API says they are not intended for direct
web use because of CORS. Public share links would expose those images to anyone
with the link. A robust private Drive integration needs an authorized backend or
proxy and additional ownership/token management.

Firebase Storage fits the Auth and Firestore already in this site. Cloudflare R2
with a Worker that verifies Firebase ID tokens, private objects, per-location
authorization, rate limits, and short-lived access is a reasonable alternative,
but adds another service and backend to maintain. Do not put R2 credentials or
Google service-account credentials in browser JavaScript or GitHub.

## Expected photo costs

At the application's maximum saved size, 30 locations with 40 photos each use
about 2.8 GB including thumbnails (2 MiB + 200 KiB per photo). Ordinary private
use is expected to cost $0 per month while the account remains within the free
allowances; this is an estimate, not a guarantee or spending limit.

For a new `firebasestorage.app` bucket, current no-cost allowances include 5 GB
of monthly storage, 100 GB of monthly downloads, 5,000 upload operations, and
50,000 download operations. Storage free-tier eligibility is restricted to
`us-central1`, `us-east1`, and `us-west1`; allowances aggregate across eligible
usage, and the free download allowance excludes Australia and China. Existing
project/account usage, retained deleted versions, and repeated downloads also
count. Firestore metadata has separate quotas and charges.

A project-scoped $5 monthly budget alert is configured with actual-spend
notifications at 50%, 90%, and 100%. It covers all services in this project and
applies selected credits before comparing spend to the budget. A budget alert
does not stop usage or cap charges. Review all project services when enabling
or changing Blaze billing.

References (reviewed November 4, 2026):

- https://firebase.google.com/docs/storage/web/download-files
- https://firebase.google.com/docs/storage/security
- https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024
- https://developers.google.com/workspace/drive/api/reference/rest/v3/files
- https://firebase.google.com/pricing
- https://cloud.google.com/storage/pricing
- https://cloud.google.com/billing/docs/how-to/budgets

## Verification

Run `node --test tests/bus-photos.test.mjs tests/bus-photos-ui.test.mjs`.
The device and UI tests use `fake-indexeddb` and `jsdom`. Cloud adapter tests use
isolated fakes; they do not assert that production rules or billing are ready.
Run the existing Bus Access model, boundary, UI, and PDF tests for regressions.

The server-rule tests require Java 21+, Firebase CLI, `firebase` 12.x, and
`@firebase/rules-unit-testing` 5.x. From the repository root, run:

```sh
firebase emulators:exec --project demo-bus-photos --only firestore,storage --config bus-access/photo-storage/firebase.json "node --test tests/bus-photo-rules.emulator.mjs"
```

The five emulator tests passed on November 4, 2026. They cover authorized
upload/read/delete from separate client contexts, denial for signed-out users
and other UIDs (including another UID with the same email), image type/size/path
limits, private photo metadata, and unchanged public map/admin review access.
The test checks local emulator addresses before running and uses a demo project;
it does not verify production deployment or actual device synchronization.

Live verification on November 4, 2026 completed after deployment: synthetic
interior/exterior uploads, thumbnail loading, saved captions, reopening the
shared library in a fresh tab, and persisted PDF selection changes all passed.
A two-page PDF was generated and downloaded with only the selected image.
Firebase's bounded `getBlob` download can omit the Blob MIME label, so the PDF
exporter validates JPEG bytes and includes a regression test for this case.
Direct anonymous requests to the saved image through both Firebase and Cloud
Storage endpoints, and to its Firestore metadata, returned HTTP 403. Published
Storage rule simulations allowed the administrator UID and denied another UID
and signed-out access. Both synthetic photos were removed with successful file
cleanup and the shared library returned to zero entries. Physical second-device
sign-in was not tested; the live persistence check used a fresh browser tab.
