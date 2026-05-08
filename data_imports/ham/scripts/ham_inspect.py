"""
HAM Inspection Script — Phase 1
Reads Data HAM mua 6.xlsx, prints all sheets, headers, row counts, and sample rows.
"""

import openpyxl
import json
import os
import sys

HAM_FILE = r"C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\Ha Noi Alumni Mentoring \u00ffHAM\Data HAM m\u00ffa 6.xlsx"

# Try alternate encodings if path fails
ALT_PATHS = [
    r"C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\Ha Noi Alumni Mentoring \uFFFDHAM\Data HAM m\uFFFDa 6.xlsx",
]

def find_file():
    import glob
    pattern = r"C:\Users\THIS PC\Desktop\VAM 2026\VAM_OS_Data_Cleaning\Input\**\*.xlsx"
    files = glob.glob(pattern, recursive=True)
    for f in files:
        if "HAM" in f or "ham" in f.lower():
            return f
    return None

path = find_file()
if not path:
    print("ERROR: Could not locate HAM file")
    sys.exit(1)

print(f"Found: {path}")
print(f"Size: {os.path.getsize(path):,} bytes\n")

wb = openpyxl.load_workbook(path, data_only=True)
sheets = wb.sheetnames
print(f"Sheets ({len(sheets)}): {sheets}\n")
print("="*80)

for sheet_name in sheets:
    ws = wb[sheet_name]
    rows = list(ws.iter_rows(values_only=True))
    
    # Find first non-empty row as header
    header_row = None
    header_idx = 0
    for i, r in enumerate(rows):
        if any(c is not None for c in r):
            header_row = r
            header_idx = i
            break
    
    if header_row is None:
        print(f"\n[Sheet: {sheet_name}] — EMPTY")
        continue
    
    # Count non-empty data rows after header
    data_rows = [r for r in rows[header_idx+1:] if any(c is not None for c in r)]
    
    print(f"\n[Sheet: {sheet_name}]")
    print(f"  Dimensions: {ws.dimensions}")
    print(f"  Header row (row {header_idx+1}): {list(header_row)}")
    print(f"  Data rows: {len(data_rows)}")
    print(f"  Columns: {ws.max_column}")
    
    # Sample first 5 data rows
    print(f"  --- Sample (first 5 rows) ---")
    for i, row in enumerate(data_rows[:5]):
        print(f"  Row {i+1}: {list(row)}")

print("\n" + "="*80)
print("Inspection complete.")
