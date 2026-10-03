import type { HelpGuide } from "@/lib/help-guides-core";

/**
 * Nội dung "Hướng dẫn sử dụng" cho từng trang của VAM OS.
 *
 * Khoá là đường dẫn trang (đúng như trong menu). Trang con không có khoá riêng
 * dùng hướng dẫn của trang cha gần nhất (helpGuideFor). Thêm/đổi tính năng thì
 * sửa hướng dẫn ở đây trong CÙNG PR — test buộc mọi trang trên menu có hướng dẫn.
 *
 * Viết theo đúng nhãn nút trên màn hình: người đọc tìm chữ đó trên trang.
 */
export const HELP_GUIDES: Record<string, HelpGuide> = {
  "/interviews/mentee-offline": {
    title: "Phỏng vấn mentee trực tiếp",
    summary:
      "Màn hình dùng trong ngày phỏng vấn: Support/BTC check-in, xếp phòng – bàn – người phỏng vấn; mentor mở hồ sơ được phân và chấm theo phiếu của mùa.",
    steps: [
      "Mentor: tick “Chỉ ứng viên được phân cho tôi”, chờ Support xếp bàn, bấm vào tên mentee để mở hồ sơ và đọc “Application đã nộp”.",
      "Mentor: chấm từng tiêu chí 1–5 và ghi “Evidence / Note” (bắt buộc) cho mọi tiêu chí; mục A chọn kết quả, ghi lý do và nhu cầu phát triển chính.",
      "Mentor: mục B chọn “Mức độ phù hợp về kỳ vọng của Mentee” và ghi “Concern / Note” (bắt buộc); mục C chọn có muốn nhận bạn này không và ghi chân dung Mentor phù hợp.",
      "Mentor: bấm “Xác nhận kết quả” — lưu là chốt ngay; sửa sau bằng “Sửa kết quả / lựa chọn mentee” (cần lý do sửa).",
      "Support/BTC: quét mã QR (tự check-in) hoặc tìm theo tên/SĐT rồi “Xác nhận check-in”; sau đó chọn Phòng, Bàn, Người phỏng vấn và “Lưu phân bàn”.",
      "Support/BTC: trước check-in có thể “Đổi ca phỏng vấn” (kể cả sau hạn tự đổi ca, bắt buộc lý do) hoặc “Huỷ lịch đăng ký”; tick “Phỏng vấn ONLINE” khi mentee không có mặt trực tiếp."
    ],
    notes: [
      "Kết quả “Không chọn làm mentee” khoá cả mục C. Mỗi mentor chọn “Có – Tôi muốn nhận bạn này” cho tối đa 2 hồ sơ trong mùa.",
      "Màn hình mentor không hiện tổng điểm — phiếu không cộng tổng, không có điểm sàn. Điểm quy đổi tham khảo chỉ BTC thấy.",
      "Nút “Hướng dẫn phỏng vấn mùa này” đầu trang mở Handbook và toàn bộ phiếu chấm của mùa.",
      "Danh sách xếp theo ca; trong mỗi ca ai check-in trước đứng trước (cùng giờ theo tên), bạn chưa đến đứng sau. Cột “Check-in / Bàn” hiện giờ đến và tài khoản Support/BTC đã check-in.",
      "Phiếu đang chấm tự lưu nháp trên máy (điện thoại/laptop) của mentor: lỡ chuyển tab, chuyển app hay tải lại trang thì mở lại hồ sơ là thấy “Đã khôi phục bản nháp”. Nháp chỉ là bản tạm — phải bấm “Xác nhận kết quả” mới lưu; lưu thành công thì nháp tự xoá, nháp quá 24 giờ cũng tự xoá."
    ],
    updated: "03/10/2026"
  },
  "/interviews/mentee-offline/huong-dan": {
    title: "Hướng dẫn phỏng vấn mùa này",
    summary: "Trang đọc phiếu chấm phỏng vấn mentee của mùa (tiêu chí, trọng số, mô tả 1/3/5, câu hỏi gợi ý) và Handbook BTC đã tải lên.",
    steps: [
      "Đọc “Kim chỉ nam” và lưu ý điểm số trước khi vào phòng.",
      "Mỗi tiêu chí có câu hỏi cốt lõi, mô tả mức 1/3/5 và câu hỏi gợi ý — dùng làm mốc khi chấm.",
      "Kéo xuống phần Handbook để đọc toàn bộ hướng dẫn phỏng vấn của mùa.",
      "Bấm “← Về màn hình phỏng vấn” để quay lại chấm."
    ],
    notes: ["Nội dung đọc từ phiếu chấm và Handbook hiện hành của mùa — BTC sửa ở “Phiếu chấm & hướng dẫn mentee”."],
    updated: "02/10/2026"
  },
  "/interviews/tien-do-mentor": {
    title: "Tiến độ phỏng vấn mentor",
    summary: "BTC theo dõi vòng trao đổi 1:1 của mentor mới Mùa 12 với core team: lịch hẹn theo ngày, ai đã phỏng vấn xong và kết quả, ai đang phỏng vấn, ai qua giờ hẹn mà chưa có phiếu, ai chưa đặt lịch.",
    steps: [
      "Đọc các ô số đầu trang: đã xong, đang phỏng vấn, qua giờ chưa có phiếu, đã đặt lịch, chưa phỏng vấn; dòng “Kết quả đã có” tách theo trạng thái đơn.",
      "Chọn “Ngày hẹn” để xem lịch hẹn của một ngày; nhóm “Không có lịch hẹn” gồm mentor được core team nhận phỏng vấn trực tiếp, mentor chưa đặt lịch, và mentor đã dừng.",
      "Bấm nút trạng thái để lọc (vd. “Qua giờ, chưa có phiếu” để nhắc người phỏng vấn nộp phiếu; “Chưa phỏng vấn” để nhắc mentor đặt lịch); gõ tên/email/SĐT của mentor hoặc tên người phỏng vấn để tìm.",
      "Bấm tên mentor để mở hồ sơ ứng tuyển."
    ],
    notes: [
      "Không tính mentor gia hạn (không qua phỏng vấn). Cột “Ghi chú” cho biết số thư mời/nhắc đã nhận (tối đa 4), giờ nộp phiếu, số lần huỷ/đổi lịch.",
      "“Đang phỏng vấn” = đang trong giờ hẹn 60 phút hoặc phiếu đang làm dở; quá giờ hẹn mà chưa có phiếu thì chuyển sang “Qua giờ, chưa có phiếu”.",
      "Chỉ Core team / Support team có quyền vận hành mùa xem được."
    ],
    updated: "03/10/2026"
  },
  "/interviews/tien-do-mentee": {
    title: "Tiến độ phỏng vấn mentee",
    summary: "BTC theo dõi buổi phỏng vấn mentee: danh sách đăng ký theo ngày, buổi sáng/chiều và từng ca; ai đã phỏng vấn xong và kết quả, ai đang phỏng vấn, ai đã đến chờ phân bàn, ai chưa đến.",
    steps: [
      "Chọn “Ngày” và “Buổi” (sáng: ca bắt đầu trước 12:00). Các ô số đầu trang tính theo ngày + buổi đang chọn.",
      "Bấm nút trạng thái (“Chưa đến”, “Chờ phân bàn”, “Đang phỏng vấn”, “Đã xong”) để lọc; gõ tên hoặc số điện thoại vào “Tìm mentee”.",
      "Mỗi ca hiện số bạn đã xong (Đạt / Không chọn / Cần xem xét), đang phỏng vấn, chờ phân bàn, chưa đến; từng bạn có phòng/bàn, người phỏng vấn, kết quả, giờ check-in.",
      "Bấm tên mentee để mở đúng hồ sơ ở màn hình check-in / phân bàn / chấm phỏng vấn."
    ],
    notes: [
      "Trang tự làm mới theo chu kỳ — số liệu theo kịp thao tác check-in, phân bàn, chấm điểm ở màn hình phỏng vấn.",
      "Chỉ Core team / Support team có quyền vận hành mùa xem được; mentor phỏng vấn không xem kết quả của người khác qua trang này.",
      "Trong mỗi ca, các bạn xếp theo giờ check-in — ai đến trước đứng trước (cùng giờ thì theo tên), kèm tài khoản Support/BTC đã check-in; bạn chưa đến đứng sau, bạn đã rút hồ sơ ở cuối. Bấm “Chờ phân bàn” để lọc riêng các bạn cần phân bàn."
    ],
    updated: "04/10/2026"
  },
  "/interviews/ca-mentee": {
    title: "Ca phỏng vấn mentee",
    summary: "Tình hình các ca phỏng vấn mentee: số chỗ, số người đã đặt, ca còn trống/đã kín; BTC cấu hình ghế, địa điểm và gửi thư mời chọn ca.",
    steps: [
      "Xem số liệu tổng: “Đã mời phỏng vấn”, “Đã nhận thư, chưa chọn ca”, “Đã chọn ca”, “Chờ thư mời”; từng ca hiện số chỗ đã đặt / số ghế, “Đã đầy” khi kín.",
      "BTC: “Điền nhanh cho mọi ca” để đặt cùng số ghế/địa điểm cho tất cả ca; hoặc sửa số ghế, địa điểm, tick “Đã đóng” trên dòng của từng ca rồi “Lưu”.",
      "BTC: bấm “Gửi thư mời chọn ca” để gửi cho những người còn “Chờ thư mời” (hệ thống tôn trọng hạn mức thư 24 giờ).",
      "Khi BTC mở lại chọn ca cho bạn chưa chọn (hạn riêng): khung “Mở lại chọn ca cho bạn chưa chọn” hiện số bạn được mở lại và hạn mới. “Xem thư mẫu”, bấm “Gửi thử cho tôi”, rồi “Gửi thư cho … bạn” → “Xác nhận gửi”. Bấm lại nếu còn người chờ thư.",
      "Bấm “Mở danh sách theo ca, check-in và chấm phỏng vấn” để sang màn hình phỏng vấn trực tiếp."
    ],
    notes: [
      "Support team xem được tình hình nhưng không sửa ca, không gửi thư mời.",
      "Mở lại chọn ca chỉ áp dụng cho người được BTC gia hạn riêng; người đã chọn ca vẫn theo hạn cũ (cần đổi thì Support/BTC dùng “Đổi ca phỏng vấn” ở màn hình phỏng vấn trực tiếp). Thư gửi thử không chứa link thật của ai.",
      "Gửi lại thư mời cho MỘT ứng viên (vd. gõ sai email): mở hồ sơ mentee ở “Ứng tuyển”, dùng bảng “Thư mời chọn ca phỏng vấn”."
    ],
    updated: "02/10/2026"
  },
  "/interviews/phieu-cham-mentee": {
    title: "Phiếu chấm & hướng dẫn mentee",
    summary: "BTC cài phiếu chấm phỏng vấn mentee và Handbook cho từng mùa. Mùa chưa có phiếu riêng dùng phiếu lưu gần nhất.",
    steps: [
      "Chọn mùa ở đầu trang; dòng trạng thái cho biết mùa đang có phiếu riêng hay đang dùng phiếu của mùa khác.",
      "Sửa tên tiêu chí, trọng số (tổng phải đúng 100%), câu hỏi cốt lõi, mô tả 1/3/5, câu hỏi gợi ý; “Thêm tiêu chí”, “Lên”/“Xuống”, “Xoá tiêu chí”.",
      "Bấm “Lưu phiếu chấm mùa …” — phiếu lên phiên bản mới; form chấm đang mở phải tải lại.",
      "Phần Handbook: chọn file Word (.docx) rồi “Tải Handbook lên” — ảnh trong file bị bỏ, giữ chữ, tiêu đề và bảng."
    ],
    notes: [
      "Chỉ Super Admin, Admin, Core Team có quyền vận hành mùa.",
      "Điểm đã chấm giữ nguyên nội dung phiếu lúc chấm — sửa phiếu về sau không đổi điểm cũ."
    ],
    updated: "02/10/2026"
  },
  "/interviews/thu-xac-nhan-mentor": {
    title: "Thư xác nhận lịch PV cho mentor",
    summary: "Gửi thư xác nhận lịch phỏng vấn cho mentor đăng ký chấm: đọc Google Sheet đăng ký, ghép buổi – phòng – cơ sở – tài khoản của từng người.",
    steps: [
      "Dán link Google Sheet mentor đăng ký phỏng vấn (chia sẻ “Bất kỳ ai có đường liên kết đều xem được”), bấm “Đọc danh sách”.",
      "Xem các buổi đọc từ ca phỏng vấn, danh sách từng người và trạng thái, thư xem trước.",
      "Người “Chưa có quyền phỏng vấn”: cấp quyền trước (nút cấp quyền trên trang hoặc “Danh sách nhân sự tuyển sinh”).",
      "Bấm “Gửi thử cho tôi”, kiểm hộp thư; rồi gõ đúng số người và bấm “Gửi thư cho N mentor”."
    ],
    notes: [
      "Chỉ quản trị viên. Ai đã nhận thư của đợt này không nhận lần hai; bấm gửi lại chỉ gửi người còn thiếu.",
      "Người chưa từng đăng nhập nhận link đặt mật khẩu riêng trong thư."
    ],
    updated: "02/10/2026"
  },
  "/": {
    title: "Tổng quan",
    summary: "Trang chủ sau khi đăng nhập: xem nhanh tình hình mentoring của mùa đang chọn — recap theo tháng, mentee cần follow-up, quy mô dữ liệu và các cảnh báo dữ liệu cần rà soát.",
    steps: [
      "Chọn mùa ở ô “Mùa vận hành” trên thanh trên cùng. Dải “Tháng đang xem” cho biết tháng đang dùng: tháng hiện tại, hoặc tháng gần nhất có dữ liệu.",
      "Nếu có thẻ “Công việc của tôi”, bấm “Xem công việc của tôi” để xử lý các việc tuyển chọn đang giao cho bạn.",
      "Xem “Chỉ số chính” và “Chỉ số theo dõi”; thẻ “Chưa có recap 2 tháng liên tiếp” chuyển màu đỏ nghĩa là cần liên hệ follow-up.",
      "Ở bảng “Mentee cần follow-up”, bấm “Mở queue” để sang danh sách việc, hoặc “Xem mentee” để mở hồ sơ từng người.",
      "Bấm “Xem Operations” ở bảng “Top mentor theo số recap tháng này” để mở dashboard vận hành chi tiết của cùng tháng.",
      "Kéo xuống “Cảnh báo dữ liệu cần rà soát”, bấm “Mở trang” ở từng dòng để sửa dữ liệu thiếu hoặc email trùng."
    ],
    notes: [
      "Reviewer và Viewer chỉ thấy bản rút gọn gồm 4 chỉ số: “Mùa trong phạm vi”, “Ứng tuyển”, “Tổng match”, “Match active”. Reviewer thấy thêm thẻ “Công việc của tôi” khi có việc được giao.",
      "Thẻ “Công việc của tôi” chỉ hiện khi tài khoản đang có phân công đánh giá hồ sơ hoặc phỏng vấn; Support team không có thẻ này.",
      "Với Super admin, trang này nằm ở mục “Tổng quan vận hành hiện tại”. Khối “Đối soát Recap Chính thức” chỉ tính recap hợp lệ; recap bị loại khỏi báo cáo không vào KPI."
    ],
    updated: "02/10/2026"
  },
  "/portfolio": {
    title: "Danh mục chương trình",
    summary: "Bảng tổng hợp toàn hệ thống dành cho Super admin: số liệu gộp của mọi chương trình và tình trạng từng chương trình, không hiển thị thông tin cá nhân.",
    steps: [
      "Xem khối “Chỉ số toàn hệ thống”: tổng chương trình, ứng tuyển đang mở hoặc chờ xử lý, mentor/mentee/ghép cặp đang hoạt động, sự kiện sắp tới.",
      "Để ý hai thẻ “Vấn đề dữ liệu đang mở” và “Nhiệm vụ quá hạn”; thẻ đổi màu cảnh báo khi số lớn hơn 0.",
      "Ở bảng “Theo chương trình”, đọc cột “Tình trạng”: “Bình thường”, “Cần chú ý” hoặc “Có vấn đề dữ liệu”.",
      "Bấm tên chương trình trong bảng để mở trang riêng của chương trình đó.",
      "Muốn xem chi tiết mùa đang vận hành, chuyển sang mục “Tổng quan vận hành hiện tại” trên menu."
    ],
    notes: [
      "Chỉ Super admin mở được trang này. Vai trò khác bấm vào sẽ được chuyển sang trang chương trình đầu tiên mình có quyền, hoặc về “Tổng quan”.",
      "“Có vấn đề dữ liệu” khi chương trình còn data issue mở; “Cần chú ý” khi không còn data issue nhưng còn nhiệm vụ quá hạn.",
      "Ô ghi “Chưa có dữ liệu” hoặc “Chưa liên kết đủ dữ liệu” nghĩa là chưa có nguồn số liệu tin cậy, không phải bằng 0."
    ],
    updated: "02/10/2026"
  },
  "/my-work": {
    title: "Công việc của tôi",
    summary: "Hộp việc cá nhân: liệt kê các phân công đánh giá hồ sơ và phỏng vấn đang giao cho chính tài khoản của bạn, kèm trạng thái và hạn hoàn tất.",
    steps: [
      "Xem dải tóm tắt “Cần làm”, “Đang làm”, “Quá hạn”, “Hoàn tất” để biết khối lượng việc của mình.",
      "Bấm “Tất cả”, “Đánh giá hồ sơ” hoặc “Phỏng vấn” để lọc theo loại việc; việc quá hạn tô đỏ và luôn nằm đầu danh sách.",
      "Bấm “Mở” (việc mới), “Tiếp tục” (đang làm) hoặc “Xem lại” (đã nộp) để mở chi tiết ngay trên danh sách.",
      "Chấm điểm trong khung chi tiết, bấm “Lưu nháp” để lưu tạm hoặc “Nộp Review” khi đã chấm xong.",
      "Bấm “Mở toàn màn hình” nếu cần chỗ đọc đơn rộng hơn; bấm “Đóng” hoặc phím Esc để quay về đúng chỗ cũ trong danh sách."
    ],
    notes: [
      "Dành cho Super admin, Admin, Core team và Reviewer. Mỗi người chỉ thấy việc giao cho chính mình, kể cả Super admin. Support team và Viewer không vào được.",
      "Việc bị huỷ phân công, chuyển cho người khác, hoặc hồ sơ đã rút/đã có kết quả cuối sẽ tự rời khỏi danh sách của bạn.",
      "Nhãn “Sắp đến hạn” hiện khi còn dưới 2 ngày tới hạn. Việc “Cần làm rõ” được tính vào “Đang làm”, không phải “Hoàn tất”."
    ],
    updated: "02/10/2026"
  },
  "/operations": {
    title: "Tổng quan vận hành",
    summary: "Dashboard KPI vận hành của mùa đang chọn (tiêu đề trang ghi “Vận hành”): recap, mentee/mentor active, sự kiện và mentee cần follow-up theo từng tháng.",
    steps: [
      "Chọn mùa ở “Mùa vận hành” trên thanh trên cùng, rồi chọn tháng ở ô “Tháng vận hành”.",
      "Đọc các thẻ KPI và dòng giải thích dưới thẻ, ví dụ “Tỷ lệ mentee active” có tử số khác thẻ “Mentee active”.",
      "Bấm “Xem danh sách cần follow-up”, “Xem lỗi dữ liệu” hoặc “Công việc quá hạn” để mở danh sách việc tương ứng của tháng đang xem.",
      "Dùng “Theo dõi tháng”, “Phân tích cộng đồng mentor/mentee”, “Quản lý sự kiện & tham gia” để sang các màn hình liên quan.",
      "Ở bảng “Mentee cần follow-up”, bấm “Xem mentee” để mở hồ sơ; danh sách dài hơn 20 dòng thì bấm dòng “Xem thêm” để hiện tiếp.",
      "Nếu có mục “Recap cần rà soát ngày/tháng”, bấm “Sửa” để chỉnh recap ghi nhận ngoài khung mùa vận hành."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Reviewer và Viewer không vào được.",
      "Nút “Thêm recap thủ công” và “Sửa” chỉ hiện với Super admin, Admin, Core team có phạm vi vận hành.",
      "Tháng chưa chốt chỉ để theo dõi nội bộ, không dùng cho KPI chính thức. Danh sách follow-up là gợi ý từ dữ liệu recap, chưa phải trạng thái xử lý."
    ],
    updated: "02/10/2026"
  },
  "/operations/tasks": {
    title: "Nhiệm vụ & phân công",
    summary: "Hàng đợi công việc vận hành theo tháng (tiêu đề trang ghi “Việc cần xử lý”): follow-up mentee thiếu recap, lỗi dữ liệu, việc thủ công, kèm người phụ trách và hạn xử lý.",
    steps: [
      "Bấm nhanh “Cần follow-up”, “Lỗi dữ liệu”, “Quá hạn”, hoặc chọn “Trạng thái”, “Người phụ trách”, “Loại việc”, “Ưu tiên” rồi bấm “Lọc”; bấm “Xóa lọc” để bỏ.",
      "Sau khi đã đối chiếu recap, kiểm tra “Tháng kiểm tra” rồi bấm “Tạo danh sách follow-up tháng” để tạo việc cho mentee có match active nhưng 2 tháng liền chưa có recap.",
      "Ở khung “Tạo công việc thủ công”, nhập “Tiêu đề”, chọn “Loại công việc”, “Mức độ ưu tiên”, “Người phụ trách”, “Hạn xử lý”, rồi bấm “Tạo công việc”.",
      "Ở thẻ của từng việc, chọn trạng thái và/hoặc người phụ trách mới rồi bấm “Cập nhật”; muốn ghi chú nội bộ thì nhập rồi bấm “Thêm ghi chú”.",
      "Xem việc giao cho mình ở mục “Việc của tôi”; bấm “Export CSV” để tải danh sách đang lọc."
    ],
    notes: [
      "Super admin, Admin, Core team tạo và cập nhật được việc. Support team chỉ xem (mở từ các nút trên “Tổng quan vận hành”); Reviewer, Viewer không vào được.",
      "Tháng của hàng đợi theo tháng đang chọn khi mở từ “Tổng quan vận hành”; mở từ menu là tháng hiện tại. Tạo follow-up lại cùng tháng sẽ bỏ qua mục đã có, không tạo trùng.",
      "Ô sửa nhanh chỉ hiện cho 8 việc đầu mỗi bảng; hãy lọc hẹp lại để thấy việc cần sửa. File “Export CSV” có tên mentee/mentor, chỉ dùng nội bộ."
    ],
    updated: "02/10/2026"
  },
  "/operations/monthly": {
    title: "Báo cáo tháng",
    summary: "Báo cáo hoạt động của một tháng, chỉ xem (tiêu đề trang ghi “Báo cáo hoạt động tháng”): số recap, sự kiện, lượt tham gia và cho biết tháng đã chốt hay chưa.",
    steps: [
      "Chọn tháng ở ô “Tháng” rồi bấm “Xem”; tháng có ghi “· đã chốt” là tháng chốt gần nhất.",
      "Đọc dòng dưới “Tháng đã chốt gần nhất”: tháng đã chốt thì KPI dùng được cho báo cáo, tháng chưa chốt chỉ để theo dõi nội bộ.",
      "Xem khối “Tổng quan tháng”; để ý thẻ “Recap chưa khớp match” để rà soát recap chưa gắn với ghép cặp nào.",
      "Ở bảng “Sự kiện trong tháng”, bấm “Xem chi tiết tham gia” để xem điểm danh từng sự kiện.",
      "Bấm “Mở Operations chi tiết” để sang dashboard vận hành cùng tháng, hoặc “Quản lý sự kiện” để mở danh sách sự kiện."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team (Support team mở qua nút “Theo dõi tháng” trên “Tổng quan vận hành”). Reviewer, Viewer không vào được.",
      "Nút “Tạo recap thủ công” và “Tạo sự kiện” chỉ hiện với Super admin, Admin, Core team có phạm vi vận hành.",
      "Trang luôn tính theo mùa vận hành hiện hành, không có ô chọn mùa. “Tỷ lệ tham gia” = số đã tham gia chia cho (đã tham gia + vắng)."
    ],
    updated: "02/10/2026"
  },
  "/operations/intelligence": {
    title: "Phân tích mùa",
    summary: "Trang “Phân tích cộng đồng”: nhìn lại cơ cấu mentor/mentee của mùa đang vận hành, chất lượng Matching, nhóm thiếu mentor, mentor quá tải và các đề xuất hành động.",
    steps: [
      "Đọc thẻ “Tình trạng hoạt động của cộng đồng” để biết “Tháng phân tích”, rồi xem các ô số liệu: “Tổng mentor”, “Mentor active”, “Nhóm thiếu mentor”, “Mentor quá tải”, “Mentee cần kết nối lại”.",
      "Kéo xuống các phần “Hoạt động Mentor”, “Hoạt động Mentee”, “Phân tích Matching”, “Hoạt động theo nhóm” để xem biểu đồ và bảng theo ngành, chuyên môn, ngành học, Support Team.",
      "Ở bảng “Cung-cầu Mentor và Mentee theo phân khúc”, đọc cột “Chênh lệch” và “Hành động đề xuất”: chênh lệch âm nghĩa là thiếu mentor, cần “Tuyển thêm mentor / tìm co-mentor”.",
      "Bấm “Mở danh sách nhắc nhở” ở bảng “Mentee chưa có recap theo định hướng nghề nghiệp” để sang danh sách việc nhắc mentee chưa có recap.",
      "Xem phần “Đề xuất hành động”: mỗi thẻ ghi mức ưu tiên, lý do, “Người phụ trách” và “Hành động đề xuất”.",
      "Cần số liệu ra file: bấm “Xuất CSV Mentor”, “Xuất CSV Mentee” hoặc “Xuất CSV chênh lệch”. Nút bị mờ khi bảng tương ứng chưa có dữ liệu."
    ],
    notes: [
      "Chỉ Super admin, Admin, Core team mở được trang này; vai trò khác nhận trang không tồn tại.",
      "Số liệu tính cho mùa đang vận hành, trong phạm vi chương trình bạn được cấp. Trang chỉ để đọc, không có ô chọn mùa hay chọn tháng.",
      "Ba file CSV là bảng số đếm tổng hợp theo nhóm (ngành, ngành học, phân khúc), không chứa tên hay email."
    ],
    updated: "02/10/2026"
  },
  "/operations/mail": {
    title: "Mail",
    summary: "Soạn mẫu thư gửi hàng loạt cho mentor, mentee của mùa đang vận hành; quản trị viên duyệt rồi gửi. Tab “Thư tự động” và “Nhật ký gửi” cho xem thư hệ thống tự gửi và mọi lá thư đã đi.",
    steps: [
      "Ở tab “Mẫu thư”, bấm “Soạn thông báo chung”, điền “Tên mẫu thư” (người nhận không thấy), “Tiêu đề thư” và “Nội dung thư” (văn bản thuần).",
      "Đặt con trỏ vào tiêu đề hoặc nội dung rồi bấm một nút trong khung “Chèn thông tin vào thư” (Tên người nhận, Tên mùa, Vai trò); kiểm lại ở khung “Xem trước”.",
      "Bấm “Tạo bản nháp” (hoặc “Lưu thay đổi” khi sửa) rồi báo quản trị viên duyệt. Bấm vào tên một mẫu trong danh sách để mở ra sửa.",
      "Quản trị viên: mở mẫu đang là “Bản nháp”, gõ lại đúng tiêu đề vào ô “Gõ lại tiêu đề ở trên” rồi bấm “Duyệt mẫu thư”.",
      "Quản trị viên: ở “Gửi hàng loạt”, chọn “Mẫu thư” và “Gửi cho” (có cả người đã đăng ký một sự kiện), bấm “Gửi thử cho tôi” và kiểm hộp thư của mình trước.",
      "Gõ lại đúng số người nhận vào ô “Gõ lại số … để xác nhận”, bấm “Bắt đầu gửi”. Mỗi lần chạy gửi tối đa 25 thư; phần còn lại bấm “Gửi tiếp” ở “Lô đang gửi dở”."
    ],
    notes: [
      "Soạn bản nháp: Super admin, Admin, Core team, Support team. Duyệt và gửi hàng loạt: chỉ Super admin, Admin. Tab “Nhật ký gửi”: Super admin, Admin, Core team.",
      "Thư không nhận thẻ HTML (dấu < và >). Sửa một mẫu đã duyệt sẽ đưa nó về “Bản nháp”; lô đang gửi dở cũng phải chờ duyệt lại mới “Gửi tiếp” được.",
      "Thư đã gửi không thu hồi được. Người thiếu email hoặc họ tên không nhận được thư; số người này hiện ngay dưới ô “Gửi cho”."
    ],
    updated: "02/10/2026"
  },
  "/recaps/create": {
    title: "Tạo báo cáo",
    summary: "Trang “Tạo mentoring recap”: ghi nhận thủ công một buổi mentoring khi mentor/mentee quên nộp recap qua form chính thức.",
    steps: [
      "Chọn “Mùa (season_code)” và “Ngày họp (meeting_date)” — hai ô bắt buộc.",
      "Gõ tên, email hoặc công ty vào ô “Mentor”; tên, email hoặc trường vào ô “Mentee”; bấm chọn đúng người trong danh sách hiện ra (bấm “Xoá” để chọn lại).",
      "Kiểm ô “match_id (tự động phát hiện)”: hệ thống tự dò cặp mentor–mentee. Cần gắn match khác thì tick “Nâng cao: chọn match_id thủ công”.",
      "Chọn “Loại hình” (Mentoring 1–1, Cross-mentoring, Mentoring theo nhóm…) và “Trạng thái” (mặc định “Đã ghi nhận”); điền “recap_url”, “recap_note / summary”, “admin_notes” nếu có.",
      "Bấm “Tạo recap”. Khi báo “Đã tạo recap thành công.”, bấm “Quay lại Rà soát dữ liệu”, hoặc tải lại trang để nhập buổi khác."
    ],
    notes: [
      "Chỉ Super admin, Admin, Core team có quyền vận hành mùa mới tạo được. Phải chọn ít nhất Mentor, Mentee hoặc Match.",
      "Mỗi match chỉ có một recap cho một ngày họp: trùng ngày, hệ thống từ chối.",
      "Recap tạo ở đây được đánh dấu nguồn admin_input và ghi vào nhật ký kiểm tra (audit)."
    ],
    updated: "02/10/2026"
  },
  "/ai": {
    title: "Công cụ AI",
    summary: "Trợ lý AI giúp tìm ý tưởng hoạt động, viết content, soạn brief cho Canva AI, tra xu hướng ngành và soạn văn bản hành chính. Mọi kết quả phải được đọc lại trước khi dùng.",
    steps: [
      "Chọn công cụ: “Tìm ý tưởng hoạt động”, “Viết content”, “Brief thiết kế cho Canva AI”, “Xu hướng ngành tại Việt Nam” hoặc “Soạn thảo văn bản”.",
      "Điền các ô của công cụ (chủ đề, brief, câu hỏi…). Có thể đính kèm tối đa 3 file PDF, DOCX, XLSX, TXT, CSV, MD, mỗi file 8MB; file scan dạng ảnh không đọc được.",
      "Với “Soạn thảo văn bản”: chọn “Loại văn bản”, nhập đủ “Nội dung / dữ kiện” (thiếu thì AI để trống […]); có thể thêm “File mẫu tham chiếu” để AI học bố cục.",
      "Với “Xu hướng ngành tại Việt Nam”: xem dòng báo đã bật tìm kiếm web hay chưa. Chưa bật thì câu trả lời chỉ là kiến thức chung, không có link kiểm chứng.",
      "Bấm “Chạy trợ lý” và chờ (có thể tới 1 phút). Muốn kết quả khác thì sửa ô nhập rồi bấm “Chạy lại”.",
      "Đọc lại kết quả, rồi bấm “Tải Word”, “Tải PDF” hoặc “Sao chép” để giữ lại."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team, Support team. Thẻ “Báo cáo Ban điều hành” (chỉ gửi số liệu tổng của mùa, không có tên) chỉ Super admin, Admin thấy.",
      "Nội dung nhập và file đính kèm được gửi sang DeepSeek (máy chủ ở nước ngoài): không dán họ tên, email, SĐT, MSSV của mentor/mentee.",
      "App không lưu kết quả và không giữ file: rời trang là mất, hãy tải Word/PDF về trước."
    ],
    updated: "02/10/2026"
  },
  "/people": {
    title: "Cộng đồng VAM",
    summary: "Danh bạ hồ sơ người tham gia trong hệ thống, gồm mentor và mentee của các mùa. Dùng để tra cứu một người và mở hồ sơ CRM đầy đủ của họ.",
    steps: [
      "Gõ tên, email hoặc số điện thoại vào ô “Tìm theo tên, email hoặc số điện thoại”.",
      "Thu hẹp bằng ô “Giới tính”; bấm “Xoá bộ lọc” để xem lại toàn bộ. Dùng “Trước” / “Sau” cuối bảng để chuyển trang.",
      "Bấm vào một dòng để mở hồ sơ: “Trạng thái tham gia”, “Lịch sử VAM”, “Ghi chú CRM”, các match và hoạt động sự kiện của người đó.",
      "Trong hồ sơ, ghi lại liên hệ bằng “Thêm ghi chú CRM”; người nghỉ mùa này thì dùng “Chuyển sang Không tham dự” ở khung “Trạng thái tham gia”.",
      "Hồ sơ trùng, nhập sai hoặc thử nghiệm: bấm “Xoá khỏi hệ thống”, gõ lại họ tên, ghi “Lý do xoá” rồi bấm “Xoá hẳn khỏi hệ thống”."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Danh sách chỉ gồm hồ sơ trong phạm vi chương trình bạn được cấp quyền.",
      "Đổi Tham dự / Không tham dự và xoá hồ sơ: mentor do Core team trở lên; mentee thì Support team cũng làm được. Người mang nhiều vai trò tính theo mức chặt hơn.",
      "Xoá hẳn không hoàn lại được. Hồ sơ còn dữ liệu chương trình thì hệ thống không cho xoá — dùng “Chuyển sang Không tham dự” thay vào đó."
    ],
    updated: "02/10/2026"
  },
  "/mentors": {
    title: "Mentor",
    summary: "Danh sách mentor chính thức của mùa đang chọn, kèm số mentee đang phụ trách, ngành, chức năng và công ty. Dùng để tra cứu và theo dõi tải của từng mentor.",
    steps: [
      "Chọn mùa ở ô “Mùa vận hành” trên thanh trên cùng; danh sách đổi theo mùa đó.",
      "Gõ vào ô tìm theo tên, mã mentor, email, công ty, chức danh, ngành hoặc chức năng.",
      "Lọc bằng “Ngành”, “Chức năng”, “Trạng thái mentor”, “Số mentee”, “Mentee phụ trách”, “Công ty”, “Mùa intake”, “Đợt tuyển”; bấm “Xoá bộ lọc” để bỏ lọc.",
      "Đổi thứ tự ở ô “Sắp xếp” (vd. “Số mentee giảm dần”, “Tên mentor A-Z”, “Công ty A-Z”).",
      "Bấm vào một dòng để mở hồ sơ người đó; “Xem hồ sơ” mở link hồ sơ mentor bên ngoài.",
      "Core team trở lên: bấm “Tạo mentor mới”, điền “1. Người (person)” và “2. Hồ sơ mentor”, rồi bấm “Tạo hồ sơ mentor”."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Nút “Tạo mentor mới” chỉ dành cho Super admin, Admin, Core team.",
      "Hồ sơ vừa tạo chưa là thành viên chính thức của mùa nên chưa hiện ở đây — tìm ở “Cộng đồng VAM”. Email đã có thì bấm “Liên kết với người này” để khỏi tạo trùng.",
      "“Đang hoạt động” nghĩa là mentor có ít nhất một match đang active. Mentor “Không tham dự” trong mùa sẽ không nằm trong danh sách này."
    ],
    updated: "02/10/2026"
  },
  "/mentees": {
    title: "Mentee",
    summary: "Danh sách mentee chính thức của mùa đang chọn, kèm thông tin học tập và mentor hiện tại. Dùng để tra cứu mentee và xem ai đã có, ai chưa có mentor.",
    steps: [
      "Chọn mùa ở ô “Mùa vận hành” trên thanh trên cùng; danh sách đổi theo mùa đó.",
      "Gõ vào ô “Tìm theo tên, email, mentee_code, MSSV, ngành hoặc mentor”.",
      "Lọc bằng “Mã trường”, “Mentor” (“Có mentor” / “Chưa có mentor”), “Trạng thái match”, “Ngành”, “Mùa intake”, “Đợt tuyển”; bấm “Xoá bộ lọc” để bỏ lọc.",
      "Đổi thứ tự ở ô “Sắp xếp” (vd. “Mã trường A-Z”, “Tên mentee A-Z”, “Độ tin cậy giảm dần”).",
      "Bấm vào một dòng để mở hồ sơ mentee; dùng “Xem match”, “Xem mentor”, “Xem profile” trên dòng để sang match, hồ sơ mentor hoặc link profile.",
      "Core team trở lên: bấm “Tạo mentee mới”, điền “1. Người (person)” và “2. Hồ sơ mentee”, rồi bấm “Tạo hồ sơ mentee”."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Nút “Tạo mentee mới” chỉ dành cho Super admin, Admin, Core team.",
      "Đổi Tham dự / Không tham dự hoặc xoá một mentee làm trong hồ sơ người đó; với mentee, Support team cũng làm được.",
      "Hồ sơ vừa tạo chưa là thành viên chính thức của mùa nên chưa hiện ở đây — tìm ở “Cộng đồng VAM”."
    ],
    updated: "02/10/2026"
  },
  "/participant-accounts": {
    title: "Tài khoản đăng nhập",
    summary: "Mời mentor và mentee chính thức của mùa lập tài khoản VAM OS, theo dõi ai đã nhận thư, ai đã đăng nhập. Trạng thái tài khoản thuộc về người, không thuộc về mùa.",
    steps: [
      "Chọn mùa ở ô “Mùa vận hành”; xem các thẻ “Chưa mời”, “Đã gửi thư, chưa vào”, “Đã vào”, “Không mời được”, “Thư đã gửi trong 24 giờ”.",
      "Lọc theo vai trò (“Tất cả vai trò”, “Mentor”, “Mentee”) và theo trạng thái; gõ tên hoặc email vào ô tìm (gõ không dấu cũng được).",
      "Mời một người: bấm “Mời” trên dòng của họ. Đã gửi thì nút là “Gửi lại” (link trong thư trước hết dùng được); người “Đã vào” thì là “Gửi link đặt lại mật khẩu”.",
      "Mời hàng loạt: bấm “Mời hàng loạt…”, gõ lại đúng số người để xác nhận, bấm “Bắt đầu gửi”; còn người thì bấm “Gửi tiếp … người”.",
      "Có lỗi thì mở “Chi tiết … trường hợp”; dòng “Không mời được” ghi lý do như “Chưa có email” hay “Email trùng với người khác”."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team, Support team — và phải có quyền vận hành đúng mùa đang chọn.",
      "Mỗi lượt hàng loạt gửi tối đa 20 thư và không bao giờ gửi lại cho người đã nhận thư. Gửi lại trên từng dòng phải chờ 10 phút (“Gửi lại được sau …”).",
      "Hạn mức Brevo 300 thư/24 giờ dùng chung cho mọi loại thư; chạm hạn mức thì tiếp tục vào hôm sau. Người “Không tham dự” không được mời."
    ],
    updated: "02/10/2026"
  },
  "/applications": {
    title: "Ứng tuyển (Tất cả)",
    summary: "Danh sách mọi đơn ứng tuyển mentor/mentee trong phạm vi bạn được xem, kèm trạng thái xử lý. Dùng để tra cứu, lọc, mở chi tiết từng đơn và đi tới các màn hình xử lý hàng loạt.",
    steps: [
      "Gõ tên, email, SBD hoặc mã đơn vào ô tìm kiếm phía trên bảng để tìm nhanh một ứng viên.",
      "Thu hẹp danh sách bằng các ô lọc “Trạng thái”, “Vai trò ứng tuyển”, “Mùa”, “Đợt tuyển”, “Đồng ý lưu trữ”; bấm “Xoá bộ lọc” để xem lại toàn bộ.",
      "Chọn thứ tự ở ô “Sắp xếp”: “Ngày nộp mới nhất”, “Tên ứng viên A-Z” hoặc “Trạng thái A-Z”; dùng “Trước”/“Sau” để chuyển trang.",
      "Bấm “Xem chi tiết” ở cuối dòng để mở hồ sơ đầy đủ, xem các đánh giá và ra quyết định (nếu bạn có quyền).",
      "Cần xử lý theo lô thì dùng các nút phía trên bảng: “Xuất kết quả tuyển / điểm review”, “Mời phỏng vấn hàng loạt”, “Duyệt chính thức hàng loạt”."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Reviewer được chuyển sang trang “Đánh giá”.",
      "Cột “Người đánh giá hồ sơ”, “Người phỏng vấn” và nút “Xuất kết quả tuyển / điểm review” chỉ hiện cho Super admin, Admin, Core team.",
      "“Mời phỏng vấn hàng loạt” và “Duyệt chính thức hàng loạt” hiện cho cả Support team, nhưng Support team chỉ quyết định được hồ sơ Mentee; hồ sơ Mentor do Core team trở lên.",
      "Hồ sơ mentee gõ sai email: mở “Xem chi tiết”, ở bảng “Thư mời chọn ca phỏng vấn” điền email đúng rồi “Sửa email & gửi lại thư mời chọn ca” → “Xác nhận gửi”."
    ],
    updated: "02/10/2026"
  },
  "/applications/mentor-review": {
    title: "Duyệt Mentor S12",
    summary: "Hàng đợi đơn ứng tuyển Mentor mùa S12 đang ở trạng thái “Đã nộp / Chờ xử lý”. Dùng để mở từng đơn ra quyết định vòng hồ sơ, hoặc xử lý nhanh nhiều đơn trên cùng một trang.",
    steps: [
      "Gõ tên, email hoặc SBD vào ô “Tìm kiếm”, chọn “Loại Mentor” (“Mentor mới”, “Mentor cũ quay lại”, “Chưa xác định”) rồi bấm “Áp dụng”; bấm “Xóa lọc” để bỏ lọc.",
      "Xem cột “Điểm cộng” (điểm cộng theo ngày nộp) và “Trạng thái”; dùng “Trước”/“Sau” để chuyển trang (25 đơn mỗi trang).",
      "Bấm “Duyệt” ở cuối dòng để mở chi tiết đơn; ở mục “Quyết định của Admin / Core team”, chọn “Quyết định vòng hồ sơ” rồi bấm “Ghi nhận quyết định”.",
      "Xử lý nhiều đơn: tick ô ở cột “Chọn” hoặc “Chọn tất cả hồ sơ trên trang này”, nhập “Ghi chú chung” nếu cần.",
      "Bấm “Cần review thêm” hoặc “Không phù hợp” (có hộp xác nhận); kết quả hiện ở khung thông báo đầu trang."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Ô chọn và nút xử lý hàng loạt chỉ hiện cho Super admin, Admin, Core team — kết quả Mentor không do Support team quyết định.",
      "Mỗi lần xử lý hàng loạt tối đa 25 hồ sơ, chỉ trên trang đang xem. Đơn đã đổi trạng thái kể từ lúc mở trang sẽ bị bỏ qua và được báo lại.",
      "“Mời phỏng vấn” chọn trong chi tiết từng đơn hoặc ở “Mời phỏng vấn hàng loạt”. Lọc “Loại Mentor” báo lỗi khi có hơn 500 hồ sơ — gõ thêm từ khoá tìm kiếm."
    ],
    updated: "02/10/2026"
  },
  "/applications/mentee-review": {
    title: "Duyệt Mentee S12",
    summary: "Hàng đợi đơn ứng tuyển Mentee mùa S12 đang ở trạng thái “Đã nộp / Chờ xử lý”. Dùng để mở từng đơn ra quyết định vòng hồ sơ, hoặc xử lý nhanh nhiều đơn trên cùng một trang.",
    steps: [
      "Gõ tên, email hoặc SBD vào ô “Tìm theo tên, email hoặc SBD” rồi bấm “Tìm kiếm”.",
      "Xem cột “Điểm cộng” (điểm cộng theo ngày nộp) và “Trạng thái”; dùng “Trước”/“Sau” để chuyển trang (25 đơn mỗi trang).",
      "Bấm “Duyệt” ở cuối dòng để mở chi tiết đơn; ở mục “Quyết định của Admin / Core team”, chọn “Quyết định vòng hồ sơ” rồi bấm “Ghi nhận quyết định”.",
      "Xử lý nhiều đơn: tick ô ở cột “Chọn” hoặc “Chọn tất cả hồ sơ trên trang này”, nhập “Ghi chú chung” nếu cần.",
      "Bấm “Cần review thêm” hoặc “Không phù hợp” (có hộp xác nhận); kết quả hiện ở khung thông báo đầu trang."
    ],
    notes: [
      "Mở được và xử lý hàng loạt được: Super admin, Admin, Core team, Support team. Reviewer được chuyển sang trang “Đánh giá”.",
      "Mỗi lần xử lý hàng loạt tối đa 25 hồ sơ, chỉ trên trang đang xem. Đơn đã đổi trạng thái kể từ lúc mở trang sẽ bị bỏ qua và được báo lại.",
      "Ô “Điểm cộng” ghi “Chưa rõ” nghĩa là chưa đọc được mốc điểm cộng, không phải 0 điểm. Mốc được đặt ở trang “Điểm cộng theo ngày nộp”."
    ],
    updated: "02/10/2026"
  },
  "/admin/seasons-forms/bonus-points": {
    title: "Điểm cộng theo ngày nộp",
    summary: "Đặt các mốc “nộp trong khoảng ngày nào thì được cộng bao nhiêu điểm” cho form tuyển Mentee và form tuyển Mentor của đợt S12. Thêm hay xoá mốc có hiệu lực ngay, kể cả với đơn đã nộp.",
    steps: [
      "Đọc khung “Cách tính”, rồi tìm thẻ “Form tuyển Mentee” hoặc “Form tuyển Mentor” cần đặt mốc.",
      "Ở mục “Thêm mốc”, nhập “Nộp từ ngày” và/hoặc “Đến hết ngày” theo dạng dd/mm/yyyy; để trống một ô nếu không giới hạn phía đó.",
      "Nhập “Cộng thêm (điểm)”, điền “Tên mốc (không bắt buộc)” nếu muốn, rồi bấm “Thêm mốc cho form mentee” (hoặc “Thêm mốc cho form mentor”).",
      "Kiểm tra bảng mốc: cột “Cộng”, “Số đơn” và số đơn đang được cộng điểm ghi ở đầu thẻ.",
      "Muốn bỏ một mốc, bấm “Xoá” ở dòng đó rồi xác nhận; các đơn trong mốc đó sẽ không còn được cộng.",
      "Bấm “Xem điểm cộng trong danh sách duyệt mentee →” (hoặc mentor) để xem kết quả trên hàng đợi duyệt."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team, Support team, và phải có quyền vận hành mùa S12.",
      "Ngày nộp tính theo giờ Việt Nam, mốc tính đến 23:59 ngày kết thúc. Đơn rơi vào nhiều mốc nhận mốc cao nhất, không cộng dồn. Điểm từ 1 đến 100, tối đa 20 mốc mỗi form.",
      "Điểm cộng vào tổng điểm của từng reviewer (thang 25), hiện ở danh sách duyệt, chi tiết đơn và CSV điểm review; reviewer không thấy khi đang chấm. Mọi lần thêm/xoá đều được ghi nhật ký."
    ],
    updated: "02/10/2026"
  },
  "/reviews": {
    title: "Đánh giá",
    summary: "Danh sách phân công chấm hồ sơ và phỏng vấn. Reviewer thấy “Reviews của tôi” gồm các đơn được giao cho mình; Super admin, Admin, Core team thấy “Tất cả Reviews” để theo dõi toàn bộ.",
    steps: [
      "Chọn “Đợt tuyển”, “Vai trò ứng tuyển”, “Vòng review”, “Trạng thái review” (ban điều hành có thêm “Mùa”, “Reviewer / Interviewer”) rồi bấm “Lọc”; “Xóa bộ lọc” để về mặc định.",
      "Ưu tiên các dòng có nhãn “Quá hạn” hoặc “Sắp đến hạn” ở cột “Hạn nộp”.",
      "Bấm “Hướng dẫn chấm điểm” để xem mô tả 5 tiêu chí trước khi chấm.",
      "Bấm “Làm review” để mở phiếu: chấm 5 tiêu chí từ 1 đến 5, chọn “Đề xuất kết quả” và viết “Ghi chú reviewer”.",
      "Bấm “Lưu nháp” để lưu dở, hoặc “Nộp Review” khi xong; phiếu đã nộp chỉ còn xem được.",
      "Ban điều hành dùng các nút “Chia hồ sơ review”, “Tiến độ review”, “Danh sách reviewer”, “Cấu hình số review” ở đầu trang."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Reviewer. Support team không vào trang này mà giao hồ sơ ở “Giao hồ sơ đánh giá”.",
      "Chỉ người được giao mới sửa và nộp được phiếu. Ban điều hành mở phiếu của người khác chỉ để xem, “Huỷ Review này” hoặc “Đổi Người Review”.",
      "Tick “Hiện cả lịch sử” để xem cả phân công đã huỷ và hồ sơ đã kết thúc quy trình; các dòng này chỉ để xem lại."
    ],
    updated: "02/10/2026"
  },
  "/reviews/assign-bulk": {
    title: "Giao hồ sơ đánh giá",
    summary: "Giao một lô hồ sơ (vòng đánh giá hồ sơ hoặc phỏng vấn) cho một người phụ trách, kèm hạn hoàn tất; và huỷ phân công để trả hồ sơ về hàng chờ.",
    steps: [
      "Ở “Bước 1”, chọn “Đợt tuyển”, “Role ứng tuyển” và “Vòng phân công” (“Đánh giá hồ sơ” hoặc “Phỏng vấn”), rồi bấm “Tiếp tục”.",
      "Ở tab “Chưa giao”, tick từng hồ sơ hoặc bấm “Chọn cả trang” (mỗi trang là một lô 10 hồ sơ, cũ nhất trước); dùng ô “Tìm tên, email...” để lọc.",
      "Ở mục “GIAO CHO NGƯỜI PHỤ TRÁCH”, chọn người ở ô “Người đánh giá hồ sơ” (hoặc “Người phỏng vấn”) và đặt hạn hoàn tất nếu cần (tuỳ chọn).",
      "Giữ tick “Gửi thư báo cho người chấm” nếu muốn báo qua email (chỉ vòng hồ sơ), rồi bấm “Xác nhận giao hồ sơ” (hoặc “Xác nhận giao phỏng vấn”).",
      "Trả hồ sơ về hàng chờ: chọn hồ sơ ở tab “Đã giao”, nhập “Lý do huỷ” rồi bấm “Huỷ phân công đã chọn”."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team, Support team, và phải có quyền vận hành mùa của đợt tuyển. Core team vào từ nút “Chia hồ sơ review” trên trang “Đánh giá”.",
      "Chỉ hồ sơ chưa giao mới giao được. Hạn tính hết ngày theo giờ Việt Nam, không được là ngày đã qua. Huỷ tối đa 25 hồ sơ mỗi lần; điểm và ghi chú cũ vẫn giữ trong lịch sử.",
      "Ô chọn người phụ trách trống thì vào “Danh sách nhân sự tuyển sinh” để cấp quyền trước. Thư báo gửi lỗi thì hồ sơ vẫn đã được giao, không cần giao lại."
    ],
    updated: "02/10/2026"
  },
  "/reviews/reviewer-pool": {
    title: "Danh sách nhân sự tuyển sinh",
    summary: "Cấp hoặc thu hồi quyền chấm hồ sơ và phỏng vấn theo mùa cho mentor của đợt tuyển. Người chưa có tài khoản sẽ được tạo tài khoản và nhận thư đặt mật khẩu.",
    steps: [
      "Chọn “Đợt tuyển” rồi bấm “Lọc”; chưa chọn đợt thì các nút cấp quyền bị khoá.",
      "Lọc nhanh bằng các nút “Tất cả”, “Chưa có tài khoản”, “Đang có quyền đánh giá”, “Đã thu hồi quyền đánh giá”, “Admin / Core team”, hoặc tìm theo tên, email, mentor code.",
      "Ở cột “Thao tác”, bấm “Cấp quyền đánh giá” hoặc “Cấp quyền phỏng vấn”; bấm “Thu hồi quyền đánh giá” hoặc “Thu hồi quyền phỏng vấn” để gỡ.",
      "Cấp cho nhiều người: mở “Cấp quyền hàng loạt (dán danh sách email)”, dán mỗi dòng một email, chọn “Cấp quyền gì” rồi bấm “Cấp quyền + gửi thư cho danh sách này”.",
      "Đọc kết quả bên dưới: người đã xử lý, người thất bại, email không khớp mentor của đợt, và người “CHƯA xử lý” vì chạm hạn mức thư."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team, Support team, và phải có quyền vận hành mùa đó. Tài khoản Admin/Core team đang hoạt động có quyền theo vai trò, không cần cấp.",
      "Người chưa có tài khoản sẽ được tạo tài khoản và nhận thư đặt mật khẩu; nhắc họ xem cả mục Spam. Thư chưa gửi được thì bấm Thu hồi rồi Cấp lại.",
      "Hạn mức thư Brevo dùng chung 300 thư/24 giờ: người chưa xử lý thì dán lại đúng danh sách và bấm lượt sau, cách vài giờ. Email phải đúng email mentor dùng khi nộp đơn."
    ],
    updated: "02/10/2026"
  },
  "/interviews": {
    title: "Phỏng vấn",
    summary: "Trang “Phỏng vấn ứng viên” dành cho interviewer: tìm ứng viên đã được mời phỏng vấn trong một đợt tuyển và mở phiếu phỏng vấn để ghi nhận kết quả.",
    steps: [
      "Chọn “Đợt tuyển” và “Vai trò ứng tuyển” (“Mentee” hoặc “Mentor”), rồi bấm “Xem ứng viên”. Bấm “Đặt lại” để chọn lại từ đầu.",
      "Lọc nhanh bằng các nút trạng thái “Tất cả”, “Đã mời”, “Đã lên lịch”, “Đang PV”, “Đã hoàn thành”, “Sẵn sàng quyết định”, hoặc gõ tên/SBD vào ô tìm kiếm.",
      "Ở cột “Thao tác”, bấm “Bắt đầu phỏng vấn” để mở phiếu phỏng vấn của ứng viên được giao cho mình; phiếu đã mở trước đó thì bấm “Tiếp tục phỏng vấn”.",
      "Hệ thống chuyển sang trang phiếu đánh giá để chấm và ghi nhận xét. Cột “Review PV” cho biết phiếu đang ở trạng thái nào.",
      "Dùng hai nút trên đầu trang để sang “Xem lại application và kết quả phỏng vấn mentor S12” hoặc “Phỏng vấn mentee trực tiếp · Check-in và chấm theo ca”."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Reviewer; tài khoản còn phải được cấp vai trò người phỏng vấn của mùa. Support team và Viewer không vào được trang này.",
      "Nút không tự tạo phân công mới: ứng viên chưa được Core team giao cho mình sẽ báo “Bạn chưa được phân công phỏng vấn ứng viên này.”",
      "Reviewer chỉ tìm được theo tên hoặc SBD, tên ứng viên không bấm mở được, và email/SĐT chỉ hiện sau khi đã có phiếu phỏng vấn của chính mình."
    ],
    updated: "02/10/2026"
  },
  "/interviews/lich": {
    title: "Lịch phỏng vấn",
    summary: "Lịch phỏng vấn mentor 1:1 (mỗi buổi online 60 phút, khung 07:00–22:00): interviewer đăng giờ rảnh và ghép mentor đang chờ; Ban tổ chức điều hành lịch.",
    steps: [
      "Ở “Giờ rảnh của tôi”, điền “Số điện thoại của anh/chị” (đúng 10 chữ số, bắt buộc trước lần lưu đầu); số này ghi vào thư xác nhận gửi mentor.",
      "Tick các ô giờ mình rảnh trong lưới (nút “cả ngày” chọn hoặc bỏ cả hàng), rồi bấm “Lưu giờ rảnh”. Dòng “Đang chờ lưu” cho biết số giờ sắp thêm và gỡ.",
      "Ô “Đặt” là buổi đã có mentor giữ; bấm “Đặt ↗” để mở hồ sơ ứng viên của buổi đó.",
      "Ở “Mentor đang chờ được ghép”, bấm một khung giờ (vd. “09h · 2 chờ”) rồi xác nhận: người khai giờ đó sớm nhất được ghép, buổi hẹn chốt ngay và thư gửi cho cả hai bên.",
      "Ban tổ chức: theo dõi các ô số liệu và bảng interviewer, bấm “Gửi thư mời/nhắc ngay” để gửi thư đến hạn; ở “Lịch hẹn sắp diễn ra”, bấm “Huỷ lịch”, ghi lý do (không bắt buộc) rồi OK."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Reviewer; Reviewer phải được cấp vai trò người phỏng vấn cho mùa. Phần điều hành (gửi thư, huỷ lịch) chỉ Super admin, Admin, Core team thấy.",
      "Không tự bỏ được ô đã có mentor đặt: muốn trả giờ đó thì nhờ Ban tổ chức huỷ lịch. Huỷ lịch mở lại khung giờ và gửi thư báo huỷ cho hai bên.",
      "Thư mời/nhắc chỉ tự gửi khi có một tab đang mở trang này (khoảng 20 giây một lượt); đóng tab thì đợt gửi kế tiếp chờ người mở lại trang hoặc cron sáng nếu đã bật."
    ],
    updated: "02/10/2026"
  },
  "/interviews/ket-qua-mentor": {
    title: "Kết quả phỏng vấn Mentor S12",
    summary: "Xem lại application, điểm và nhận xét phỏng vấn mentor mùa 12 sau khi lưu, kể cả hồ sơ đã duyệt, không phù hợp hoặc đang chờ quyết định; xuất toàn bộ kết quả khi cần.",
    steps: [
      "Gõ vào ô “Tìm mentor hoặc interviewer” (tên, email, SĐT) hoặc chọn “Trạng thái hồ sơ” để thu hẹp danh sách phiếu.",
      "Đọc mục “Kết quả và ghi chú phỏng vấn” của từng phiếu: điểm 5 tiêu chí, “Tổng” trên 25, đề xuất và “Nhận xét của interviewer”.",
      "Bấm “Xem application” để mở hồ sơ. Vai trò khác Reviewer còn mở được “Quyết định và ghi chú BTC” và bấm “Tải application PDF” hoặc “Tải application CSV”.",
      "Vừa lưu phiếu mà chưa thấy trong danh sách thì bấm “Làm mới kết quả”.",
      "Cần file của cả mùa: ở cuối trang bấm “Xuất PDF toàn bộ S12” hoặc “Xuất Excel toàn bộ S12”."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team, Reviewer, khi có quyền trong mùa 12. Reviewer chỉ thấy phiếu của chính mình và không thấy quyết định BTC.",
      "Phần xuất toàn bộ chỉ hiện cho Super admin, Admin, Core team có quyền vận hành mùa 12. Bộ lọc tìm kiếm không thu hẹp file xuất.",
      "Danh sách gồm cả phiếu đang lưu nháp, không gồm phân công chưa bắt đầu hoặc đã hủy. Một mentor có nhiều interviewer sẽ có nhiều phiếu."
    ],
    updated: "02/10/2026"
  },
  "/matches": {
    title: "Ghép cặp",
    summary: "Tạo và quản lý ghép cặp mentor – mentee thủ công trong mùa đang chọn: xem danh sách match, tạo cặp mới theo đợt tuyển và huỷ cặp khi cần.",
    steps: [
      "Chọn mùa ở ô “Mùa vận hành”; chọn “Đợt tuyển”, “Trạng thái” rồi bấm “Lọc”. Mặc định chỉ hiện match “Đang đồng hành”; “Xoá lọc” để về mặc định.",
      "Tạo cặp: chọn một đợt tuyển và bấm “Lọc” để mở khung “Tạo matching thủ công”, rồi tìm và chọn “Mentor (*)” và “Mentee (*)”.",
      "Bấm “Xem hồ sơ” để đọc nhanh hồ sơ ứng tuyển mà không mất lựa chọn; ghi “Ghi chú nội bộ” nếu cần rồi bấm “Tạo matching”.",
      "Xem khung “Tải mentor trong batch” để biết mỗi mentor đã nhận bao nhiêu mentee so với sức nhận.",
      "Huỷ cặp: bấm “Hủy match” trên dòng đang đồng hành, ghi lý do (tuỳ chọn), bấm “Xác nhận hủy”. Bấm “Chi tiết” để xem thông tin match."
    ],
    notes: [
      "Xem: Super admin, Admin, Core team, Support team. Tạo và huỷ match: chỉ Super admin, Admin, Core team.",
      "Mentor và mentee phải được duyệt chính thức trong mùa của đợt tuyển. Mỗi mentee chỉ có một mentor đang active; mentor đã đủ sức nhận hiện “FULL” và không chọn được.",
      "Huỷ match chuyển cặp sang “Đã dừng”, lịch sử không bị xoá. Muốn đổi mentor cho một mentee: huỷ match cũ trước rồi tạo match mới."
    ],
    updated: "02/10/2026"
  },
  "/events": {
    title: "Sự kiện",
    summary: "Danh sách sự kiện và hoạt động của chương trình (orientation, training, networking, closing…), kèm số đăng ký và tình hình tham gia của từng buổi.",
    steps: [
      "Lọc theo “Mùa”, “Loại sự kiện”, “Đợt tuyển”, “Trạng thái” rồi bấm “Lọc”; “Xoá lọc” để về mặc định (chỉ sự kiện “Đang hoạt động”).",
      "Đọc bảng: cột “Đăng ký” (kèm số “chờ” duyệt), “Tổng SL” và “Đã tham gia / Vắng / Chưa cập nhật”.",
      "Bấm tên sự kiện hoặc “Chi tiết” để lấy “Liên kết đăng ký công khai”, “Mở máy quét điểm danh” hoặc “Tải danh sách (CSV)”.",
      "Bấm “Quản lý tham gia” để cập nhật tình trạng tham gia và điểm danh thủ công.",
      "Bấm “Tạo sự kiện” để tạo buổi mới (tên, loại, mùa, thời gian, địa điểm, cấu hình đăng ký & check-in); bấm “Sửa” để chỉnh một sự kiện có sẵn."
    ],
    notes: [
      "Support team chỉ xem danh sách; “Chi tiết”, “Quản lý tham gia”, “Tạo sự kiện”, “Sửa” dành cho Super admin, Admin, Core team.",
      "Buổi Orientation cho Mentor có thêm dòng “Cũ … · Mới …” ở cột “Đăng ký”: mentor cũ là email trùng người từng làm mentor ở mùa khác.",
      "Sự kiện đã hủy chỉ hiện khi chọn “Trạng thái” là “Đã hủy” hoặc “Tất cả”."
    ],
    updated: "02/10/2026"
  },
  "/data-issues": {
    title: "Rà soát dữ liệu",
    summary: "Liệt kê các vấn đề dữ liệu cần làm sạch, tính trực tiếp từ dữ liệu hiện tại: thiếu SĐT, đơn thiếu tên/email, mentee thiếu trường, mentor thiếu profile link, match lỗi, email trùng.",
    steps: [
      "Xem bảy ô số liệu đầu trang để biết mỗi loại vấn đề còn bao nhiêu dòng.",
      "Bấm tiêu đề từng mục (từ “A. Người dùng thiếu số điện thoại” tới “G. Email trùng”) để mở hoặc thu gọn; số “vấn đề” hiện ở góc phải mỗi mục.",
      "Từ bảng “Cảnh báo dữ liệu cần rà soát” ở trang Tổng quan, bấm “Mở trang” để mở đúng mục đó; bấm “Xem tất cả cảnh báo” để mở lại mọi mục.",
      "Bấm “Xem hồ sơ”, “Xem đơn” hoặc “Xem match” trên từng dòng (ở mục Email trùng thì bấm tên người) để mở bản ghi và sửa ở đó.",
      "Một buổi mentoring thiếu recap: bấm “Thêm recap thủ công” để sang trang tạo recap."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Nút “Thêm recap thủ công” chỉ hiện với Super admin, Admin, Core team.",
      "Trang chỉ để rà soát, chưa sửa trực tiếp được. Sửa xong ở hồ sơ, đơn hoặc match, tải lại trang thì dòng đó không còn trong danh sách.",
      "Các bảng hiện họ tên, email, số điện thoại thật; số liệu tính trong phạm vi chương trình bạn được cấp."
    ],
    updated: "02/10/2026"
  },
  "/admin": {
    title: "Quản trị",
    summary: "Trang “Quy trình điều chỉnh dữ liệu”: rà soát recap có vấn đề, giao và theo dõi việc follow-up, sửa hoặc ẩn recap gần đây mà không cần sửa CSV/DB thủ công.",
    steps: [
      "Tab “Rà soát dữ liệu”: xem các thẻ số (Recap chưa khớp match, Thiếu mentee, Thiếu mentor, Ngày không hợp lệ, Recap trùng lặp) và “Danh sách dữ liệu cần kiểm tra”.",
      "Với một vấn đề chưa có việc, điền “Owner email” rồi bấm “Tạo action”; khi đã có việc, ghi “Ghi chú xử lý” rồi bấm “Xử lý xong”.",
      "Bấm “Mở correction cũ” hoặc “Mở recap” để xem bản ghi gốc; cần thêm recap thủ công thì bấm “Mở trang Tạo mentoring recap”.",
      "Ở “Edit / soft delete recap gần đây”, mở một recap, sửa các ô, ghi “Lý do điều chỉnh” rồi bấm “Lưu recap”; muốn ẩn thì ghi “Lý do ẩn bản ghi” và bấm “Ẩn bản ghi”.",
      "Tab “Hỗ trợ follow-up”: tạo việc ở “Tạo follow-up thủ công”; ở từng việc chọn “Trạng thái”, sửa “Email người phụ trách”, ghi “Thêm ghi chú” rồi bấm “Lưu”."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team, kèm quyền vận hành (operations) trong phạm vi chương trình. Nút “Tài khoản” sang trang quản lý người dùng chỉ hiện cho Super admin.",
      "“Danh sách dữ liệu cần kiểm tra” chỉ hiện 30 vấn đề đang mở đầu tiên; phần recap gần đây hiện 10 recap; “Lịch sử việc cần xử lý” hiện 20 việc mới nhất."
    ],
    updated: "02/10/2026"
  },
  "/admin/renewals": {
    title: "Gia hạn mentor S12",
    summary: "Tạo link gia hạn cá nhân cho mentor Season 12, theo dõi phản hồi, đối chiếu thay đổi hồ sơ mentor đề xuất và xác nhận hoàn tất gia hạn.",
    steps: [
      "Nhiều mentor: ở “Tạo link gia hạn hàng loạt”, gõ “Tìm mentor”, tick chọn, đặt “Hiệu lực (ngày)”, bấm “Tạo link cho … mentor” rồi “Xác nhận tạo … link”.",
      "Một mentor: ở “Tạo link gia hạn cá nhân”, chọn “Mentor”, đặt “Hiệu lực (ngày)” rồi bấm “Tạo link”.",
      "Ngay sau khi tạo, bấm “Sao chép link đầy đủ”, “Sao chép” hoặc “Tải CSV” để lấy link, rồi tự gửi cho mentor qua Gmail/Zalo.",
      "Ở “Danh sách invite”, lọc bằng “Tìm mentor”, “Trạng thái”, “Nguồn” rồi bấm “Lọc” (“Xóa lọc” để bỏ). Dùng “Thu hồi” hoặc “Tạo lại” khi cần đổi link.",
      "Mentor đã “Đồng ý”: đọc “Thay đổi hồ sơ chờ xác nhận” và cam kết, rồi bấm “Xác nhận & hoàn tất” để duyệt gia hạn."
    ],
    notes: [
      "Dùng được: Super admin, Admin, Core team có quyền vận hành (operations) mùa UEHM-S12. Mỗi lượt hàng loạt tối đa 25 mentor.",
      "Hệ thống không tự gửi email. Link chỉ hiển thị một lần: tải lại trang là mất link thô, khi đó phải bấm “Tạo lại” (link cũ bị thu hồi).",
      "Khung đỏ “Cần operator xử lý membership” báo phản hồi từ chối chưa được đối soát tự động. Mentor cũ chưa có trong danh sách thì dùng “Import / thêm legacy mentor”."
    ],
    updated: "02/10/2026"
  },
  "/admin/seasons-forms": {
    title: "Mùa & Form đăng ký",
    summary: "Điều khiển trạng thái công khai của form đăng ký Mentor và Mentee Season 12 (ĐÓNG, PILOT, MỞ CÔNG KHAI). Thay đổi có hiệu lực ngay, không cần deploy lại.",
    steps: [
      "Xem thẻ “Mentor” và “Mentee”: dòng “Trạng thái” hiện trạng thái đang áp dụng và ai thay đổi lần cuối.",
      "Bấm “Sao chép link” hoặc “Mở trang” để lấy hoặc kiểm tra link form công khai.",
      "Đổi trạng thái: bấm “Đóng”, “Pilot (cần token)” hoặc “Mở công khai” rồi xác nhận ở hộp thoại. Nút của trạng thái đang áp dụng ghi “· hiện tại”.",
      "Sửa lời giới thiệu, hạn nộp, người liên hệ: bấm “Sửa chữ trên form →”. Đặt điểm cộng theo ngày nộp: bấm “Đặt điểm cộng →”.",
      "Xem “Lịch sử thay đổi” để biết ai đã mở/đóng form và vào lúc nào."
    ],
    notes: [
      "Mở được trang: Super admin, Admin, Core team. Chỉ Super admin hoặc Admin có quyền vận hành mùa UEHM-S12 mới đổi được trạng thái form; Core team chỉ xem nhưng vẫn sửa được chữ trên form.",
      "Đóng form: đơn mới bị từ chối ngay, kể cả người đang điền dở; đơn đã nộp không bị ảnh hưởng. PILOT: chỉ người có link kèm token mới nộp được.",
      "Gặp báo “Trạng thái đã được thay đổi bởi người khác” thì tải lại trang rồi làm lại. Sửa chữ không đổi được ô cần điền và câu cam kết."
    ],
    updated: "02/10/2026"
  },
  "/team": {
    title: "Phân công & Trách nhiệm",
    summary: "Tổng hợp phân công của Core team và Support team: ai phụ trách khu vực, vai trò, team và phạm vi nào, trạng thái ra sao. Trang chỉ để xem, không sửa phân công ở đây.",
    steps: [
      "Xem các ô “Tổng phân công”, “Đang hoạt động”, “Core team”, “Support team” (đếm theo bộ lọc đang áp dụng).",
      "Gõ vào ô “Tìm kiếm (tên / email / team / ghi chú)”, chọn “Nhóm”, “Khu vực phụ trách”, “Trạng thái” rồi bấm “Lọc”; bấm “Xoá lọc” để về danh sách đầy đủ.",
      "Cần xem theo mùa: gõ mã mùa vào ô tìm kiếm, vì phạm vi phụ trách được ghi dạng chữ tự do.",
      "Đọc bảng “Core team” và “Support team”: cột “Khu vực / Vai trò”, “Team / Phạm vi”, “Trạng thái”, “Ghi chú”.",
      "Bấm “Xem hồ sơ” để mở hồ sơ đầy đủ của người đó."
    ],
    notes: [
      "Mở được: Super admin, Admin, Core team, Support team. Trên menu, mục này nằm trong nhóm “Quản trị” nên chỉ Super admin, Admin, Core team thấy.",
      "Dòng có nhóm gốc không phải Core team/Support team hiện ở mục “Phân công khác / chưa phân loại nhóm” và cần được rà soát, cập nhật."
    ],
    updated: "02/10/2026"
  },
  "/admin/users": {
    title: "Quản lý người dùng",
    summary: "Quản lý tài khoản ban tổ chức cấp dưới mình: sửa vai trò, trạng thái và phạm vi program/season, gửi link đặt mật khẩu, tạm khóa, ngừng quyền hoặc xoá hẳn tài khoản.",
    steps: [
      "Chọn chương trình và season ở bộ chọn phạm vi phía trên (“Chọn chương trình”, “Chọn season”); chưa chọn thì biểu mẫu tạo tài khoản và sửa phạm vi bị khoá.",
      "Super admin: điền “Thêm user quản trị” (Email, Họ tên, Vai trò, Season, Program, Phân quyền) rồi bấm “Tạo / mời người dùng”; người dùng nhận thư để tự đặt mật khẩu.",
      "Ở “Danh sách người dùng”, bấm “Sửa” ở dòng cần đổi, chỉnh Họ tên, Vai trò, Trạng thái, Program, Season, scope_level, scope_status rồi bấm “Lưu thay đổi”.",
      "Bấm “Gửi link đặt mật khẩu” khi người dùng chưa nhận thư hoặc quên mật khẩu; “Tạm khóa” / “Kích hoạt lại” để đổi trạng thái; “Xóa quyền admin” để ngừng quyền.",
      "Xoá hẳn: bấm “Xoá hẳn tài khoản”, gõ lại email ở “Gõ lại email để xác nhận”, ghi “Lý do xoá” rồi bấm “Xoá hẳn”."
    ],
    notes: [
      "Mở được: Super admin (quản Admin trở xuống), Admin (quản Core team trở xuống), Core team (quản Support team, Reviewer, Viewer). Chỉ sửa cấp thấp hơn mình, không tự thao tác trên tài khoản của mình.",
      "Menu chỉ hiện mục này cho Super admin; Admin và Core team vào bằng đường dẫn /admin/users. Tạo tài khoản, “Đồng bộ Auth”, “Import CSV an toàn” và nhật ký quyền chỉ dành cho Super admin.",
      "Xoá hẳn không hoàn lại được; tài khoản đã chấm bài hoặc có nhật ký thao tác sẽ bị từ chối, khi đó dùng “Xóa quyền admin”. Không khóa hay hạ quyền được Super admin cuối cùng."
    ],
    updated: "02/10/2026"
  }
};
