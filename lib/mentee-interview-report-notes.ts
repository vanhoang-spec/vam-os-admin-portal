import type { OfflineOutcome } from "@/lib/mentee-offline-core";

/**
 * lib/mentee-interview-report-notes.ts — phần PHÂN TÍCH NHẬN XÉT của báo cáo phỏng
 * vấn mentee theo đợt (BTC 06/10/2026).
 *
 * Số liệu của báo cáo đọc trực tiếp từ database; phần này thì không tính được — nó
 * là kết quả đọc toàn bộ ô nhận xét trên phiếu của mentor rồi rút ra mẫu hình. Vì
 * thế nó là một BẢN CHỤP: ghi rõ viết ngày nào, dựa trên bao nhiêu phiếu, và trang
 * tự báo khi số phiếu hiện tại đã khác số phiếu lúc phân tích.
 *
 * Không có tên mentee, tên trường, tên công ty trong trích dẫn — chỉ là lời mentor
 * đã bỏ phần nhận diện được người.
 */

export type NotePattern = {
  title: string;
  detail: string;
  /** "khoảng 120/265 phiếu" */
  count?: string;
  /** Phần phiếu nơi mẫu hình xuất hiện. */
  where?: string;
  quotes?: string[];
};

export type NoteTheme = { label: string; count: string };

export type NoteSection = {
  title: string;
  intro?: string;
  patterns?: NotePattern[];
  themes?: NoteTheme[];
  bullets?: string[];
};

export type WaveNotes = {
  /** Khoá đợt — ngày đầu đợt, YYYY-MM-DD (xem interviewWaves). */
  waveKey: string;
  /** DD/MM/YYYY */
  writtenOn: string;
  /** Số phiếu đã đọc lúc phân tích, theo nhóm — để biết bản chụp đã cũ hay chưa. */
  basis: Record<OfflineOutcome, number> & { taken: number };
  method: string;
  groups: Record<OfflineOutcome, NoteSection[]>;
  takenVsRest: NoteSection[];
  dataQuality?: string[];
};

// ---------------------------------------------------------------------------
// Đợt 1 · 03–04/10/2026 — đọc toàn bộ 370 phiếu ngày 06/10/2026.

