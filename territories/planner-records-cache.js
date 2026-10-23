// Incremental confirmed reads; local pending plans must never appear as saved.
export function createConfirmedRecordBuffer(records) {
  const queued = new Map();
  return snapshot => {
    for (const change of snapshot.docChanges({ includeMetadataChanges: true })) queued.set(change.doc.id, change);
    if (snapshot.metadata?.hasPendingWrites) return { pending: true, changed: false };
    let changed = false;
    for (const [id, change] of queued) {
      const data = change.doc.data();
      if (change.type === 'removed') records.delete(id);
      else records.set(id, { id, ...data });
      if (data.recordType !== 'territory-plan-chunk') changed = true;
    }
    queued.clear();
    return { pending: false, changed };
  };
}
