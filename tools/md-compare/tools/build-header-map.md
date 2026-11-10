# Regenerating `src/Headers.js`

`src/Headers.js` is generated from the California Revealed Metadata Dictionary.
Regenerate it whenever a new dictionary draft adds, removes, or renames fields.

**Source:** `CaliforniaRevealed_Metadata_Dictionary_Draft2_202607.xlsx`
**Sheet:** `ADO_Dictionary-Records`
**Columns:** `Field Name` (human-readable) → `Machine Name (Exports)`
(machine-readable), plus `Number of values` and `Delimiter Character`, which
together produce the multi-value delimiter map.

Rows where either column is blank are skipped. In Draft2_202607 that is four
rows — `Featured Item`, `Partner Set`, `Request Access`, and the Strawberry
descriptive-metadata source row — none of which appear as export columns. The
remaining 402 pairs are unique on both sides, and stay unique after the loose
normalisation the script applies, so no lookup is ambiguous.

```bash
python3 tools/build_header_map.py \
    /path/to/CaliforniaRevealed_Metadata_Dictionary_DraftN_YYYYMM.xlsx \
    > src/Headers.js
```

After regenerating:

1. Re-add anything from the old `HEADER_ALIASES` block — the generator writes a
   fresh default block and does not preserve local additions.
2. Run `node test/test.js`. The suite checks the delimiter map covers the
   expected number of fields, so a dictionary that drops the `Number of values`
   or `Delimiter Character` columns fails rather than silently producing an
   empty map. The suite asserts against real dictionary labels
   (`Call Number`, `Created Date`, `Workflow State`), so a renamed field shows
   up as a test failure rather than a silent miss at run time.
3. Note the new pair count in the commit message; the summary tab reports it on
   every run, which makes it easy to tell which dictionary version produced a
   given report.

## Checking coverage against a real export

Worth doing once per dictionary revision — it catches export columns the
dictionary has not caught up with:

```python
import openpyxl
dic = openpyxl.load_workbook('DICTIONARY.xlsx', data_only=True)['ADO_Dictionary-Records']
known = {str(dic.cell(row=r, column=4).value).strip()
         for r in range(2, dic.max_row + 1)
         if dic.cell(row=r, column=4).value}

exp = openpyxl.load_workbook('EXPORT.xlsx', data_only=True).worksheets[0]
headers = [str(exp.cell(row=1, column=c).value or '').strip()
           for c in range(1, exp.max_column + 1)]
missing = [h for h in headers if h and h not in known]
print(len(missing), missing)
```

Anything listed is not a failure — the comparator keeps unrecognised headers and
still compares them — but it is a signal that either the dictionary or the export
template has drifted.
