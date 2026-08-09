export type ApplicationCommitmentRole = "mentor" | "mentee";

export type AcknowledgementDefinition = Readonly<{
  key: string;
  version: 1;
  role: ApplicationCommitmentRole;
  wording: string;
  helper?: string;
}>;

export const MENTOR_CONFIRMATION_PHRASE =
  "Tôi hiểu cam kết của Mentor và sẵn sàng đồng hành cùng Mentee trong suốt mùa mentoring.";
export const MENTEE_CONFIRMATION_PHRASE =
  "Mentor của tôi có thể không cùng ngành và tôi là người chủ động trong hành trình mentoring.";

export const APPLICATION_ACKNOWLEDGEMENTS = Object.freeze({
  MENTOR_ELIGIBILITY_V1: {
    key: "MENTOR_ELIGIBILITY_V1",
    version: 1,
    role: "mentor",
    wording:
      "Tôi xác nhận các thông tin về kinh nghiệm làm việc và kinh nghiệm quản lý con người/đội ngũ mà tôi cung cấp ở trên là chính xác."
  },
  MENTOR_TIME_COMMITMENT_V1: {
    key: "MENTOR_TIME_COMMITMENT_V1",
    version: 1,
    role: "mentor",
    wording:
      "Tôi có thể dành tối thiểu 1–2 giờ mỗi tháng cho mỗi Mentee và cam kết duy trì việc đồng hành trong suốt một mùa UEH Mentoring."
  },
  MENTOR_MATCH_EXPECTATION_V1: {
    key: "MENTOR_MATCH_EXPECTATION_V1",
    version: 1,
    role: "mentor",
    wording:
      "Tôi hiểu rằng Mentee được ghép với tôi có thể không học hoặc định hướng đúng ngành nghề của tôi và có thể không hoàn toàn khớp với mong muốn ban đầu của tôi. Vai trò Mentor không chỉ là tư vấn chuyên môn mà còn là lắng nghe, chia sẻ kinh nghiệm và hỗ trợ Mentee phát triển tư duy, năng lực và định hướng."
  },
  MENTOR_MENTORING_PRINCIPLE_V1: {
    key: "MENTOR_MENTORING_PRINCIPLE_V1",
    version: 1,
    role: "mentor",
    wording:
      "Tôi hiểu rằng mentoring là một quá trình đồng hành. Tôi sẽ tôn trọng Mentee, lắng nghe, trao đổi cởi mở và không áp đặt quyết định cá nhân lên Mentee."
  },
  MENTOR_CONDUCT_V1: {
    key: "MENTOR_CONDUCT_V1",
    version: 1,
    role: "mentor",
    wording:
      "Tôi cam kết tuân thủ Code of Conduct của UEH Mentoring; không sử dụng quan hệ mentoring để bán hàng, bán khóa học, tuyển dụng đa cấp hoặc phục vụ các lợi ích cá nhân không phù hợp với mục tiêu của chương trình; đồng thời tôn trọng ranh giới nghề nghiệp và sự an toàn của Mentee."
  },
  MENTOR_NO_GHOST_V1: {
    key: "MENTOR_NO_GHOST_V1",
    version: 1,
    role: "mentor",
    wording:
      "Nếu có vấn đề khiến tôi không thể tiếp tục đồng hành hoặc cảm thấy matching chưa phù hợp, tôi sẽ chủ động trao đổi với Ban Tổ chức thay vì tự ngừng liên lạc hoặc rời chương trình."
  },
  MENTOR_ACTIVE_READING_V1: {
    key: "MENTOR_ACTIVE_READING_V1",
    version: 1,
    role: "mentor",
    wording: MENTOR_CONFIRMATION_PHRASE
  },
  MENTEE_CROSS_INDUSTRY_V1: {
    key: "MENTEE_CROSS_INDUSTRY_V1",
    version: 1,
    role: "mentee",
    wording:
      "Tôi hiểu rằng Mentor của tôi có thể không làm cùng ngành hoặc đúng chuyên môn mà tôi đang theo đuổi. Mentoring không chỉ nhằm cung cấp kiến thức chuyên môn mà còn giúp tôi phát triển tư duy, định hướng, kỹ năng và năng lực cá nhân."
  },
  MENTEE_MENTOR_LEVEL_EXPECTATION_V1: {
    key: "MENTEE_MENTOR_LEVEL_EXPECTATION_V1",
    version: 1,
    role: "mentee",
    wording:
      "Tôi hiểu rằng Mentor của tôi có thể là C-level, Manager hoặc một anh/chị có kinh nghiệm quản lý và chuyên môn phù hợp. UEH Mentoring không cam kết tôi sẽ được ghép với Mentor ở một chức danh cụ thể."
  },
  MENTEE_PROACTIVE_SCHEDULING_V1: {
    key: "MENTEE_PROACTIVE_SCHEDULING_V1",
    version: 1,
    role: "mentee",
    wording:
      "Tôi hiểu rằng tôi là người chủ động trong mối quan hệ mentoring. Tôi có trách nhiệm chủ động liên hệ và sắp xếp lịch gặp Mentor, dự kiến tối thiểu một lần mỗi tháng trong suốt mùa mentoring, thay vì chờ Mentor liên hệ với tôi."
  },
  MENTEE_CROSS_MENTORING_V1: {
    key: "MENTEE_CROSS_MENTORING_V1",
    version: 1,
    role: "mentee",
    wording:
      "Tôi hiểu rằng ngoài Mentor chính, tôi có quyền và được khuyến khích chủ động sử dụng cross-mentoring: liên hệ với một hoặc một số Mentor khác trong mạng lưới UEH Mentoring khi những anh/chị đó có kinh nghiệm phù hợp với vấn đề tôi đang cần hỗ trợ.",
    helper:
      "Ban Tổ chức sẽ hướng dẫn cách tìm và liên hệ Cross Mentor phù hợp. Cross-mentoring là nguồn lực bổ sung và không thay thế mối quan hệ với Mentor chính."
  },
  MENTEE_NO_GHOST_V1: {
    key: "MENTEE_NO_GHOST_V1",
    version: 1,
    role: "mentee",
    wording:
      "Nếu gặp khó khăn với Mentor, không sắp xếp được lịch gặp, cảm thấy matching chưa phù hợp hoặc có vấn đề khác, tôi sẽ chủ động trao đổi với Ban Tổ chức để được hỗ trợ thay vì im lặng, mất liên lạc hoặc tự ý dừng chương trình giữa mùa."
  },
  MENTEE_OWNERSHIP_V1: {
    key: "MENTEE_OWNERSHIP_V1",
    version: 1,
    role: "mentee",
    wording:
      "Tôi hiểu rằng giá trị của mentoring phụ thuộc rất lớn vào sự chủ động và cam kết của chính mình. Mentor có thể mở ra góc nhìn, kinh nghiệm, kết nối và cơ hội, nhưng tôi chịu trách nhiệm đối với việc chuẩn bị, hành động và phát triển của bản thân."
  },
  MENTEE_ACTIVE_READING_V1: {
    key: "MENTEE_ACTIVE_READING_V1",
    version: 1,
    role: "mentee",
    wording: MENTEE_CONFIRMATION_PHRASE
  }
} satisfies Record<string, AcknowledgementDefinition>);

