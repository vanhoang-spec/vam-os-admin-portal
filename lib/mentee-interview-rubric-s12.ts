import type { RubricCriterion, RubricGuidance } from "@/lib/mentee-interview-rubric-core";

/**
 * Phiếu chấm phỏng vấn mentee Mùa 12 — từ VAM_Mentee_Evaluation_Season12_Final.xlsx
 * (tiêu chí, trọng số, câu hỏi cốt lõi, mô tả 1/3/5) và VAM_Handbook_S12.docx
 * mục 6 (câu hỏi phỏng vấn).
 *
 * PHIÊN BẢN 2 (02/10/2026): câu chữ thuần Việt theo "Điều chỉnh mục Phỏng vấn
 * Mentee trực tiếp.docx" của BTC — câu hỏi cốt lõi, mô tả 1/3/5 và lưu ý điểm số.
 * Tên tiêu chí, trọng số và câu hỏi gợi ý không đổi. Sửa vài lỗi gõ hiển nhiên của
 * bản gốc ("tâm quan trong" → "tầm quan trọng", "mentoiring" → "mentoring").
 *
 * Bản ở database: migration 20261002100000 seed phiên bản 1, migration
 * 20261002150000 nâng lên phiên bản 2. File này là bản TS của phiên bản HIỆN HÀNH
 * để test đối chiếu — sửa một bên mà quên bên kia thì test đỏ.
 */
