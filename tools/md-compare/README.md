# CA-R Metadata Sheet Comparator

A Google Apps Script add-on for California Revealed that compares two metadata
spreadsheets and reports which records and which fields changed.

Records are matched on a stable key and columns are matched on header name, so
**neither sheet has to be sorted the same way and neither has to have its
columns in the same order**. Column headers may be machine-readable
(`obj_call_number`) or human-readable (`Call Number`) on either side — both
resolve to the same field via the CA-R Metadata Dictionary. This replaces the
positional `=IF(A2<>A2, …)` comparison grid, which silently produces garbage the
moment either sheet is sorted or a column is inserted.

---

## What it does

Given a **current** sheet (California Revealed processing metadata) and an
**incoming** sheet (partner-returned corrections), it writes three tabs into
the active spreadsheet, then writes your accepted corrections back to the
current sheet for you.

**`Diff_Grid`** — one row per record that has at least one difference. Columns
are the matching key, some locator fields, and then **only those fields that
differ somewhere in the set**. A 380-column comparison collapses to a grid you
can actually read.

| node_uuid_no_changes | key_field | diff_count | row_current | row_incoming | obj_call_number | obj_alternative_title |
|---|---|---|---|---|---|---|
| 31737ff4-ee22-… | node_uuid_no_changes | 8 | 165 | 165 | CURRENT:  DVD11705<br>INCOMING: VT10505 | CURRENT:  Ultimate Pincurlz 2006, Part two<br>INCOMING: (empty) |
| 9abdf31e-d968-… | node_uuid_no_changes | 1 | 503 | 503 | | |

Differing cells are shaded; matching cells are left blank. Set the diff cell
format to **incoming only** and the grid becomes a paste-ready sheet of just
the corrected values.

**`Diff_Review`** — the working tab, and the one to spend time in. One row per
differing cell, with the two values in their own labelled columns:

| # | key | field | field_label | row_current | row_incoming | current_value | incoming_value | decision | value_to_apply | result |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 31737ff4-… | obj_call_number | Call Number | 165 | 165 | DVD11705 | VT10505 | skip | VT10505 | |
| 8 | 31737ff4-… | obj_av_item_parts__ip_call_number | Item Call Number | 165 | 165 | DVD11705 | | skip | | |

Rows are grouped by field, so 28 records carrying the same edit are judged once
rather than 28 times. `decision` is a dropdown — `apply` or `skip`, nothing
else — and **every line starts on `skip`**, so nothing reaches the current
sheet until you have looked at it and marked it. Select a run of rows and type
`apply` once to accept a whole field's worth at a time.
`value_to_apply` starts as the incoming value and is yours to overwrite: type
anything there and that is what gets written, which covers the case where
neither side is quite right. A filter is switched on so you can sort or narrow
by field, key, or decision.