const WAVE1_PASSED: NoteSection[] = [
  {
    title: "Mẫu hình chung",
    patterns: [
      {
        title: "Có nhu cầu thật nhưng đang mông lung về hướng đi — mentoring đúng chỗ",
        count: "khoảng 77/265 phiếu",
        where: "Tiêu chí Nhu cầu Mentoring; Lý do chọn; Nhu cầu phát triển chính",
        detail:
          "Kiểu Đạt phổ biến nhất. Mentee đang phân vân giữa các ngành, chuyên ngành, chưa biết mình hợp với gì; mentor cho Đạt chính vì thấy một người đồng hành sẽ giúp bạn bớt mông lung. Chưa rõ hướng không bị coi là điểm trừ.",
        quotes: [
          "Mentor cần giúp em chuyển từ “tìm hiểu và suy nghĩ” sang “trải nghiệm, kiểm chứng, lựa chọn”",
          "Bạn có định hướng cho công việc nhưng chưa thực sự rõ ràng, chưa biết mình thực sự cần gì"
        ]
      },
      {
        title: "Đã biết mình muốn gì, chỉ cần người chỉ con đường",
        count: "khoảng 56/265 phiếu",
        where: "Lý do chọn; Tiêu chí Nhu cầu Mentoring",
        detail:
          "Ngược với kiểu trên: mentee có mục tiêu rõ, trình bày trăn trở mạch lạc, có kế hoạch. Thứ bạn cần là lộ trình và góc nhìn thực tế từ người đi trước. Nhóm này thường có điểm cao.",
        quotes: [
          "Bạn rõ ràng định hướng của mình nhưng cần hướng dẫn con đường để theo đuổi định hướng đó",
          "Có mục tiêu rõ ràng, kế hoạch và back-up solutions cho các tình huống phát sinh."
        ]
      },
      {
        title: "Cầu thị, biết lắng nghe và tiếp nhận góp ý",
        count: "khoảng 123/265 phiếu",
        where: "Tiêu chí Sẵn sàng học hỏi; Lý do chọn",
        detail:
          "Phẩm chất được nhắc đều tay nhất: biết lắng nghe, tự nhìn lại mình, nhận góp ý trái chiều rồi sửa; một số phiếu đánh giá cao việc mentee biết phản biện chứ không chỉ nghe theo. 197/265 phiếu chấm tiêu chí này từ 4 điểm trở lên.",
        quotes: [
          "có tinh thần tích cực khi tiếp nhận feedbacks, bỏ qua cảm xúc cá nhân để nhìn nhận ra feedback một cách khách quan nhất.",
          "Em có tinh thần cởi mở nhưng không tiếp nhận một chiều."
        ]
      },
      {
        title: "Chủ động có dấu hiệu cụ thể",
        count: "khoảng 80/265 phiếu",
        where: "Tiêu chí Chủ động & Chịu trách nhiệm; Cam kết & Theo đến cùng",
        detail:
          "Mentor ghi đúng các hành vi chương trình cần: chuẩn bị câu hỏi trước buổi gặp, tự đặt lịch, viết recap, có kế hoạch 9 tháng, báo sớm khi vướng. Khoảng 10 phiếu trong số này chép nguyên câu mô tả thang điểm chứ không ghi bằng chứng riêng.",
        quotes: [
          "Chủ động làm phần của mình: chuẩn bị trước câu hỏi gửi cho mentor, viết recap 48h sau buổi gặp mặt",
          "có plan rõ ràng sẽ tận dụng mentor như thế nào trong 9 tháng (3-6-9 months)"
        ]
      },
      {
        title: "Đạt kèm điều kiện: còn yếu về chủ động hoặc cam kết, nhưng mentor tin mentoring sẽ giúp",
        count: "139/265 phiếu có ít nhất một tiêu chí từ 3 điểm trở xuống",
        where: "Tiêu chí Chủ động; Cam kết; Lý do chọn",
        detail:
          "Hơn một nửa phiếu Đạt có ít nhất một tiêu chí chỉ ở mức 3 trở xuống, yếu nhất là Chủ động (90/265 phiếu). Câu lặp lại nhiều là bạn “hiểu mình phải chủ động nhưng vẫn cần khá nhiều hướng dẫn” (khoảng 43 phiếu). Mentor vẫn cho Đạt vì tiềm năng và độ cầu thị, coi phần còn thiếu là việc của mentor sau này.",
        quotes: [
          "bạn chưa có kế hoạch, mục tiêu rõ ràng, nhưng có tính cam kết , nếu được hướng dẫn tốt sẽ phát triển",
          "khả năng bạn tham gia đến cuối cùng hơi bị rủi ro, nhưng mình tin vào sự chủ động sắp xếp"
        ]
      },
      {
        title: "Cam kết được chứng minh bằng chuyện cụ thể trong quá khứ",
        count: "khoảng 70/265 phiếu",
        where: "Tiêu chí Cam kết & Theo đến cùng; Sẵn sàng học hỏi",
        detail:
          "Mentor dẫn ví dụ thật: dự án, cuộc thi, CLB, làm thêm hoặc gia sư dài hạn, tự học ngoại ngữ, giữ vai trò trưởng nhóm; 8 bạn đã rớt mùa trước mà vẫn nộp lại. Những phiếu này thuyết phục hơn hẳn các phiếu chỉ ghi “có cam kết”.",
        quotes: [
          "bạn đã tự ôn học IELTS từ 0 - 6.0, khả năng tự học, nỗ lực, và cam kết cao",
          "cho được ví dụ bạn đã từng cam kết trong quá khứ dù team member của bạn bỏ cuộc trong một dự án."
        ]
      },
      {
        title: "Rụt rè, thiếu tự tin, ngại giao tiếp — mentoring như một chỗ dựa",
        count: "khoảng 45/265 phiếu",
        where: "Lý do chọn; Nhu cầu phát triển; Chân dung mentor",
        detail:
          "Mentee nhút nhát, ngại giao tiếp nhưng thật sự muốn thay đổi, nên mentor cho Đạt. Điểm này kéo theo nhu cầu kỹ năng mềm và yêu cầu chân dung mentor kiên nhẫn, hiểu tâm lý.",
        quotes: [
          "Bạn có tiềm năng, nhưng chưa biết cách khai thác, còn khá ngại, thu mình nhưng thâm tâm mong muốn sự phát triển",
          "Bạn như một tờ giấy trắng rụt rè, nhưng mong muốn phát triển, học tập rõ rệt với tinh thần cầu thị"
        ]
      }
    ]
  },
  {
    title: "Nhu cầu phát triển chính hay gặp",
    intro: "Một phiếu có thể thuộc nhiều chủ đề.",
    themes: [
      { label: "Định hướng nghề nghiệp, chọn ngành hoặc chuyên ngành, lộ trình sau khi ra trường", count: "khoảng 134/265" },
      { label: "Kiến thức chuyên môn và thực tế của một ngành cụ thể", count: "khoảng 103/265" },
      { label: "Kỹ năng mềm: giao tiếp, tự tin nói trước đám đông, tư duy phản biện, lãnh đạo", count: "khoảng 84/265" },
      { label: "Hiểu bản thân, mindset, ra quyết định, cảm xúc", count: "khoảng 70/265" },
      { label: "Quản lý thời gian, kỷ luật, bớt trì hoãn", count: "khoảng 19/265" },
      { label: "Chuẩn bị xin việc, thực tập (CV, phỏng vấn, portfolio)", count: "khoảng 18/265" }
    ]
  },
  {
    title: "Chân dung mentor được đề xuất",
    themes: [
      { label: "Đúng ngành mentee nhắm tới — marketing, brand, truyền thông (~52); tài chính, ngân hàng, kế – kiểm (~51); sales, BD (~32); data, BA, IT (~26); logistics (~25); HR (~19)", count: "khoảng 177/265" },
      { label: "Người định hướng chung (phát triển bản thân, mindset, góc nhìn đa chiều), không đòi cùng ngành", count: "khoảng 77/265" },
      { label: "Lắng nghe, kiên nhẫn, thấu cảm, cởi mở", count: "khoảng 71/265" },
      { label: "Có kỹ năng coaching: hỏi gợi mở để mentee tự tìm câu trả lời", count: "khoảng 24/265" },
      { label: "Thẳng thắn, dám phản biện, kỷ luật, theo sát kế hoạch", count: "khoảng 20/265" }
    ],
    bullets: ["18 phiếu nêu giới tính hoặc độ tuổi của mentor, trong đó 10 phiếu muốn mentor nữ."]
  },
  {
    title: "Lo ngại về kỳ vọng dù vẫn Đạt",
    intro:
      "Chỉ 16/265 phiếu không chọn “Kỳ vọng phù hợp” ở mục B (14 “Cần làm rõ thêm”, 2 “Không phù hợp”); thêm khoảng 17 phiếu chọn “phù hợp” nhưng vẫn ghi băn khoăn. Một phiếu có thể thuộc nhiều nhóm.",
    patterns: [
      {
        title: "Trông chờ mentor dẫn dắt, hiểu chương trình như hướng nghiệp",
        count: "khoảng 10/265 phiếu",
        detail: "Mentee ban đầu nghĩ mentor sẽ chỉ việc, đưa đáp án hoặc chọn nghề thay mình. Phần lớn đã được mentor giải thích ngay trong buổi phỏng vấn và mentee vẫn muốn tham gia.",
        quotes: ["lúc phỏng vấn đã làm rõ chương trình không phải hướng nghiệp, bạn phải chủ động trong hành trình này"]
      },
      {
        title: "Cam kết phụ thuộc vào việc được ghép đúng mentor cùng ngành",
        count: "khoảng 9/265 phiếu",
        detail: "Mentor lo nếu ghép mentor khác ngành thì mentee giảm động lực, dù mentee nói không sao. Đây là rủi ro trực tiếp cho vòng matching.",
        quotes: ["mức độ cam kết có thể không cao nếu mentor không có expertise đúng như lĩnh vực bạn mong đợi"]
      },
      {
        title: "Mục tiêu dàn trải hoặc chưa nói rõ được vấn đề của mình",
        count: "khoảng 6/265 phiếu",
        detail: "Mentee muốn quá nhiều thứ cùng lúc (nhiều ngành, nhiều chứng chỉ) hoặc chưa diễn đạt được mình cần mentor giúp gì.",
        quotes: ["tránh đầu tư quá dàn trải vào quá nhiều hướng"]
      },
      {
        title: "Kỳ vọng vượt phạm vi chương trình",
        count: "khoảng 5/265 phiếu",
        detail: "Mong được giới thiệu network, được dẫn đi thực tập, có CV đẹp và việc tốt. Mentor đã nói rõ chương trình không cam kết những điều này.",
        quotes: ["bạn có kỳ vọng nhiều về networking, về việc được dẫn đi quan sát/thực tập thực tế"]
      },
      {
        title: "Nghi ngại về độ bền của cam kết",
        count: "khoảng 5/265 phiếu",
        detail: "Động lực chưa mạnh, lịch học và làm thêm dày, hoặc ngược lại cam kết “quá dễ dàng” nên cần kiểm chứng trong các buổi gặp đầu.",
        quotes: ["Bạn đang thể hiện cam kết quá mạnh và dễ dàng, cần đánh giá thực tế trong các phiên mentoring"]
      },
      {
        title: "Không hợp với chính mentor phỏng vấn — không phải mentee kỳ vọng sai",
        count: "3/265 phiếu",
        detail: "Cả 2 phiếu “Không phù hợp” và 1 phiếu “Cần làm rõ” thực chất nói mentee không khớp chuyên môn hoặc cách làm việc của mentor đang phỏng vấn. BTC nên đọc mục B kèm ngữ cảnh này.",
        quotes: ["Bạn không phù hợp với cách làm việc của mình, nhưng trường hợp của bạn hợp với giá trị của chương trình mentee này."]
      }
    ]
  }
];

