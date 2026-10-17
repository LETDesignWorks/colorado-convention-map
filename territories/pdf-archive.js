// PDF copies stay in the same private store as the plans. Split payloads well
// below the document limit; the small library record is published only last.
// Increment when PDF contents/layout change so saved downloads rebuild too.
export const PDF_LAYOUT_VERSION = 33;
export async function makePdfArchive(id, blob, snapshot, metadata = {}) {
  const parts = [];
  const addPart = (kind, data, index) => {
    const prefix = metadata.payloadRevision ? `${id}__${metadata.payloadRevision}` : id;
    const partId = `${prefix}__${kind}_${String(index).padStart(4, '0')}`;
    parts.push({ id: partId, recordType: 'territory-pdf-part', archiveId: id, kind, index, data });
    return partId;
  };
  const pdf = new Uint8Array(await blob.arrayBuffer());
  const pdfPartIds = [];
  for (let offset = 0; offset < pdf.length; offset += 150000) {
    const bytes = pdf.subarray(offset, offset + 150000);
    let binary = '';
    for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
    pdfPartIds.push(addPart('pdf', btoa(binary), pdfPartIds.length));
  }
  const json = JSON.stringify(snapshot), snapshotPartIds = [];
  for (let offset = 0; offset < json.length;) {
    let end = Math.min(json.length, offset + 150000);
    // Keep surrogate pairs together through Firestore's UTF-8 transport.
    const last = json.charCodeAt(end - 1);
    if (last >= 0xD800 && last <= 0xDBFF) end--;
    snapshotPartIds.push(addPart('snapshot', json.slice(offset, end), snapshotPartIds.length));
    offset = end;
  }
  return { parts, record: { ...metadata, id, recordType: 'territory-pdf', formatVersion: 1,
    pdfPartIds, snapshotPartIds, pdfBytes: pdf.length, snapshotCharacters: json.length } };
}

function orderedParts(record, parts, kind) {
  const ids = kind === 'pdf' ? record.pdfPartIds : record.snapshotPartIds;
  if (!Array.isArray(ids) || !ids.length) throw new Error('This saved PDF is missing its file information.');
  const byId = new Map(parts.map(part => [part.id, part]));
  return ids.map((id, index) => {
    const part = byId.get(id);
    if (!part || part.archiveId !== record.id || part.kind !== kind || part.index !== index || typeof part.data !== 'string') {
      throw new Error('The saved PDF data is incomplete. Please try loading it again.');
    }
    return part.data;
  });
}
export function readArchivePdf(record, parts) {
  const bytes = orderedParts(record, parts, 'pdf').map(data => Uint8Array.from(atob(data), character => character.charCodeAt(0)));
  const blob = new Blob(bytes, { type: 'application/pdf' });
  if (blob.size !== record.pdfBytes) throw new Error('The saved PDF file is incomplete. Please try again.');
  return blob;
}
export function readArchiveSnapshot(record, parts) {
  const json = orderedParts(record, parts, 'snapshot').join('');
  if (json.length !== record.snapshotCharacters) throw new Error('The saved territory data is incomplete. Please try again.');
  const snapshot = JSON.parse(json);
  if (!snapshot.territory?.id || !Array.isArray(snapshot.houses) || !snapshot.hall?.id || !snapshot.congregation) {
    throw new Error('The saved territory is missing its Hall, congregation, or addresses.');
  }
  return snapshot;
}
