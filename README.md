# 2027 Colorado Convention Planning Map

Mobile-friendly planning map showing:

- Kingdom Hall locations within the 45-minute Colorado Convention Center planning area
- International delegate hotels in Downtown Denver, the Denver Tech Center, and RidgeGate
- Nearby RTD rail stations
- Separate full-map, hotel, Kingdom Hall, and rail-station views
- Apple Maps and Google Maps links for listed locations

## Public planning map

https://letdesignworks.github.io/colorado-convention-map/

## DTC Kingdom Hall bus-access review

https://letdesignworks.github.io/colorado-convention-map/bus-access/

The bus-access page is connected to the `convention-fs` Firebase project. Anyone can view the Hall map and public bus-access status. The approved administrator can sign in with Firebase Email/Password authentication to save:

- Public bus-access status
- Largest bus size reviewed
- Entrance, exit, turnaround, loading, parking, and overhead assessments
- Property-permission and onsite-verification status
- Public summary
- Private inspection notes, reviewer, and review date

Public Hall information is stored in the Firestore `halls` collection. Administrator-only inspection details are stored in the `reviews` collection.

## Publishing settings

In the repository, open **Settings → Pages** and select:

- **Source:** Deploy from a branch
- **Branch:** main
- **Folder:** /(root)

Then click **Save**.

## Updating the map

Replace `index.html` with the revised map file and commit the change. GitHub Pages will republish the same web address. Files for the bus-access application are in the `bus-access` folder.

## Planning note

Travel times and station proximity are planning estimates. Verify current RTD service, live travel conditions, and bus access onsite before final transportation assignments.