const WAVE1_TAKEN_VS_REST: NoteSection[] = [
  {
    title: "46 bạn được chọn ngay so với 219 bạn đạt còn lại",
    intro: "Các con số về điểm đã đối chiếu với database; các con số về nội dung nhận xét là đếm khi đọc phiếu.",
    patterns: [
      {
        title: "Nhóm được chọn ngay có điểm cao và đều hơn rõ rệt — nhưng điểm không quyết định hết",
        count: "điểm quy đổi TB 4,30 so với 3,91",
        detail:
          "Khác biệt lớn nhất ở Nhu cầu Mentoring (chấm từ 3 trở xuống: 3/46 so với 61/219) và Cam kết (3/46 so với 52/219). Cả 4 tiêu chí từ 4 điểm trở lên: 32/46 so với 94/219; điểm từ 4,5 trở lên: 19/46 so với 38/219. Tuy vậy 3 bạn dưới 3,5 điểm vẫn được chọn ngay, trong đó 1 bạn bị chấm Cam kết 1/5."
      },
      {
        title: "Nhu cầu “chung” thì được nhận ngay; cần mentor đúng ngành thì được chuyển",
        count: "chân dung mentor nêu ngành cụ thể: 19/46 so với khoảng 158/219",
        detail:
          "Mentor nhận ngay khi nhu cầu của bạn không đòi một ngành cụ thể: năm 1 (26/46 so với 91/219), ngành mục tiêu “chưa xác định” (17/46 so với 45/219), cần mindset hoặc người đồng hành (19/46 so với khoảng 51/219). Khi mentee cần chuyên môn của một ngành mà mentor phỏng vấn không làm, mentor chuyển cho người khác.",
        quotes: ["Mentee khá cởi mở với việc matching với mentor không thuộc lĩnh vực chuyên môn đang học."]
      },
      {
        title: "Sự “hợp” với chính mentor là lý do nổi bật khi chọn ngay",
        count: "nói rõ về độ khớp: 11/46",
        detail:
          "Gần một phần tư phiếu chọn ngay nói thẳng về độ khớp với chính mentor: cùng quan điểm, cách ứng xử, công việc hiện tại của mentor. Ở nhóm còn lại, 9 phiếu nói rõ mentor không cùng lĩnh vực hoặc không hợp cách làm việc, và khoảng 7 phiếu thấy hợp nhưng chưa chốt nhận.",
        quotes: [
          "Mentee có định hướng ngành nghề phù hợp công việc hiện tại của tôi",
          "Bạn có tinh thần và thái độ phù hợp với Mentor. Có thể khớp nhau trong cách ứng xử."
        ]
      },
      {
        title: "Mục C của 219 bạn: chủ yếu “đề xuất mentor khác” vì lệch ngành",
        count: "đề xuất mentor khác 174 · chưa quyết định 44 · chọn “Có” rồi huỷ 1",
        detail:
          "Lý do “đề xuất mentor khác” gần như luôn là cần mentor của một ngành khác — khoảng 133/174 phiếu ghi chân dung mentor theo một ngành cụ thể; vài mentor còn nói sẵn sàng nhận nếu BTC cần. Phiếu “chưa quyết định” đa số không ghi lý do. Phiếu chọn “Có” duy nhất không thành cặp là cặp đã huỷ với ghi chú chọn nhầm lúc phỏng vấn.",
        quotes: ["tôi muốn nhận bạn này :) nhưng không thuộc nhóm ngành mà bạn mong đợi"]
      },
      {
        title: "Phiếu của nhóm chọn ngay sơ sài hơn",
        count: "phiếu sơ sài: 12/46 so với 15/219",
        detail:
          "Có lẽ vì mentor đã tự nhận bạn nên ít viết để bàn giao: hay để trống, ghi một chữ (“Chọn”, “Phù hợp”) hoặc chép một câu vào mọi ô. Trung vị 131 so với 155 từ mỗi phiếu. Nhóm 219 bạn ghi chép đầy đủ hơn — đó cũng là thông tin BTC cần để ghép mentor."
      },
      {
        title: "Về kỳ vọng và tính cách: khác biệt yếu hoặc không có",
        count: "kỳ vọng cần làm rõ / không phù hợp: 3/46 so với 13/219",
        detail:
          "Tỷ lệ nhắc đến rụt rè, thiếu tự tin (8/46 so với 37/219) và dấu hiệu chủ động cụ thể (13/46 so với 69/219) tương đương giữa hai nhóm; nhóm chọn ngay chỉ ít nhắc “mông lung” hơn một chút (9/46 so với 68/219). Không nên dùng các đặc điểm này để giải thích vì sao một bạn được chọn ngay."
      }
    ]
  }
];