export const acknowledgementRegistry = Object.values(APPLICATION_ACKNOWLEDGEMENTS);

export function acknowledgementsForRole(role: ApplicationCommitmentRole) {
  return acknowledgementRegistry.filter((entry) => entry.role === role);
}

export function normalizeConfirmation(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/[.,!?;:'"()[\]{}…–—/+\\_=*@#$%^&|~`<>-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function confirmationMatches(value: string, expected: string): boolean {
  return normalizeConfirmation(value) === normalizeConfirmation(expected);
}

export type MentorEligibility =
  | "STANDARD_ELIGIBILITY_MET"
  | "REQUIRES_CORE_TEAM_EXCEPTION_REVIEW";

export function classifyMentorEligibility(totalWorkYears: number, peopleManagementYears: number): MentorEligibility {
  return totalWorkYears >= 8 && peopleManagementYears >= 3
    ? "STANDARD_ELIGIBILITY_MET"
    : "REQUIRES_CORE_TEAM_EXCEPTION_REVIEW";
}

export type ApplicationAnswerLike = {
  question_key?: string | null;
  value_text?: string | null;
  created_at?: string | null;
};

export function summarizeAcknowledgements(
  role: ApplicationCommitmentRole,
  answers: ApplicationAnswerLike[]
) {
  const byKey = new Map(answers.map((answer) => [String(answer.question_key ?? ""), answer]));
  const definitions = acknowledgementsForRole(role);
  const collected = definitions.map((definition) => ({
    definition,
    answer: byKey.get(definition.key) ?? null
  }));
  return {
    collected,
    completed: collected.every(({ answer }) => answer?.value_text === "true"),
    isHistorical: collected.every(({ answer }) => answer === null)
  };
}

export function mentorExperienceFromAnswers(answers: ApplicationAnswerLike[]) {
  const byKey = new Map(answers.map((answer) => [String(answer.question_key ?? ""), answer.value_text ?? ""]));
  const totalWorkYears = Number(byKey.get("mentor_total_work_years"));
  const peopleManagementYears = Number(byKey.get("mentor_people_management_years"));
  const hasExperience =
    byKey.has("mentor_total_work_years") &&
    byKey.has("mentor_people_management_years") &&
    Number.isFinite(totalWorkYears) &&
    Number.isFinite(peopleManagementYears);
  return {
    totalWorkYears: hasExperience ? totalWorkYears : null,
    peopleManagementYears: hasExperience ? peopleManagementYears : null,
    largestTeamSize: byKey.get("mentor_largest_team_size") || null,
    reference: byKey.get("mentor_reference") || null,
    eligibility: hasExperience ? classifyMentorEligibility(totalWorkYears, peopleManagementYears) : null
  };
}

export type CommitmentValidation =
  | { ok: true; eligibility?: MentorEligibility }
  | { ok: false; message: string };

export function validateMentorCommitments(input: {
  totalWorkYears: number;
  peopleManagementYears: number;
  largestTeamSize: number;
  acceptedKeys: ReadonlySet<string>;
  activeReading: string;
}): CommitmentValidation {
  if (!Number.isFinite(input.totalWorkYears) || input.totalWorkYears < 0) {
    return { ok: false, message: "Tổng số năm kinh nghiệm làm việc phải là số từ 0 trở lên." };
  }
  if (!Number.isFinite(input.peopleManagementYears) || input.peopleManagementYears < 0) {
    return { ok: false, message: "Tổng số năm kinh nghiệm quản lý con người/đội ngũ phải là số từ 0 trở lên." };
  }
  if (
    input.peopleManagementYears > 0 &&
    (!Number.isFinite(input.largestTeamSize) || input.largestTeamSize < 1)
  ) {
    return {
      ok: false,
      message: "Vui lòng nhập quy mô đội ngũ lớn nhất đã trực tiếp quản lý (tối thiểu 1)."
    };
  }
  const missing = acknowledgementsForRole("mentor")
    .filter((entry) => entry.key !== "MENTOR_ACTIVE_READING_V1")
    .find((entry) => !input.acceptedKeys.has(entry.key));
  if (missing) return { ok: false, message: `Vui lòng xác nhận: ${missing.wording}` };
  if (!confirmationMatches(input.activeReading, MENTOR_CONFIRMATION_PHRASE)) {
    return {
      ok: false,
      message: "Câu xác nhận chủ động của Mentor chưa đúng. Vui lòng nhập lại câu được hiển thị."
    };
  }
  return {
    ok: true,
    eligibility: classifyMentorEligibility(input.totalWorkYears, input.peopleManagementYears)
  };
}

export function validateMenteeCommitments(input: {
  acceptedKeys: ReadonlySet<string>;
  activeReading: string;
}): CommitmentValidation {
  const missing = acknowledgementsForRole("mentee")
    .filter((entry) => entry.key !== "MENTEE_ACTIVE_READING_V1")
    .find((entry) => !input.acceptedKeys.has(entry.key));
  if (missing) return { ok: false, message: `Vui lòng xác nhận: ${missing.wording}` };
  if (!confirmationMatches(input.activeReading, MENTEE_CONFIRMATION_PHRASE)) {
    return {
      ok: false,
      message: "Câu xác nhận chủ động của Mentee chưa đúng. Vui lòng nhập lại câu được hiển thị."
    };
  }
  return { ok: true };
}