export const S12_INTERVIEW_CRITERIA: RubricCriterion[] = [
  {
    key: "need",
    label: "Nhu cầu Mentoring & Giá trị phát triển",
    label_en: "Development Need & Mentoring Value",
    weight: 30,
    question: "Mentoring có thể tạo ra giá trị thực sự cho bạn này không?",
    descriptors: {
      "1": "Chưa thấy nhu cầu mentoring rõ; tham gia chủ yếu vì networking/CV/cơ hội chung.",
      "3": "Có nhu cầu thật nhưng còn chung chung; cần tìm hiểu thêm để làm rõ.",
      "5": "Có nhu cầu phát triển thật sự; nhận thức được bản thân đang cần khám phá và phát triển ở lĩnh vực nào; thấy rõ mentoring có thể mang lại giá trị cho bản thân."
    },
    interview_questions: [
      "Hiện tại điều gì trong học tập, nghề nghiệp hoặc phát triển bản thân khiến em băn khoăn nhất?",
      "Em đã thử tự tìm hiểu hoặc giải quyết vấn đề đó như thế nào rồi?",
      "Nếu không có Mentor đồng hành, điều gì em nghĩ mình sẽ khó tự nhìn ra hoặc tự giải quyết nhất?",
      "Tình huống: Nếu Mentor chỉ có thể giúp em làm rõ một điều trong 9 tháng, em muốn đó là điều gì? Vì sao?"
    ]
  },
  {
    key: "readiness",
    label: "Sẵn sàng học hỏi",
    label_en: "Learning Readiness / Coachability",
    weight: 20,
    question: "Bạn này có tinh thần học hỏi; biết tự phản tỉnh và chủ động thử cách tiếp cận mới không?",
    descriptors: {
      "1": "Kỳ vọng Mentor đưa sẵn đáp án; phản ứng phòng thủ khi nhận feedback; ít tự phản tỉnh.",
      "3": "Sẵn sàng lắng nghe và học hỏi. Tuy nhiên, bằng chứng về việc chuyển hóa thành hành động thực tế còn hạn chế.",
      "5": "Biết lắng nghe; có khả năng tự phản tỉnh; chủ động thử cách tiếp cận khác và linh hoạt thay đổi khi cần cũng như sẵn sàng đón nhận thử thách."
    },
    interview_questions: [
      "Behavioral: Hãy kể một feedback em từng nhận mà lúc đầu em thấy khó nghe hoặc chưa đồng ý. Sau đó em đã làm gì?",
      "Sau feedback đó, em có thay đổi điều gì không? Kết quả ra sao?",
      "Có điều gì về bản thân mà em biết mình cần thay đổi/phát triển không? Nếu Mentor chỉ ra một điểm em chưa từng nghĩ tới, em sẽ phản ứng thế nào?",
      "Tình huống: Nếu Mentor đưa ra góc nhìn hoàn toàn khác với điều em tin và hai bên vẫn khác quan điểm, em sẽ làm gì?"
    ]
  },
  {
    key: "ownership",
    label: "Chủ động & Chịu trách nhiệm",
    label_en: "Ownership & Initiative",
    weight: 25,
    question: "Bạn này có tự làm phần của mình hay chờ Mentor dẫn dắt?",
    descriptors: {
      "1": "Kỳ vọng Mentor chủ động lên lịch và nhắc nhở; mong Mentor xây dựng lộ trình phát triển để định hướng rõ ràng; kỳ vọng Mentor tìm kiếm và giới thiệu các cơ hội phù hợp.",
      "3": "Hiểu mình phải chủ động nhưng vẫn cần khá nhiều hướng dẫn.",
      "5": "Chủ động chuẩn bị trước buổi mentoring; tự sắp xếp và đặt lịch hẹn; thực hiện follow-up và triển khai hành động cụ thể sau buổi mentoring."
    },
    interview_questions: [
      "Theo em, trong một mối quan hệ mentoring, phần việc nào thuộc trách nhiệm của Mentee?",
      "Behavioral: Kể một lần em gặp vấn đề chưa biết giải quyết. Trước khi nhờ người khác, em đã chủ động làm gì?",
      "Tình huống: Nếu gần đến tháng mới nhưng Mentor chưa chủ động nhắn để đặt lịch, em sẽ làm gì?",
      "Trước mỗi buổi mentoring em sẽ chuẩn bị gì, và sau buổi em sẽ làm gì để biến trao đổi thành hành động?"
    ]
  },
  {
    key: "follow_through",
    label: "Cam kết & Theo đến cùng",
    label_en: "Commitment & Follow-through",
    weight: 25,
    question: "Bạn này có khả năng duy trì hành trình 9 tháng không?",
    descriptors: {
      "1": "Chưa hiểu rõ hành trình mentoring bản thân cần cam kết những gì nên khó ước lượng khả năng thực hiện; thường chỉ phản hồi chung chung kiểu “em sẽ cố gắng” thay vì đưa ra kế hoạch cụ thể; chưa có cách xử lý khi bận rộn.",
      "3": "Hiểu được ý nghĩa và tầm quan trọng của sự cam kết trong quá trình mentoring nhưng kế hoạch duy trì cam kết còn khá chung chung.",
      "5": "Có minh chứng rõ ràng về khả năng thực hiện cam kết; biết cách quản lý công việc/học việc để đảm bảo tiến độ mentoring; chủ động báo sớm khi có vấn đề phát sinh thay vì để đến phút cuối; có khả năng xử lý xung đột thay vì im lặng hoặc bỏ ngang."
    },
    interview_questions: [
      "Tình huống: 9 tháng khá dài và chắc chắn sẽ có lúc em thi, đi làm hoặc rất bận. Khi đó em sẽ xử lý hành trình mentoring thế nào?",
      "Behavioral: Hãy kể một cam kết kéo dài mà có lúc em rất muốn bỏ. Cuối cùng em xử lý ra sao?",
      "Khi nhận ra mình có nguy cơ không thực hiện được điều đã cam kết, em thường làm gì và sẽ chủ động báo với ai?",
      "Tình huống: Nếu cùng tuần có kỳ thi, deadline internship và lịch mentoring/recap, em sẽ sắp xếp và trao đổi thế nào?"
    ]
  }
];

export const S12_INTERVIEW_GUIDANCE: RubricGuidance = {
  motto: "Có cần không? • Có chịu học không? • Có tự làm phần của mình không? • Có đi đến cùng không?",
  note: "Điểm số chỉ mang tính tham khảo để Mentor đánh giá mức độ ở từng thành phần. KHÔNG sử dụng điểm số như ngưỡng sàn để quyết định Mentee “Đạt/Không đạt”. Không cộng điểm thành tổng số để đưa ra kết luận. Mentor dựa trên 4 tiêu chí chính để hỗ trợ đánh giá, chứ không áp dụng công thức tính điểm để quyết định việc trở thành Mentee.",
  reminder: "Chưa có định hướng, chưa nhiều kỹ năng hoặc chưa tự tin KHÔNG phải lý do để loại. Hãy đánh giá liệu mentoring có tạo giá trị cho bạn ấy và bạn ấy có sẵn sàng học, chủ động và đi đến cùng hay không."
};
