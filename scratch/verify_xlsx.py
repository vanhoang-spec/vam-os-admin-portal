import sys
import zipfile
import xml.etree.ElementTree as ET

def verify(filepath):
    try:
        with zipfile.ZipFile(filepath, 'r') as z:
            # check if it is a valid zip (OOXML)
            names = z.namelist()
            if '[Content_Types].xml' not in names:
                print("FAIL: Not a valid OOXML zip")
                return 1
            
            # check sheets
            workbook = z.read('xl/workbook.xml')
            root = ET.fromstring(workbook)
            # Find sheets
            ns = {'main': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            sheets = root.findall('.//main:sheet', ns)
            sheet_names = [s.get('name') for s in sheets]
            
            if 'Ket_qua_tuyen' not in sheet_names:
                print("FAIL: Ket_qua_tuyen missing")
                return 1
            if 'Chi_tiet_cham' not in sheet_names:
                print("FAIL: Chi_tiet_cham missing")
                return 1
                
            # check dangerous strings / vietnamese / mssv
            # The strings are stored in xl/sharedStrings.xml
            shared = z.read('xl/sharedStrings.xml')
            shared_root = ET.fromstring(shared)
            texts = [t.text for t in shared_root.findall('.//main:t', ns) if t.text]
            
            # Check vietnamese
            if not any('Nguyễn, Văn A' in t for t in texts):
                print("FAIL: Vietnamese string missing")
                return 1
            # Check safe formula
            if not any("'\"=cmd|' /C calc'!A0\"" in t or "'=cmd|' /C calc'!A0" in t for t in texts):
                print("FAIL: Formula not safely escaped as text")
                return 1
            # Check MSSV zero padding
            if not any('0123456789' in t for t in texts):
                print("FAIL: MSSV leading zero missing or casted to number")
                return 1
                
            print("PASS")
            return 0
    except Exception as e:
        print("FAIL:", e)
        return 1

if __name__ == '__main__':
    sys.exit(verify(sys.argv[1]))