const WAVE1_REJECTED: NoteSection[] = [
  {
    title: "Mẫu hình chung",
    patterns: [
      {
        title: "Chưa nói được mình cần đồng hành về điều gì",
        count: "khoảng 32/55 phiếu",
        where: "Tiêu chí Nhu cầu Mentoring; Lý do không chọn; Nhu cầu phát triển chính",
        detail:
          "Lý do không chọn hay gặp nhất. Mentee trả lời chung chung, “mông lung”, không nêu được vấn đề cụ thể muốn cùng mentor giải quyết, nên mentor không thấy chương trình mang lại giá trị gì cho bạn. Tiêu chí Nhu cầu bị chấm từ 2 điểm trở xuống ở 31/55 phiếu; 11 phiếu để trống hoặc ghi “n/a” ở ô Nhu cầu phát triển chính.",
        quotes: ["Chưa rõ Mentee muốn gì? Cần gì? Mentee chỉ nêu chung chung là để học hỏi thêm từ Mentor."]
      },
      {
        title: "Không tìm hiểu chương trình, đăng ký theo phong trào",
        count: "khoảng 20/55 phiếu",
        where: "Lý do không chọn; Tiêu chí Nhu cầu và Cam kết; Mục B",
        detail:
          "Mentee không nắm thông tin cơ bản, hiểu sai vai trò mentor (như trưởng nhóm thi, thầy giáo, người kết nối), có bạn không chuẩn bị gì cho buổi phỏng vấn. 5 phiếu ghi thẳng động cơ đăng ký là vì FOMO, thành tích hoặc điểm rèn luyện; 3 phiếu biết chương trình qua bạn bè rồi không tìm hiểu thêm.",
        quotes: [
          "Không hiểu chương trình, chưa tham gia Mentee Orientation. Chỉ đăng ký cho vui",
          "Đăng ký tham gia Mentoring vì FOMO thấy nhiều bạn đăng ký để có định hướng nên đăng ký theo."
        ]
      },
      {
        title: "Thụ động, chờ mentor “dạy” và quyết định thay mình",
        count: "khoảng 17/55 phiếu",
        where: "Tiêu chí Chủ động & Chịu trách nhiệm; Sẵn sàng học hỏi; Mục B",
        detail:
          "Mentee mong mentor đưa sẵn đáp án, lộ trình, giải pháp; hỏi đến đâu trả lời đến đó, không có kế hoạch cho 9 tháng. Mentor thấy đây là quan hệ thầy – trò chứ không phải đồng hành. Tiêu chí Chủ động bị chấm từ 2 điểm trở xuống ở 22/55 phiếu.",
        quotes: [
          "Bạn đang cần mentor “dạy”, chỉ dẫn trực tiếp chứ không phải một người đồng hành/ gợi mở.",
          "chờ mentor dẫn dắt, chưa chuẩn bị plan sẽ làm gì với mentor trong vòng 9 tháng tới"
        ]
      },
      {
        title: "Nhu cầu nằm ngoài phạm vi của mentoring",
        count: "18/55 phiếu",
        where: "Lý do không chọn; Nhu cầu phát triển chính; Mục B",
        detail:
          "Nhu cầu có thật nhưng chương trình không nhắm tới: kỹ năng, học thuật, chứng chỉ như Excel, thuyết trình, NCKH, CFA, ERP (9 phiếu); việc làm, thực tập, network, case thật của doanh nghiệp (6); viết CV và phỏng vấn (2); thi case (1). Mentor thường khuyên bạn tìm giảng viên hoặc tự bồi dưỡng.",
        quotes: [
          "bạn muốn tìm người giúp bạn làm NCKH nhiều hơn nên gợi ý bạn tìm từ các giảng viên thay vì chương trình mentoring"
        ]
      },
      {
        title: "Cam kết chung chung, có điều kiện, dễ bỏ giữa chừng",
        count: "khoảng 25/55 phiếu",
        where: "Tiêu chí Cam kết & Theo đến cùng; Lý do không chọn",
        detail:
          "Mentee nói “sẽ cố gắng” nhưng không có kế hoạch giữ nhịp 9 tháng, không có phương án khi mentor hoặc mình bận; có bạn nói thẳng sẽ rút nếu thấy không hợp. Tiêu chí Cam kết bị chấm từ 2 điểm trở xuống ở 31/55 phiếu, nhiều điểm 1 nhất (9 phiếu). 8 phiếu nêu cụ thể nguy cơ bỏ giữa chừng: định thi lại trường khác, sợ ảnh hưởng việc học, bỏ cuộc nếu nhận góp ý tiêu cực.",
        quotes: [
          "Tham gia trải nghiệm, nếu không thấy ổn thì rút khỏi chương trình",
          "chưa thể hiện quyết tâm cao mà chỉ tham gia được thì được không được thì thôi."
        ]
      },
      {
        title: "“Chưa đúng thời điểm” — phần lớn là sinh viên năm 1",
        count: "15/55 phiếu",
        where: "Lý do không chọn; Ghi chú thêm",
        detail:
          "Mentor thấy bạn mới vào trường, chưa đủ trải nghiệm để mentoring có ích, khuyên quay lại mùa sau (12 phiếu năm 1, 3 phiếu năm 2); 3 bạn năm 1 tự đề nghị hoãn. Năm 1 chiếm 25/55 phiếu Không đạt, nhưng tỷ lệ Không đạt của năm 1 (25/167, khoảng 15%) ngang mức chung (55/370) — năm 1 không bị loại nhiều hơn các năm khác.",
        quotes: ["bạn mới vào trường 1 tháng, chưa có nhu cầu mentoring thật sự ở thời điểm này."]
      },
      {
        title: "Khó tiếp nhận góp ý",
        count: "8/55 phiếu",
        where: "Tiêu chí Sẵn sàng học hỏi; Lý do không chọn",
        detail:
          "Mentee phản ứng phòng thủ, đi hỏi người thân để kiểm chứng lại góp ý, hoặc nói thẳng sẽ bỏ qua góp ý trái ý mình. Mentor coi đây là rủi ro lớn cho quan hệ mentoring; 4/8 phiếu này chấm 1 điểm ở Sẵn sàng học hỏi.",
        quotes: ["khá phòng thủ khi nhận feedback và không sẵn sàng lắng nghe mentor"]
      }
    ]
  },
  {
    title: "Lo ngại về kỳ vọng",
    intro: "Mục B của nhóm này: 36 phiếu “Kỳ vọng không phù hợp”, 6 phiếu “Cần làm rõ thêm”, 13 phiếu “Kỳ vọng phù hợp”.",
    patterns: [
      {
        title: "Coi mentor là người dạy, người đưa giải pháp",
        count: "khoảng 11/55 phiếu",
        detail: "Mentee chưa hình dung được vai trò đồng hành: mong mentor chỉ cách làm, giải quyết vấn đề, ra quyết định, thậm chí tạo động lực thay mình.",
        quotes: ["kỳ vọng mentor sẽ chỉ ra cách làm. chưa hình dung được vai trò của mentor và mentee"]
      },
      {
        title: "Không nói được mình kỳ vọng gì",
        count: "khoảng 10/55 phiếu",
        detail: "Mục B bị đánh “không phù hợp” hoặc “cần làm rõ” chỉ vì mentee không trình bày được kỳ vọng cụ thể: muốn “có một mentor” nhưng không biết để làm gì.",
        quotes: ["kỳ vọng chung chung là tìm được một mentor nhưng chưa biết để làm gì một cách rõ ràng"]
      },
      {
        title: "Mong những thứ chương trình không cam kết: việc làm, thực tập, network",
        count: "7/55 phiếu",
        detail: "Mentee coi mentoring là đường tắt để có việc, có “dream job”, vào chương trình Management Trainee, có người “kéo” lên. Nhiều mentor ghi rõ đây là điều chương trình không hứa.",
        quotes: ["bạn mong đợi có cơ hội được gặp các anh chị giỏi, hỗ trợ có dream job, cơ hội thực tập..."]
      },
      {
        title: "Đòi mentor đúng một chuyên môn hẹp",
        count: "khoảng 7/55 phiếu",
        detail: "Mentee muốn mentor đúng chuyên gia (CFA, đầu tư, thẩm định giá, ERP…) và đúng hình mẫu mình đặt ra; không như mong đợi thì “đợi mùa sau”. Mentor lo nếu ghép không trúng, mentee sẽ không biết đồng hành về điều gì.",
        quotes: ["yêu cầu mentor có chứng chỉ CFA và senior nhiều kinh nghiệm trong tài chính để hướng dẫn, chia sẻ kiến thức"]
      }
    ]
  },
  {
    title: "Phiếu “lưng chừng”: điểm từ 3,0 trở lên mà vẫn Không đạt (13/55)",
    intro:
      "Kết luận Đạt / Không đạt đang dựa vào “mức độ cần thiết” và “độ khớp với chính mentor” nhiều hơn vào điểm. 3 phiếu Không đạt có điểm 4,00–4,45, cao hơn điểm trung bình nhóm Đạt (3,98); ngược lại nhóm Đạt có 5 phiếu dưới 3,0.",
    bullets: [
      "4/13 phiếu nêu điểm yếu thật của mentee: mơ hồ, chưa hiểu chương trình, cam kết thấp.",
      "4/13 phiếu (3,65–4,45) loại vì nhu cầu của mentee lệch chuyên môn của chính mentor phỏng vấn — đây là chuyện ghép cặp, không phải mentee không đạt.",
      "3/13 phiếu (3,00–4,25) loại vì mentee “đã có hướng đi” hoặc “chưa cần”, nhường suất cho bạn khác.",
      "2/13 là bạn năm 1 tự xin hoãn sang năm sau.",
      "6/13 phiếu chọn “Kỳ vọng phù hợp” ở mục B nhưng vẫn bị loại vì lệch nhu cầu."
    ]
  },
  {
    title: "Gợi ý cho BTC (nhận định của người phân tích, không phải lời mentor)",
    bullets: [
      "Xem lại 7 phiếu Không đạt có điểm từ 3,0 trở lên bị loại vì lệch chuyên môn của mentor (4) hoặc “chưa cần” (3): có thể nhờ mentor khác phỏng vấn lại hoặc đưa vào danh sách chờ; thống nhất với mentor rằng “không hợp chuyên môn của tôi” không phải căn cứ chấm Không đạt.",
      "Nói rõ kỳ vọng ngay từ vòng đơn: mentor là người đồng hành, gợi mở; không dạy kỹ năng hay chứng chỉ; không hứa việc làm, thực tập hay network. Có thể yêu cầu xem buổi định hướng (Orientation) trước khi phỏng vấn.",
      "Thêm vào form đăng ký một câu hỏi bắt buộc: 1–2 vấn đề cụ thể muốn được đồng hành, và cách giữ cam kết trong 9 tháng — hai lý do loại hàng đầu mà form hiện tại chưa lọc được.",
      "Không chặn sinh viên năm 1 theo mặc định. Với các bạn bị loại vì “chưa đúng thời điểm”, nên gửi thư mời quay lại mùa sau thay vì thư từ chối chung."
    ]
  }
];

