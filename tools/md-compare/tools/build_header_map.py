#!/usr/bin/env python3
"""
Generate src/Headers.js from the California Revealed Metadata Dictionary.

Usage:
    python3 tools/build_header_map.py DICTIONARY.xlsx > src/Headers.js

Reads sheet "ADO_Dictionary-Records", pairing column "Field Name"
(human-readable) with "Machine Name (Exports)" (machine-readable). Rows missing
either value are skipped and reported on stderr.

Local additions belong in the HEADER_ALIASES block, not in the generated list —
this script overwrites the whole file, so re-add them after regenerating.
"""

import json
import re
import sys
from collections import Counter

try:
    import openpyxl
except ImportError:
    sys.exit('openpyxl is required: pip install openpyxl')

SHEET = 'ADO_Dictionary-Records'
HUMAN_HEADER = 'Field Name'
MACHINE_HEADER = 'Machine Name (Exports)'
COUNT_HEADER = 'Number of values'
DELIMITER_HEADER = 'Delimiter Character'

# Emitted verbatim into the HEADER_ALIASES block. Re-add any local entries here
# after a dictionary revision, since this script overwrites the whole file.
ALIAS_BLOCK = """  // The dictionary spells this \"Archipealgo UUID\"; accept the correct spelling too.
  'Archipelago UUID': 'node_uuid_no_changes',
  'UUID': 'node_uuid_no_changes'"""


def loose(s):
    """Mirror of looseHeader_() in Code.js."""
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    path = sys.argv[1]

    wb = openpyxl.load_workbook(path, data_only=True)
    if SHEET not in wb.sheetnames:
        sys.exit('Sheet "%s" not found in %s' % (SHEET, path))
    ws = wb[SHEET]

    header = [str(ws.cell(row=1, column=c).value or '').strip()
              for c in range(1, ws.max_column + 1)]
    try:
        h_col = header.index(HUMAN_HEADER) + 1
        m_col = header.index(MACHINE_HEADER) + 1
        n_col = header.index(COUNT_HEADER) + 1
        d_col = header.index(DELIMITER_HEADER) + 1
    except ValueError:
        sys.exit('Expected columns "%s", "%s", "%s" and "%s" in row 1; found: %s'
                 % (HUMAN_HEADER, MACHINE_HEADER, COUNT_HEADER, DELIMITER_HEADER, header))

    pairs, skipped, delimiters = [], [], []
    missing_delimiter = []
    for r in range(2, ws.max_row + 1):
        human = ws.cell(row=r, column=h_col).value
        machine = ws.cell(row=r, column=m_col).value
        human = str(human).strip() if human is not None else ''
        machine = str(machine).strip() if machine is not None else ''
        if human and machine:
            pairs.append((machine, human))
            # A field is multi-value when the dictionary says so, and each one
            # records the character that separates its values. Both come from
            # the dictionary rather than a list maintained here, so a field
            # that becomes repeatable in a later draft is picked up for free.
            count = ws.cell(row=r, column=n_col).value
            delim = ws.cell(row=r, column=d_col).value
            count = str(count).strip().lower() if count is not None else ''
            delim = str(delim).strip() if delim is not None else ''
            if count.startswith('multiple'):
                if delim:
                    delimiters.append((machine, delim))
                else:
                    missing_delimiter.append(machine)
        elif human or machine:
            skipped.append((r, human or '(blank)', machine or '(blank)'))

    if missing_delimiter:
        print('multi-value fields with no delimiter recorded, skipped: %s'
              % ', '.join(missing_delimiter), file=sys.stderr)

    # Fail loudly on ambiguity rather than generating a map with silent collisions.
    problems = []
    for label, counts in (('machine name', Counter(m for m, _ in pairs)),
                          ('human label', Counter(h for _, h in pairs)),
                          ('normalised machine name', Counter(loose(m) for m, _ in pairs)),
                          ('normalised human label', Counter(loose(h) for _, h in pairs))):
        dupes = [k for k, v in counts.items() if v > 1]
        if dupes:
            problems.append('duplicate %s: %s' % (label, ', '.join(sorted(dupes))))

    machine_by_loose = {loose(m): m for m, _ in pairs}
    cross = [(h, machine_by_loose[loose(h)]) for m, h in pairs
             if loose(h) in machine_by_loose and machine_by_loose[loose(h)] != m]
    if cross:
        problems.append('human label collides with another field\'s machine name: %s' % cross)

    if problems:
        sys.exit('Dictionary is ambiguous, refusing to generate:\n  ' + '\n  '.join(problems))

    for row, human, machine in skipped:
        print('skipped row %d: %s / %s' % (row, human, machine), file=sys.stderr)
    print('%d pairs, %d multi-value fields' % (len(pairs), len(delimiters)), file=sys.stderr)

    body = ',\n'.join('  [%s, %s]' % (json.dumps(m), json.dumps(h, ensure_ascii=False))
                      for m, h in pairs)
    delim_body = ',\n'.join('  [%s, %s]' % (json.dumps(m), json.dumps(d, ensure_ascii=False))
                             for m, d in delimiters)
    out = sys.stdout
    out.write('''/**
 * CA-R machine-readable \u2194 human-readable header pairs.
 *
 * Generated from the California Revealed Metadata Dictionary,
 * sheet "%s", columns "%s" (human-readable) and
 * "%s" (machine-readable).
 *
 * Source: %s
 * Pairs: %d
 * Multi-value fields: %d
 *
 * To regenerate after a dictionary revision, see tools/build-header-map.md.
 * Do not hand-edit this list \u2014 put local additions in HEADER_ALIASES below.
 */

var HEADER_PAIRS = [
%s
];

/**
 * Local additions and corrections that are not in the dictionary, or that the
 * dictionary spells differently from what partners actually send.
 * Format: 'whatever the header might say': 'machine_name'
 */
var HEADER_ALIASES = {
%s
};

/**
 * Fields the dictionary marks as taking multiple values, with the character
 * that separates them. Used to forgive spacing around the delimiter, so that
 * "Smith, J;Jones, K" and "Smith, J; Jones, K" read as the same list.
 */
var FIELD_DELIMITERS = [
%s
];
''' % (SHEET, HUMAN_HEADER, MACHINE_HEADER, path.split('/')[-1], len(pairs), len(delimiters),
       body, ALIAS_BLOCK, delim_body))


if __name__ == '__main__':
    main()
