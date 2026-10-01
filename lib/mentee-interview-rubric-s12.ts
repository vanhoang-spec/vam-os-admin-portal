import type { RubricCriterion, RubricGuidance } from "@/lib/mentee-interview-rubric-core";

/**
 * Phiếu chấm phỏng vấn mentee Mùa 12 — từ VAM_Mentee_Evaluation_Season12_Final.xlsx
 * (tiêu chí, trọng số, câu hỏi cốt lõi, mô tả 1/3/5) và VAM_Handbook_S12.docx
 * mục 6 (câu hỏi phỏng vấn).
 *
 * Bản ở database do migration 20261002100000 seed; file này là bản TS của ĐÚNG
 * nội dung đó để test đối chiếu. Sửa một bên mà quên bên kia thì test đỏ — hai
 * bản lệch nhau nghĩa là test đang kiểm một phiếu không ai dùng.
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
      "3": "Có nhu cầu thật nhưng còn chung; cần probing thêm để làm rõ.",
      "5": "Có development need thật; hiểu mình đang cần khám phá/phát triển gì và mentoring phù hợp."
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
    question: "Bạn này có chịu học, reflect và thử cách mới không?",
    descriptors: {
      "1": "Muốn Mentor cho đáp án; defensive trước feedback; ít reflection.",
      "3": "Sẵn sàng nghe và học nhưng evidence chuyển thành hành động còn hạn chế.",
      "5": "Biết lắng nghe, reflect, thử cách khác và điều chỉnh; sẵn sàng bị challenge."
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
      "1": "Kỳ vọng Mentor lên lịch, nhắc nhở, xây roadmap hoặc tìm cơ hội giúp.",
      "3": "Hiểu mình phải chủ động nhưng vẫn cần khá nhiều hướng dẫn.",
      "5": "Chủ động chuẩn bị, đặt lịch, follow-up và thực hiện action sau mentoring."
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
      "1": "Chưa hiểu workload; chỉ nói “em sẽ cố gắng”; chưa có cách xử lý khi bận.",
      "3": "Hiểu commitment nhưng kế hoạch duy trì còn khá chung.",
      "5": "Có evidence về follow-through; biết ưu tiên, báo sớm và xử lý conflict thay vì ghost/drop."
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
  note: "Điểm số chỉ hỗ trợ Mentor đánh giá có cấu trúc – KHÔNG dùng làm điểm sàn quyết định Đạt/Không chọn. Không cộng điểm thành tổng. Mentor dùng 4 tiêu chí để hỗ trợ judgment, không dùng công thức để quyết định Đạt/Không chọn.",
  reminder: "Chưa có định hướng, chưa nhiều kỹ năng hoặc chưa tự tin KHÔNG phải lý do để loại. Hãy đánh giá liệu mentoring có tạo giá trị cho bạn ấy và bạn ấy có sẵn sàng học, chủ động và đi đến cùng hay không."
};