const WAVE1_NEEDS_REVIEW: NoteSection[] = [
  {
    title: "Mẫu hình chung",
    patterns: [
      {
        title: "Mục tiêu và nhu cầu còn mơ hồ",
        count: "khoảng 28/50 phiếu",
        where: "Tiêu chí Nhu cầu Mentoring; Lý do",
        detail:
          "Mẫu hình phổ biến nhất. Mentee muốn có mentor nhưng chưa nói được mình muốn gì, nhắm ngành nào, cần thay đổi điều gì, nên mentor không thấy rõ giá trị của mentoring. 17/50 bạn để ngành mục tiêu là “Chưa xác định rõ”.",
        quotes: ["Bạn còn mông lung trong mục tiêu của mình.", "Có nhu cầu nhưng không rõ mục tiêu."]
      },
      {
        title: "Mentee ổn, nhưng mentor thấy mình không đúng chuyên môn",
        count: "13/50 phiếu là lý do chính (khoảng 18/50 nếu tính cả phiếu nêu như một điều kiện)",
        where: "Lý do; Mục C",
        detail:
          "Mentor không chê mentee mà cho rằng bạn cần mentor cùng ngành (tài chính, logistics, kế – kiểm, CNTT…) nên chọn “đề xuất mentor khác nhận”. Nhóm này có 12 phiếu điểm từ 4,0 trở lên; 8 trong 12 phiếu đó do cùng một người phỏng vấn chấm, đều chọn “đề xuất mentor khác nhận”.",
        quotes: [
          "Mong BTC cho bạn 1 cơ hội tham gia pv lần 2 để kiếm 1 mentor phù hợp hơn",
          "Nên để các anh chị có background Finance chọn làm mentee"
        ]
      },
      {
        title: "Kỳ vọng lệch: hiểu sai chương trình hoặc muốn mentor làm thay",
        count: "khoảng 18/50 phiếu",
        where: "Mục B; Tiêu chí Chủ động & Chịu trách nhiệm",
        detail:
          "Hai dạng: chưa tìm hiểu kỹ chương trình (tưởng là CLB, tưởng mentor đi cùng 4 năm, chưa đọc bảng cam kết mentee), hoặc mong mentor lên lịch, soạn nội dung, nhắc nhở, “cầm tay chỉ việc”. Mục B của nhóm: 31/50 “Cần làm rõ thêm”, 4/50 “Kỳ vọng không phù hợp”.",
        quotes: [
          "bạn đang nhầm lẫn chương trình là 1 CLB",
          "Bạn tham gia vì muốn có 1 người cầm tay chỉ việc, chỉ cho bạn làm cái gì, thay bạn tìm hiểu"
        ]
      },
      {
        title: "Cam kết và chủ động chưa thuyết phục, mentor sợ bỏ giữa chừng",
        count: "khoảng 15/50 phiếu",
        where: "Tiêu chí Chủ động, Cam kết; Lý do",
        detail:
          "Mentee nói sẽ cam kết nhưng không có kế hoạch cụ thể; mentor lo bạn bỏ giữa chừng khi mentor không như mong đợi hoặc khi cảm xúc thay đổi. 10 phiếu chấm Cam kết từ 2 điểm trở xuống, trong đó 2 phiếu 1 điểm.",
        quotes: ["Có khả năng bỏ cuộc giữa chừng nếu mentor không đúng như expectation của bạn."]
      },
      {
        title: "Năm nhất: quá mới, chưa có nhu cầu cấp thiết",
        count: "13/50 phiếu",
        where: "Lý do; Mục B",
        detail:
          "Mentee mới vào trường vài tuần, chưa gặp khó khăn cụ thể; mentor khuyên đợi năm 2 hoặc tham gia CLB trước, kể cả khi điểm khá. Cả 13 phiếu đều là năm nhất; năm nhất chiếm 25/50 phiếu của nhóm.",
        quotes: ["Cảm nhận để năm 2 tham gia sẽ khai thác điểm mạnh của chương trình tốt hơn"]
      },
      {
        title: "Vướng tâm lý, tự tin, cảm xúc — cần đồng hành tinh thần hơn là cùng nghề",
        count: "khoảng 13/50 phiếu",
        where: "Lý do; Mục B; Chân dung mentor",
        detail:
          "Mentee rụt rè, lo âu, mới xa nhà, lúng túng khi trả lời hoặc cảm xúc thất thường. Mentor thấy nhu cầu là thật nhưng không chắc một mentor nghề nghiệp thông thường đáp ứng được.",
        quotes: [
          "Tâm lý chưa ổn định cần người đồng hành.",
          "cần BTC xem xét thêm là có mentor nào có thể guide bạn nhiều hơn về mặt tâm lý thay vì kỹ năng nghề nghiệp"
        ]
      }
    ]
  },
  {
    title: "Mentor đang nghiêng về hướng nào",
    intro: "Người phân tích phân loại theo lời lý do và điểm trên phiếu — không phải một ô mentor chọn.",
    patterns: [
      {
        title: "Nghiêng về Đạt",
        count: "8/50 phiếu",
        detail: "Lý do khép lại bằng điểm tích cực (có động lực, mục tiêu khá rõ, “tin bạn duy trì được”, “cho bạn một cơ hội”) và không nêu rủi ro bỏ cuộc. Điểm trung bình 3,46; 6/8 phiếu chấm kỳ vọng “phù hợp”."
      },
      {
        title: "Cần mentor đúng chuyên môn",
        count: "13/50 phiếu",
        detail: "Không chê mentee; đề nghị ghép mentor đúng ngành hoặc phỏng vấn lại. Điểm trung bình 3,94; 8/13 phiếu do cùng một người phỏng vấn chấm."
      },
      {
        title: "Thật sự chưa rõ",
        count: "14/50 phiếu",
        detail: "Lý do cân hai chiều (“có mong muốn… nhưng quyết tâm chưa cao”, “nhận nếu còn slot”) hoặc chỉ nêu điểm yếu ở mức vừa mà không kết luận. Điểm trung bình 3,16."
      },
      {
        title: "Nghiêng về Không đạt",
        count: "15/50 phiếu",
        detail: "Lý do nói thẳng “chưa cần / chưa ưu tiên / nên đợi năm 2”, hoặc nêu rủi ro bỏ cuộc kèm Chủ động hay Cam kết từ 2 điểm trở xuống. Điểm trung bình 2,67; 12/15 là năm nhất."
      }
    ]
  },
  {
    title: "Mentor đề nghị BTC",
    themes: [
      { label: "Chuyển cho mentor khác, thường là mentor đúng chuyên ngành", count: "28/50 chọn ở mục C; 13 ghi rõ bằng lời" },
      { label: "Ghép mentor có thế mạnh đồng hành tinh thần, tâm lý", count: "khoảng 9/50" },
      { label: "Hẹn mùa sau, để bạn có thêm thời gian trải nghiệm (đều là năm 1)", count: "7/50" },
      { label: "Đưa vào danh sách chờ, nhận nếu còn chỗ", count: "3/50" },
      { label: "BTC xem thêm về tính cam kết", count: "3/50" },
      { label: "Phỏng vấn lần 2 · kiểm lại hồ sơ không đồng nhất · bảo đảm đã đọc bảng cam kết", count: "mỗi đề nghị 1/50" }
    ],
    bullets: [
      "5 phiếu chọn “đề xuất mentor khác nhận” ở mục C nhưng lý do lại nghiêng về Không đạt — lựa chọn này đôi khi là cách từ chối nhẹ.",
      "1 phiếu cho rằng mentee cần hỗ trợ tâm lý chuyên môn. Việc này vượt phạm vi mentoring; BTC nên cân nhắc kênh hỗ trợ phù hợp (nhận định của người phân tích)."
    ]
  },
  {
    title: "Nhu cầu phát triển chính hay gặp",
    themes: [
      { label: "Định hướng nghề nghiệp, hình dung công việc thực tế", count: "16/50" },
      { label: "Kiến thức và lộ trình trong một ngành cụ thể", count: "10/50" },
      { label: "Kỹ năng mềm: giao tiếp, làm việc nhóm, quản lý thời gian", count: "6/50" },
      { label: "Hiểu bản thân, tự tin, quản lý cảm xúc", count: "6/50" }
    ]
  },
  {
    title: "Chân dung mentor được đề xuất",
    themes: [
      { label: "Cùng hoặc đúng chuyên ngành (tài chính – chứng khoán 6, logistics 6, marketing – sales 5, kế – kiểm 2…)", count: "31/50" },
      { label: "Hiểu tâm lý, thấu hiểu, kiên nhẫn", count: "12/50" },
      { label: "Biết lắng nghe, hỏi gợi mở kiểu coach", count: "8/50" },
      { label: "Cởi mở, gần gũi (4 phiếu ngược lại muốn mentor nghiêm khắc)", count: "5/50" }
    ]
  }
];