Then **CA-R Tools → Apply reviewed MD updates** writes every `apply` line back
into the current sheet and stamps the outcome in `result`. See
[Applying changes back](#applying-changes-back).

**`Diff_KeyMatches`** — written only when key normalisation was used. Every
pairing it produced, with both original key values in separate columns.

**`Diff_Summary`** — the run record: which key field was used and why, row and
column counts for both sheets, fields that could not be compared because they
exist on only one side, records present on only one side, duplicate keys, rows
with a blank key, and a per-field difference count ranked by frequency.

Both tabs are cleared and rewritten on each run.

---

## Applying changes back

**CA-R Tools → Apply reviewed MD updates** reads `Diff_Review`, shows a
confirmation with the counts, and on Yes writes each `apply` line's
`value_to_apply` into the current sheet — including a sheet in another file,
if that is where the comparison was pointed.

**The current sheet is edited in place** — there is no working copy. Before the
first write, the target tab is duplicated as
`<name>_backup_YYYY-MM-DD_HHMM` in the same spreadsheet, so the state you
started from is one click away. A dry run takes no backup, and neither does a
run with nothing to write. Set `BACKUP_BEFORE_APPLY` to `false` to turn it off.

Every write is guarded. The cell in the current sheet must still hold exactly
the value the report recorded as `current_value`; if it doesn't, that line is
marked **stale** and left alone rather than overwritten with a decision made
against outdated information. Lines whose record has since been deleted, or
whose key now appears twice, are reported instead of guessed at. Nothing is
written until every line has been checked, so a run either reports a problem or
does the whole job.

The `result` column records what happened to each line — `applied` with a
timestamp, `skipped`, `stale — the current sheet now holds "…"`, or the reason
it couldn't be matched. Re-running the comparison afterwards should show only
the lines you deliberately skipped.

Two limits worth knowing. `MAX_APPLY_CELLS` (default 2,000) refuses an
implausibly large write, on the theory that a decision column set wrong is more
likely than a genuine 5,000-cell correction. And values above
`MAX_APPLY_CHARS` (45,000) are marked in the review sheet and forced to `skip`,
because a truncated value written back would silently corrupt the record.

---

## Header translation

Headers are resolved before anything is compared, in this order:

1. **Exact machine-readable name** — `obj_call_number`, used verbatim.
2. **Machine-readable name, loosely matched** — case and punctuation drift such
   as `Obj_Call_Number` or a trailing space.
3. **Human-readable label** — `Call Number`, translated to `obj_call_number`
   using the 402 field pairs in `src/Headers.js`, generated from the
   Metadata Dictionary. Matching here is loose too, so `CALL NUMBER `,
   `call number`, and `Call Number` all resolve.
4. **Unrecognised** — kept as-is and **still compared**, provided the header
   appears in both sheets. Unrecognised headers on both sides are matched
   loosely against each other, so `Local Shelf Note` lines up with
   `local shelf note`.

Either sheet can be headed either way, and the two do not have to agree. A
partner sheet headed entirely in human-readable labels compares correctly
against a machine-readable DAMS export, and the report is identical either way.

The grid always uses machine-readable names as column headings, since that is
what feeds back into the DAMS. Hover any heading for a note giving the
human-readable label and the header text as it actually appeared in each sheet.
Unrecognised columns get a distinct heading colour so they are obvious rather
than silently trusted.

The summary lists every translation performed and every unrecognised header,
per sheet. The **Fields to ignore** box accepts either form —
`Workflow State` and `obj_workflow_state__label` both work.

Set `CONFIG.TRANSLATE_HEADERS = false`, or clear the dialog checkbox, to compare
headers as literal text.

### Keeping the map current

`src/Headers.js` is generated. After a dictionary revision:

```bash
python3 tools/build_header_map.py /path/to/DICTIONARY.xlsx > src/Headers.js
node test/test.js
```

The generator refuses to write an ambiguous map — it checks that machine names,
human labels, and their normalised forms are each unique, and that no human
label collides with another field's machine name. Draft2_202607 is clean on all
four checks. Local additions go in the `HEADER_ALIASES` block; see
`tools/build-header-map.md`.

---

## Matching key

The first of these present **and populated** in both sheets is used (after
header translation, so the key column may be headed either way):

1. `node_uuid_no_changes`
2. `obj_call_number`
3. `obj_temporary_id`

Object ID fields are deliberately not used, since they are not stable across
the processing cycle. The summary records which key was chosen and why each
earlier candidate was skipped. You can also force a specific key from the
dialog.

A candidate has to do more than exist. It must be present in both sheets,
populated in both, **and** have values that actually appear in both — two
sheets can each carry a full column of temporary IDs under different naming
conventions (`J003-D.pdf` against `J003-D_prsv.pdf`), in which case matching on
it produces nothing at all. A candidate with zero overlap is skipped, and if no
candidate survives the run stops with an error and writes nothing rather than
producing an empty report that looks clean. Forcing a key in the dialog
overrides the overlap check.

### When nothing matches

If no candidate key pairs a single record, the run stops and offers key
normalisation rather than failing outright. It looks for **describable
omissions** that would make the two columns meet — ignoring file extensions,
removing a naming-convention token that one side carries and the other does
not, ignoring punctuation — and hands back a proposal.

Nothing is compared until you agree. The dialog shows which field, each
proposed omission with the evidence for it (`"prsv" appears in 53% of incoming
keys and 0% of current ones`), worked before-and-after examples, how many
records it would pair, and how many it would render ambiguous.

The omissions apply **only to deciding which record is which**. Field values
are compared, displayed, and written back untouched.

On consent, a **`Diff_KeyMatches`** tab lists every pairing with both original
key values in separate columns and the normalised form they met on, plus
everything that still failed to pair and anything ambiguous. Normalisation
pairs records that do not literally agree, so that tab is how the claim gets
checked.

Two guards keep it honest. A token must appear in at least
`MIN_KEY_RULE_SUPPORT` keys (default 3) before it counts as a convention —
without that floor, a token belonging to a single record looks identical to a
convention on a small sheet, and removing it pairs two unrelated records.
And an omission is only proposed if it measurably increases the number of
records paired; the search applies everything and then prunes back to the
narrowest set that still works, so nothing is asked for that isn't doing work.

The summary always states the match rate, and flags the run when it falls below
`LOW_MATCH_WARNING` (default 50%). A zero-match run is labelled **NOTHING
MATCHED** in every output tab — never "no differences found", which means the
opposite thing.

Keys are trimmed before matching, and by default matched case-insensitively
(set `CONFIG.KEY_MATCH_CASE_SENSITIVE = true` to change that). If a key appears
more than once on either side, the copies are paired in document order, the
duplication is flagged in the summary, and any unpaired copies are reported as
one-sided records.

---

## Comparison rules

Comparison is **exact by default**. Trailing whitespace and letter case count
as differences — `periodical` and `Periodical` are reported, as is
`Not Reported ` against `Not Reported`. Those are real drifts worth catching in
a DAMS export.

When a partner return is full of them, two settings relax the match test:

| `IGNORE_WHITESPACE` | Matches |
|---|---|
| `'none'` | exact; a trailing space is a difference |
| `'edges'` | ignores leading and trailing whitespace |
| `'all'` | also collapses repeated internal whitespace |

`IGNORE_CASE` does the same for letter case, independently.

**`MULTIVALUE_DELIMITER_SPACING`** (on by default) handles the case those two
miss. For the 347 fields the Metadata Dictionary marks as multi-value —
creator roles, subject topics, spatial coverage and the rest — the space either
side of the delimiter is ignored, so `Smith, J;Jones, K` and
`Smith, J; Jones, K` read as the same list. Whether a space follows the
semicolon is a typing habit, not a metadata change.

It is deliberately narrow. Only the boundaries between values are normalised:
whitespace at the very start of the first value and the very end of the last
stays governed by `IGNORE_WHITESPACE`, so the two settings never overlap. A
changed, added, removed, or reordered list member is still a difference, and a
value containing no delimiter at all is left completely alone.

The delimiter for each field comes from the dictionary's own **Number of
values** and **Delimiter Character** columns, generated into `Headers.js`
alongside the header map. A field that becomes repeatable in a later draft is
picked up on the next regeneration with no code change. Fields recorded with a
pilcrow treat a line break as the delimiter.

All three settings are in the dialog, so they can be set per run without
touching config.

These affect **only the match test**. Values reach the review sheet exactly as
they are in the source, and `value_to_apply` still writes the incoming value
verbatim, so forgiving a trailing space never means writing a silently altered
value back. Differences set aside are counted in the summary by kind and by
field, so nothing disappears without a record.

Dates and numbers are normalised to a canonical form before comparison, so a
cell displayed as `6/3/1993` in one sheet and `1993-06-03` in the other is not
reported as a change. Only the underlying value matters.

Empty cells render as `(empty)` in the grid so blank-to-populated changes are
visible rather than looking like a formatting artefact.

### Systematic fields

Internal-only fields the partner never receives current values for —
`obj_workflow_state__label` and `obj_notes_to_vendor` are the usual
culprits — will differ on nearly every record and drown out the real
corrections. Any field differing on 50% or more of matched records is flagged
in the summary as systematic. Add those field names to the **Fields to ignore**
box (or to `CONFIG.IGNORE_FIELDS` in `src/Code.js` to make it permanent) and
re-run.

On a real 850-record partner return, this was the difference between 850
records flagged and 35 records that actually needed attention.

---

## Install

Three ways in, depending on how many people need it:

- **One spreadsheet, just you** — copy and paste, below.
- **A team** — deploy once as an Apps Script library and give each spreadsheet
  a ~30-line stub, so updates are a version bump rather than a repaste. See
  [docs/LIBRARY.md](docs/LIBRARY.md).
- **The whole organisation** — publish privately to your domain as a Workspace
  add-on, so it appears under Extensions in every Sheet with no per-file setup.
  See [docs/ADDON.md](docs/ADDON.md).
- **clasp** — for any of the above, below.

`src/Code.js`, `src/Headers.js`, and `src/Dialog.html` are the same in all
three. Only the entry-point file differs, and **exactly one of the three belongs
in a project** — each defines `onOpen`, and Apps Script resolves a duplicated
function name by silently using the last definition it loads.

| Install | Entry point | Manifest |
|---|---|---|
| Bound to one spreadsheet | `bound/Bound.js` | `src/appsscript.json` |
| Library consumer | `stub/Stub.js` | `stub/appsscript.json` |
| Published add-on | `addon/Addon.js` | `addon/appsscript.json` |

Each entry-point file carries `INSTALL_CONFIG` and `INSTALL_HEADER_ALIASES` for
local defaults; the engine picks them up on every run without any wrapping.

### Copy and paste

1. Open the spreadsheet where you want the report written.
2. **Extensions → Apps Script**.
3. Paste `src/Code.js` over the contents of `Code.gs`.
4. **File → New → Script file**, name it `Headers`, paste in `src/Headers.js`.
5. **File → New → Script file**, name it `Bound`, paste in `bound/Bound.js`.
6. **File → New → HTML file**, name it `Dialog`, paste in `src/Dialog.html`.
7. Save, reload the spreadsheet, then **CA-R Tools → MD update compare**

The first run asks for authorisation to read and write spreadsheets.

### clasp

```bash
npm install -g @google/clasp
clasp login

cp .clasp.json.example .clasp.json      # then fill in your scriptId
clasp push
```

`.clasp.json` is gitignored so the script ID stays out of the repo. Get the ID
from **Extensions → Apps Script → Project Settings**, or run
`clasp create --type sheets --title "CA-R Metadata Comparator"` from a clone.

---

## Use

**CA-R Tools → MD update compare**

| Field | Notes |
|---|---|
| Current spreadsheet | Leave blank to use the file you are in, or paste a Google Sheets URL or ID |
| Current tab | The California Revealed processing metadata |
| Incoming spreadsheet | Same — blank means this file |
| Incoming tab | The partner-returned sheet |
| Matching key | Auto, or force one of the three key fields |
| Header row | Row holding the machine-readable headers (default 1) |
| Translate human-readable headers | On by default; off compares headers as literal text |
| Diff cell contents | Both values, incoming only, or current only |
| Fields to ignore | One per line or comma separated |

The two sheets can live in the same workbook or in two different files. Output
is always written to the workbook the menu was opened from, so you need edit
access there and at least view access to both sources.

---

## Configuration

Everything worth changing lives in the `CONFIG` block at the top of
`src/Code.js`. To set defaults without editing the engine, put them in
`INSTALL_CONFIG` in whichever entry-point file the project uses; they are
applied on every run, and an unrecognised key throws rather than being ignored.

| Key | Default | Purpose |
|---|---|---|
| `HEADER_ROW` | `1` | Row holding machine-readable headers |
| `KEY_FIELDS` | uuid → call number → temporary id | Match key priority |
| `IGNORE_WHITESPACE` | `'none'` | `none` / `edges` / `all` — how much whitespace difference to forgive |
| `IGNORE_CASE` | `false` | Forgive letter-case differences |
| `MULTIVALUE_DELIMITER_SPACING` | `true` | Ignore spacing around the delimiter in multi-value fields |
| `KEY_MATCH_CASE_SENSITIVE` | `false` | Keys are always trimmed; this controls case |
| `IGNORE_FIELDS` | `[]` | Permanently excluded fields; either header form |
| `TRANSLATE_HEADERS` | `true` | Resolve human-readable headers via the dictionary |
| `DIFF_CELL_FORMAT` | `'both'` | `both` / `incoming` / `current` |
| `EMPTY_TOKEN` | `'(empty)'` | Rendering for blank values |
| `SYSTEMATIC_THRESHOLD` | `0.5` | Share of records above which a field is flagged |
| `MAX_CELL_CHARS` | `4000` | Truncation for long fields such as `obj_significance` |
| `GRID_SHEET` / `SUMMARY_SHEET` / `REVIEW_SHEET` | `Diff_Grid` / `Diff_Summary` / `Diff_Review` | Output tab names |
| `WRITE_GRID` | `true` | Set false to skip the grid and keep only review + summary |
| `DEFAULT_DECISION` | `'skip'` | What the decision column starts on; `'apply'` to tick exceptions instead |
| `BACKUP_BEFORE_APPLY` | `true` | Duplicate the target tab before the first write |
| `LOW_MATCH_WARNING` | `0.5` | Flag the run below this match rate |
| `MIN_KEY_RULE_SUPPORT` | `3` | Keys a token must appear in to count as a convention |
| `MAX_KEY_RULES` | `3` | Ceiling on proposed omissions |
| `MAX_APPLY_CELLS` | `2000` | Ceiling on one apply run |
| `MAX_APPLY_CHARS` | `45000` | Above this, a value is marked and forced to skip |
| `MAX_LIST_ITEMS` | `250` | Cap on listed unmatched keys |

## Public API

Everything else in `Code.js` ends in an underscore and is private to the
library.

| Function | Purpose |
|---|---|
| `showCompareDialog()` | Open the dialog |
| `showAbout()` | Version and behaviour summary |
| `carmd_getDefaults()` · `carmd_getSpreadsheetInfo(ref)` · `carmd_runComparison(params)` | Dialog callbacks; must be mirrored in the stub under a library install |
| `runComparison(params)` | Run a comparison directly, without the dialog |
| `applyReviewedChanges()` | Confirm, then write reviewed values back |
| `setConfig(overrides)` | Override `CONFIG` for this execution |
| `addHeaderAliases(map)` | Add header spellings at run time |
| `getVersion()` | Library version string |

---

## Tests

```bash
node test/test.js
```

The suite loads `src/Code.js` into a stubbed Apps Script environment
(`test/harness.js`) and runs it against a synthetic fixture whose incoming
sheet has reversed row order, shuffled column order, and known edits. No
partner data is committed to this repo.

Covered: order-independent matching, header-name column matching, sparse grid
construction, case-only and whitespace-only changes, blank-to-populated
changes, date normalisation, ignored and systematic fields, all three key
fallbacks, present-but-empty key columns, one-sided records, duplicate keys,
self-comparison rejection, and the identical-sheets case.

For the review and apply cycle: every line defaulting to `skip` so an
unreviewed run writes nothing, one review row per differing cell, values in
separate columns, `value_to_apply` pre-filled, rows grouped by field, the
decision dropdown rejecting anything but `apply`/`skip`, a dry run that touches
nothing, skipped lines not written, a hand-edited `value_to_apply` winning over
the incoming value, both sheets agreeing afterwards, outcome stamps, a
cell edited since the comparison reported stale rather than overwritten, a
deleted record reported rather than guessed at, the size guard, and a clear
error when no comparison is on record. For the backup: a copy taken before the
first write and holding the pre-write values, no copy on a dry run or a run with
nothing to write, the setting honoured when turned off, and names kept inside
the 100-character sheet-name limit.

For packaging: the dialog's callbacks all exist on the public surface, the stub
mirrors every one of them, `setConfig` rejects typos, and a full comparison runs
end to end through the stub with `INSTALL_CONFIG` applied. Each entry-point file
is checked for exactly one `onOpen`, for no top-level name that collides with
the engine, and for the shared `INSTALL_` settings hooks — so a stray second
entry point cannot silently take over the menu. The add-on file is additionally
checked for `createAddonMenu`, an `AuthMode.NONE` guard, `onInstall`, the right
OAuth scopes, and no library dependency.

For header translation: human-headed sheets compared against machine-headed
sheets and against each other, loose matching on case and punctuation,
`HEADER_ALIASES` resolution, machine-readable grid headings, unrecognised
headers compared and flagged, unrecognised headers present on one side only,
human-readable entries in the ignore list, and translation turned off. The
translation tests assert against real dictionary labels, so a field renamed in a
future draft surfaces as a test failure rather than a silent miss.

---

## Limits

- Apps Script caps a single execution at 6 minutes. A 850 × 380 comparison
  runs in well under a second of compute; the time goes to reading the sheets.
  Sheets several times larger may need the comparison split.
- Only the first occurrence of a repeated header name is used. Duplicate
  headers are reported in the summary. Two headers that resolve to the same
  field — say `Call Number` and `obj_call_number` in one sheet — count as a
  duplicate, and only the first is compared.
- Fields the dictionary does not know are compared but not validated. If a
  partner renames a column to something the dictionary has never seen, it will
  be reported as one-sided rather than matched to its old name.
- Fully blank rows are skipped. Rows with data but a blank key are reported in
  the summary rather than silently dropped.
- Formulas are compared on their computed values, not their formula text.
- The value columns in `Diff_Review` and the whole of `Diff_Grid` are forced to
  plain-text format before writing. Left on Automatic, Sheets reinterprets what
  it is handed — `1970-03-01` becomes a date, `1988` becomes a number, and a
  trailing space is eaten in the process, which both hides the difference under
  review and would write a date back into a cell that held text.

---

## License

MIT
