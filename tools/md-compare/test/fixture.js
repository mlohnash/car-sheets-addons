/**
 * Synthetic two-sheet fixture. No partner data is committed to this repo.
 *
 * The incoming sheet is deliberately built with a different column order and a
 * different row order from the current sheet, and carries a handful of edits.
 */

const FIELDS = [
  'node_uuid_no_changes',
  'obj_call_number',
  'obj_temporary_id',
  'label',
  'obj_created_date__date_free',
  'obj_alternative_title',
  'obj_print_item_parts__ip_print_format',
  'obj_workflow_state__label',
  'obj_notes_to_vendor'
];

const N = 40;

function uuid(i) {
  const h = (100000 + i * 7919).toString(16);
  return h.padStart(8, '0') + '-0000-4000-8000-00000000' + String(i).padStart(4, '0');
}

function baseRow(i) {
  return [
    uuid(i),
    'REEL_' + String(i).padStart(3, '0'),
    'item_' + String(i).padStart(3, '0') + '.pdf',
    'Test Object ' + i,
    { __date__: '199' + (i % 10) + '-06-0' + ((i % 9) + 1) + 'T00:00:00' },
    '',
    'periodical',
    'Physical Received',
    'Internal processing note'
  ];
}

const current = [FIELDS.slice()];
for (let i = 1; i <= N; i++) current.push(baseRow(i));

// Incoming: partner-returned corrections, reordered rows and columns.
const COLUMN_ORDER = [3, 0, 6, 4, 1, 5, 7, 2, 8];
const incomingRows = [];
for (let i = N; i >= 1; i--) {            // reverse row order
  const r = baseRow(i);
  if (i === 4) r[1] = 'REEL_004_CORRECTED';        // call number correction
  if (i === 9) r[5] = 'An alternative title';      // populated a blank field
  if (i === 12) r[6] = 'Periodical';               // case-only change
  if (i === 17) r[3] = 'Test Object 17 ';          // trailing whitespace
  if (i === 21) r[4] = { __date__: '1994-01-15T00:00:00' };  // date change
  r[7] = 'Accepted';                               // systematic, every record
  r[8] = '';                                       // systematic, every record
  incomingRows.push(r);
}

const incoming = [COLUMN_ORDER.map(i => FIELDS[i])];
incomingRows.forEach(r => incoming.push(COLUMN_ORDER.map(i => r[i])));

module.exports = { FIELDS, N, current, incoming };