const WAVE1_DATA_QUALITY = [
  "Nhóm (a): khoảng 27/265 phiếu (10%) ghi rất sơ sài — dưới 60 từ, từ hai ô chính trở lên để trống hoặc ghi “N/A”, hoặc một câu chép vào mọi ô — dồn vào nhóm được chọn ngay (12/46). 25/265 phiếu chép nguyên câu mô tả thang điểm làm bằng chứng; 69/265 để trống hoặc ghi “N/A / Không” ở ô Concern của mục B.",
  "Nhóm (b): khoảng 10/55 phiếu có ghi chú tiêu chí gần như trống (1–4 chữ, “n/a”, hoặc chép một câu cho ba tiêu chí); 11/55 phiếu để trống ô Nhu cầu phát triển chính, 9/55 để trống ghi chú mục B.",
  "Nhóm (c): 8 phiếu của cùng một người phỏng vấn đều 4,00–4,25 điểm và phần lớn chép nguyên câu mô tả của thang chấm thay cho bằng chứng — điểm cao ở nhóm này vì thế không phải đánh giá độc lập. 8 phiếu để trống hoặc ghi “N/A” ở ô Nhu cầu phát triển.",
  "Một số phiếu chép tên, nơi thực tập, quê quán, hoàn cảnh gia đình của mentee vào ô nhận xét. Báo cáo này đã bỏ hết; cần che những chi tiết đó trước khi chia sẻ phiếu ra ngoài BTC."
];

