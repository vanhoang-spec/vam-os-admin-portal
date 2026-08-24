/**
 * Informational header for the S12 mentor application form.
 *
 * Content only — approved Vietnamese copy, reproduced verbatim. This component
 * renders no inputs, reads no state and takes no props, so it cannot affect
 * eligibility validation or submission behaviour. Emphasis markup is
 * presentation: it highlights the numbers an applicant scans for without
 * altering a single word of the policy text.
 *
 * Layout follows the existing FormSection shell (same card, border, radius and
 * shadow) so it sits in the form's `grid gap-6` stack like any other section.
 * The two requirement lists sit side by side from `sm` upward and stack on
 * mobile.
 */

const STEPS: Array<{ title: string; body: string; note?: React.ReactNode }> = [
  {
    title: "Bước 1 – Đăng ký tham gia",
    body: "Điền form đăng ký bên dưới.",
    note: (
      <>
        Lưu ý: Chương trình nhận đăng ký Mentor mới Mùa 12 đến hết ngày{" "}
        <strong className="font-semibold">19/09/2026</strong>.
      </>
    )
  },
  {
    title: "Bước 2 – Trao đổi 1:1 cùng đại diện Ban Điều hành",
    body:
      "Dựa trên tiêu chí của chương trình, Ban Điều hành sẽ mời các hồ sơ phù hợp tham gia một " +
      "buổi trao đổi 1:1 để hai bên hiểu rõ hơn về cách thức đồng hành và mức độ phù hợp."
  },
  {
    title: "Bước 3 – Tham dự Mentor Orientation",
    body:
      "Tìm hiểu về vai trò của Mentor, phương thức mentoring và những kinh nghiệm cần thiết " +
      "trong quá trình đồng hành."
  }
];

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-vam-green">{children}</h3>
  );
}

export function MentorProfileIntro() {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
      <h2 className="text-base font-semibold text-vam-ink sm:text-lg">
        Chân dung Mentor mà UEH Mentoring đang tìm kiếm
      </h2>

      {/* Tinh thần tham gia */}
      <p className="mt-3 text-sm leading-6 text-slate-600">
        Mentor tham gia trên tinh thần tự nguyện, không nhận thù lao từ chương trình hoặc từ
        mentee. Mentor không nhất thiết phải là người “thành công” theo nghĩa chức danh, mà là
        người có trải nghiệm, có sự tử tế, tinh thần trách nhiệm và khả năng lắng nghe.
      </p>

      {/* Năng lực kỳ vọng + Cam kết */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <SubHeading>Năng lực kỳ vọng đối với Mentor</SubHeading>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
            <li>
              Có tối thiểu <strong className="font-semibold text-vam-ink">08 năm</strong> kinh
              nghiệm làm việc, trong đó ít nhất{" "}
              <strong className="font-semibold text-vam-ink">03 năm</strong> trực tiếp quản lý con
              người hoặc đội ngũ.
            </li>
            <li>
              Có khả năng lắng nghe, giao tiếp, gợi mở và tôn trọng những góc nhìn khác với mình.
            </li>
          </ul>
        </div>

        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <SubHeading>Cam kết</SubHeading>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
            <li>
              Dành tối thiểu <strong className="font-semibold text-vam-ink">01–02 giờ mỗi tháng</strong>{" "}
              cho mỗi mentee.
            </li>
            <li>
              Đồng hành xuyên suốt một mùa mentoring kéo dài{" "}
              <strong className="font-semibold text-vam-ink">09 tháng</strong>.
            </li>
            <li>
              Tham dự các sinh hoạt chính và tuân thủ Quy chế cùng Bộ Quy tắc ứng xử do Ban Điều
              hành ban hành.
            </li>
            <li>
              Mỗi Mentor được ghép tối đa{" "}
              <strong className="font-semibold text-vam-ink">02 mentee</strong> trong một mùa và
              hiểu rằng mentee có thể không cùng ngành hoặc không hoàn toàn phù hợp với mong muốn
              ban đầu.
            </li>
          </ul>
        </div>
      </div>

      {/* Quy trình trở thành Mentor chính thức */}
      <div className="mt-5">
        <SubHeading>Quy trình trở thành Mentor chính thức</SubHeading>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          👉 Để trở thành Mentor chính thức của chương trình, Anh/Chị sẽ đi qua 03 bước sau:
        </p>

        <ol className="mt-3 grid gap-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-3 rounded-md border border-vam-line bg-white p-3"
            >
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-vam-mint text-xs font-semibold text-vam-green"
              >
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-vam-ink">{step.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">{step.body}</p>
                {step.note ? (
                  <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900">
                    {step.note}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Closing */}
      <p className="mt-4 border-t border-vam-line pt-4 text-sm leading-6 text-slate-600">
        Sau khi hoàn tất 03 bước trên, Anh/Chị sẽ được chính thức xác nhận là Mentor của chương
        trình và sẵn sàng bước vào hành trình đồng hành cùng các Mentee.
      </p>
    </section>
  );
}
