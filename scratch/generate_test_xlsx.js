const writeXlsxFile = require('write-excel-file/node');
const fs = require('fs');

async function run() {
  const summaryHeaders = [
    { value: "Mã hồ sơ", fontWeight: "bold" },
    { value: "Họ tên", fontWeight: "bold" },
    { value: "MSSV", fontWeight: "bold" }
  ];
  
  const summaryData = [
    summaryHeaders,
    [
      { type: String, value: "app-1" },
      { type: String, value: "Nguyễn, Văn A" },
      { type: String, value: "0123456789" }
    ],
    [
      { type: String, value: "app-2" },
      { type: String, value: "'=cmd|' /C calc'!A0" },
      { type: String, value: null } // should skip null or render empty string? Wait, write-excel-file throws on null? I removed null in route.ts! Let me test empty string instead of null.
    ],
    [
      { type: String, value: "app-3" },
      { type: String, value: "'=cmd|' /C calc'!A0" },
      { type: String, value: "" }
    ]
  ];

  const detailHeaders = [
    { value: "Test", fontWeight: "bold" }
  ];
  const detailData = [
    detailHeaders,
    [{ type: String, value: "test" }]
  ];

  const sheets = [
    { name: "Ket_qua_tuyen", data: summaryData },
    { name: "Chi_tiet_cham", data: detailData }
  ];

  const buffer = await writeXlsxFile(sheets, {
    fontFamily: "Arial",
    fontSize: 10
  });

  fs.writeFileSync('scratch/test.xlsx', Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
}
run().catch(console.error);