const WAVE_NOTES: Record<string, WaveNotes> = {
  "2026-10-03": {
    waveKey: "2026-10-03",
    writtenOn: "06/10/2026",
    basis: { passed: 265, rejected: 55, needs_review: 50, taken: 46 },
    method:
      "Đọc toàn bộ ô chữ của 370 phiếu — ghi chú bằng chứng của 4 tiêu chí, lý do chọn / không chọn, nhu cầu phát triển chính, ghi chú kỳ vọng, chân dung mentor, ghi chú thêm — gom các ý lặp lại thành mẫu hình và đếm số phiếu có mẫu hình đó. “Khoảng” là chỗ ranh giới giữa các ý không sắc; các con số về điểm đã đối chiếu với database.",
    groups: { passed: WAVE1_PASSED, rejected: WAVE1_REJECTED, needs_review: WAVE1_NEEDS_REVIEW },
    takenVsRest: WAVE1_TAKEN_VS_REST,
    dataQuality: WAVE1_DATA_QUALITY
  }
};

export function notesForWave(waveKey: string): WaveNotes | null {
  return WAVE_NOTES[waveKey] ?? null;
}

/**
 * Câu báo khi số phiếu hiện tại khác số phiếu lúc phân tích — ví dụ 8 bạn chưa có
 * kết quả được chấm sau đó. Không đổi thì null: không thêm chữ thừa.
 */
export function notesDrift(
  notes: Pick<WaveNotes, "basis" | "writtenOn">,
  live: Record<OfflineOutcome, number> & { taken: number }
): string | null {
  const keys: Array<OfflineOutcome | "taken"> = ["passed", "rejected", "needs_review", "taken"];
  if (keys.every((k) => notes.basis[k] === live[k])) return null;
  const was = notes.basis.passed + notes.basis.rejected + notes.basis.needs_review;
  const now = live.passed + live.rejected + live.needs_review;
  return `Phần phân tích viết ngày ${notes.writtenOn} trên ${was} phiếu; hiện có ${now} phiếu có kết quả. Số liệu ở các bảng là số hiện tại, phần nhận xét chưa tính các phiếu thay đổi sau ngày đó.`;
}
