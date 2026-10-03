import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { canBulkAssignReviews, canManageUsers, canReview } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";

// ---------------------------------------------------------------------------
// Micro-components (pure display, no client JS needed)
// ---------------------------------------------------------------------------

function SectionCard({
  number,
  title,
  accent = "slate",
  children
}: {
  /**
   * Omitted when the reader sees a single section. A numbered marker claims
   * the reader is somewhere in a sequence; standing alone it says nothing
   * true.
   */
  number?: string | number;
  title: string;
  accent?: "slate" | "green" | "amber" | "blue" | "red";
  children: React.ReactNode;
}) {
  const accentRing: Record<string, string> = {
    slate: "bg-slate-600 text-white",
    green: "bg-vam-green text-white",
    amber: "bg-amber-500 text-white",
    blue: "bg-blue-600 text-white",
    red: "bg-red-600 text-white"
  };
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft">
      <div className="mb-4 flex items-center gap-3">
        {number === undefined ? null : (
          <span
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${accentRing[accent]}`}
          >
            {number}
          </span>
        )}
        <h2 className="text-base font-semibold text-vam-ink">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Callout({
  variant = "info",
  children
}: {
  variant?: "info" | "warning" | "danger" | "success";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    info: "border-blue-200 bg-blue-50 text-blue-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    danger: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800"
  };
  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${styles[variant]}`}>{children}</div>
  );
}

function Checklist({ items }: { items: Array<{ label: React.ReactNode; sub?: string }> }) {
  return (
    <ol className="space-y-2.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-500">
            {i + 1}
          </span>
          <div>
            <span className="text-sm text-vam-ink">{item.label}</span>
            {item.sub && <p className="mt-0.5 text-xs text-slate-500">{item.sub}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
      {children}
    </code>
  );
}

/**
 * What each of the five scores means when reading a MENTEE application.
 *
 * The five criteria are shared by every review in the system — same columns for
 * mentor and mentee, same columns for the profile round and the interview. That
 * made the descriptions generic by necessity ("Mức độ chủ động, nhiệt huyết"),
 * and generic descriptions are the thing that lets two reviewers score the same
 * application four points apart.
 *
 * Season 12 puts twenty-two volunteer mentors on mentee profile screening, most
 * of them scoring for the first time. So each criterion now names the questions
 * in the mentee form it is actually read from, and says what separates a low
 * score from a high one. The intake questions are quoted as they appear to the
 * applicant, so a reviewer can find them on the page in front of them.
 */
function MenteeScoreGuide() {
  const criteria = [
    {
      field: "score_motivation",
      label: "Động lực",
      read: ["Vì sao bạn chọn UEH Mentoring?", 'Mô tả "phiên bản tốt nhất của bạn sau 1 năm"'],
      low: "Lý do ai viết cũng được — “muốn học hỏi”, “muốn phát triển bản thân”. Đọc xong không biết gì thêm về riêng người này.",
      high: "Nói được hoàn cảnh cụ thể của chính mình: vì sao là lúc này, vì sao là chương trình này, đang đứng ở đâu và muốn đi đâu."
    },
    {
      field: "score_goal_clarity",
      label: "Rõ ràng mục tiêu",
      read: ["Mục tiêu cụ thể bạn muốn đạt được qua mentoring (3-6 tháng)", "3 câu hỏi cụ thể bạn muốn hỏi mentor"],
      low: "Mục tiêu quá rộng hoặc quá xa để làm được trong một mùa. Ba câu hỏi thực ra là một câu hỏi chung viết ba lần.",
      high: "Mục tiêu nhìn vào là biết sau 3-6 tháng đạt hay chưa. Ba câu hỏi cho thấy đã tự tìm hiểu trước khi hỏi."
    },
    {
      field: "score_commitment",
      label: "Cam kết",
      read: [
        "Kế hoạch của bạn để tận dụng mentoring",
        "Nếu mentoring không hiệu quả như mong đợi, bạn sẽ làm gì?",
        "Bạn sẵn sàng phỏng vấn 30 phút (nếu được mời) trong đợt nào?",
        "Bạn sẵn sàng tham gia kickoff event của chương trình không?"
      ],
      low: "Kế hoạch dừng ở “sẽ cố gắng”. Khi mọi việc không như ý thì quy về hoàn cảnh hoặc về phía mentor. Không chọn được đợt phỏng vấn nào.",
      high: "Nói được sẽ chuẩn bị gì trước mỗi buổi và theo dõi tiến bộ ra sao. Nhận phần trách nhiệm của mình trước khi nghĩ đến việc dừng."
    },
    {
      field: "score_fit",
      label: "Phù hợp chương trình",
      read: [
        "Khó khăn cụ thể bạn đang cần mentor hỗ trợ",
        "Ngành nghề bạn muốn theo đuổi",
        "Chức năng / vị trí công việc bạn quan tâm",
        "Soft skills bạn muốn phát triển (chọn tối đa 3)"
      ],
      low: "Thứ đang cần không phải là mentoring — cần một chỗ thực tập, cần dạy kèm một môn, cần hỗ trợ tài chính.",
      high: "Khó khăn đúng loại mà một người đi trước gỡ được: chọn hướng, ra quyết định, hiểu nghề từ người đã làm."
    },
    {
      field: "score_communication",
      label: "Giao tiếp",
      read: ["Toàn bộ các câu trả lời tự luận"],
      low: "Rời rạc, lạc đề, hoặc viết cho đủ số ký tự tối thiểu rồi dừng.",
      high: "Mạch lạc, đúng trọng tâm câu hỏi, người đọc hiểu ngay mà không phải đoán."
    }
  ];

  return (
    <div className="space-y-3">
      {criteria.map((c) => (
        <div key={c.field} className="rounded-md border border-vam-line bg-white p-3">
          {/*
            No field code here. `score_motivation` is how the column is
            spelled in storage and in the export — vocabulary for whoever
            reconciles a CSV, not for the person deciding whether an answer
            shows real motivation. The admin-only table below still carries it.
          */}
          <p className="text-sm font-semibold text-vam-ink">{c.label}</p>
          <p className="mt-2 text-xs font-semibold uppercase text-slate-500">Đọc câu nào trong đơn</p>
          <ul className="mt-1 space-y-0.5">
            {c.read.map((question) => (
              <li key={question} className="text-sm text-slate-700">
                <span className="text-slate-400">·</span> {question}
              </li>
            ))}
          </ul>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2.5">
              <p className="text-xs font-semibold uppercase text-amber-800">1–2 điểm</p>
              <p className="mt-1 text-sm leading-6 text-amber-900">{c.low}</p>
            </div>
            <div className="rounded-md border border-vam-green bg-vam-mint/40 p-2.5">
              <p className="text-xs font-semibold uppercase text-vam-green">4–5 điểm</p>
              <p className="mt-1 text-sm leading-6 text-vam-ink">{c.high}</p>
            </div>
          </div>
        </div>
      ))}

      {/*
        Straight from the mentee form's own opening text. A reviewer calibrating
        against "the best candidate" instead of "the candidate this programme is
        for" will reject exactly the people it was built to take.
      */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
        <p className="font-semibold">Chấm theo chân dung chương trình, không theo thành tích</p>
        <p className="mt-1">
          Form đăng ký nói rõ với ứng viên: UEH Mentoring không tìm những người “giỏi nhất” hay
          đã có sẵn mọi câu trả lời, mà tìm người thật sự muốn thay đổi và sẵn sàng hành động.
          Một bạn chưa biết chính xác mình muốn trở thành ai nhưng chủ động và cầu thị vẫn có thể
          là hồ sơ mạnh.
        </p>
        <p className="mt-2">
          Không trừ điểm vì lỗi chính tả, vì viết ngắn khi câu trả lời đã đủ ý, hay vì trường lớp
          và thành tích. Chấm dựa trên những gì ứng viên trả lời, không dựa trên họ là ai.
        </p>
      </div>
    </div>
  );
}

function ScoreTable() {
  const criteria = [
    { field: "score_motivation", label: "Động lực", desc: "Mức độ chủ động, nhiệt huyết và lý do rõ ràng để tham gia." },
    { field: "score_goal_clarity", label: "Rõ ràng mục tiêu", desc: "Ứng viên biết mình muốn đạt gì và kế hoạch cụ thể." },
    { field: "score_commitment", label: "Cam kết", desc: "Khả năng duy trì tham gia xuyên suốt mùa (thời gian, năng lượng)." },
    { field: "score_fit", label: "Phù hợp chương trình", desc: "Background, nhu cầu và kỳ vọng có phù hợp với định hướng VAM." },
    { field: "score_communication", label: "Giao tiếp", desc: "Câu trả lời mạch lạc, rõ ràng, thể hiện kỹ năng diễn đạt." }
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-vam-line">
      <table className="min-w-full divide-y divide-vam-line text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Tiêu chí</th>
            <th className="px-3 py-2">Tên trường</th>
            <th className="px-3 py-2">Mô tả</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {criteria.map((c) => (
            <tr key={c.field}>
              <td className="px-3 py-2 font-medium text-vam-ink whitespace-nowrap">{c.label}</td>
              <td className="px-3 py-2"><Code>{c.field}</Code></td>
              <td className="px-3 py-2 text-slate-600">{c.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationTable() {
  const recs = [
    { value: "pass_to_interview", label: "Mời vào vòng phỏng vấn", when: "Hồ sơ tốt, đủ điều kiện tiếp tục." },
    { value: "waitlist", label: "Đưa vào danh sách chờ", when: "Tiềm năng nhưng cần xem xét thêm hoặc slot còn hạn chế." },
    { value: "reject", label: "Không phù hợp / từ chối", when: "Hồ sơ không đáp ứng yêu cầu tối thiểu." },
    { value: "needs_admin_review", label: "Cần core team/admin xem thêm", when: "Trường hợp đặc biệt, reviewer chưa chắc chắn." }
  ];
  return (
    <div className="overflow-x-auto rounded-md border border-vam-line">
      <table className="min-w-full divide-y divide-vam-line text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2">Lựa chọn</th>
            <th className="px-3 py-2">Khi nào dùng</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {recs.map((r) => (
            <tr key={r.value}>
              <td className="px-3 py-2 font-medium text-vam-ink whitespace-nowrap">{r.label}</td>
              <td className="px-3 py-2 text-slate-600">{r.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ReviewerGuidePage() {
  const adminUser = await getCurrentAdminUser();
  if (!adminUser?.id) redirect("/login");
  if (!canReview(adminUser.role)) redirect("/");

  const isAdmin = canBulkAssignReviews(adminUser.role);
  const canManageUserAccounts = canManageUsers(adminUser.role);

  return (
    <>
      <PageHeader
        title="Hướng dẫn vận hành Review"
        description="Tài liệu tham khảo cho admin và reviewer — quy trình từ setup tài khoản đến nộp kết quả."
      />

      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <Link href="/reviews" className="text-vam-green hover:underline">
          ← Danh sách reviews
        </Link>
        {isAdmin && (
          <>
            <span className="text-slate-300">·</span>
            <Link href="/reviews/assign-bulk" className="text-vam-green hover:underline">
              Chia hồ sơ
            </Link>
            <span className="text-slate-300">·</span>
            <Link href="/reviews/progress" className="text-vam-green hover:underline">
              Tiến độ review
            </Link>
          </>
        )}
      </div>

      <div className="space-y-6 pb-16">
        {/* ── 1. Account policy — ADMIN ONLY ─────────────────────── */}
        {isAdmin && (
        <SectionCard number={1} title="Chính sách tài khoản reviewer" accent="red">
          <Callout variant="danger">
            <strong>Không dùng tài khoản chung (shared account).</strong> Mỗi reviewer phải có tài
            khoản riêng với email thật của họ. Dữ liệu review được gắn với{" "}
            <Code>reviewer_admin_user_id</Code> — nếu dùng chung tài khoản, không thể phân biệt ai
            đã chấm hồ sơ nào.
          </Callout>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-vam-green">✓</span>
              Mỗi reviewer dùng email cá nhân của mình (không phải email tập thể).
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-vam-green">✓</span>
              Role phải là <Code>reviewer</Code> — không cấp <Code>admin</Code> hay{" "}
              <Code>core_team</Code> cho reviewer thông thường.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 text-vam-green">✓</span>
              Reviewer chỉ thấy các đơn được giao cho họ — RLS đảm bảo điều này tự động.
            </li>
          </ul>
        </SectionCard>
        )}

        {/* ── 2. Admin setup checklist ──────────────────────────── */}
        {isAdmin && (
          <SectionCard number={2} title="Danh sách công việc — Tạo tài khoản reviewer" accent="blue">
            <Checklist
              items={[
                {
                  label: canManageUserAccounts ? (
                    <>
                      Vào <Link href="/admin/users" className="text-vam-green hover:underline">/admin/users</Link> → nhấn{" "}
                      <strong>Tạo admin user mới</strong>.
                    </>
                  ) : (
                    <>Liên hệ <strong>Super Admin</strong> để tạo tài khoản reviewer mới.</>
                  )
                },
                {
                  label: (
                    <>
                      Điền email (email thật của reviewer), đặt <Code>role = reviewer</Code>,{" "}
                      <Code>status = active</Code>.
                    </>
                  ),
                  sub: "Reviewer có thể login ngay sau khi tài khoản được tạo và họ đặt mật khẩu qua Supabase Auth."
                },
                {
                  label: "Gửi link đăng nhập cho reviewer: hướng dẫn họ truy cập /login và đăng nhập bằng email vừa tạo."
                },
                {
                  label: (
                    <>
                      Yêu cầu reviewer xác nhận đã vào được{" "}
                      <Link href="/reviews" className="text-vam-green hover:underline">/reviews</Link>{" "}
                      và thấy trang danh sách reviews.
                    </>
                  ),
                  sub: "Nếu họ thấy trang trống (chưa có review nào) là đúng — review chỉ xuất hiện sau khi chia hồ sơ."
                },
                {
                  label: (
                    <>
                      Kiểm tra lại: reviewer <strong>không được</strong> thấy menu admin (/admin/users, /admin)
                      hay nút &ldquo;Chia hồ sơ review&rdquo;. Nếu thấy → role bị set sai.
                    </>
                  )
                }
              ]}
            />
            <Callout variant="info" >
              <p className="mt-3">
                <strong>Để reviewer nhận được hồ sơ:</strong> ô chọn người phụ trách tại{" "}
                <Link href="/reviews/assign-bulk" className="text-blue-700 underline">
                  /reviews/assign-bulk
                </Link>{" "}
                chỉ liệt kê người có quyền đánh giá hoặc phỏng vấn trong mùa của đợt tuyển. Tạo tài khoản
                xong mà chưa thấy tên, vào{" "}
                <Link href="/reviews/reviewer-pool" className="text-blue-700 underline">
                  Danh sách nhân sự tuyển sinh
                </Link>{" "}
                để cấp quyền.
              </p>
            </Callout>
          </SectionCard>
        )}

        {/* ── 3. Bulk assignment checklist ─────────────────────── */}
        {isAdmin && (
          <SectionCard number={3} title="Danh sách công việc — Chia hồ sơ" accent="green">
            {/*
              Tả đúng màn hình giao tay đang có: mỗi lần giao, một người nhận.
              Bản trước vẫn tả luồng chia tự động (tick nhiều reviewer, cân khối
              lượng, mục D đặt hạn, mục E soát bảng phân bổ) sau khi màn hình đã
              bỏ nó, và người vận hành đi tìm những ô không tồn tại. Mọi nhãn
              trích ở đây được đối chiếu với màn hình thật trong
              __tests__/reviews-guide-assign-steps.test.tsx.
            */}
            <Checklist
              items={[
                {
                  label: (
                    <>
                      Vào{" "}
                      <Link href="/reviews/assign-bulk" className="text-vam-green hover:underline">
                        /reviews/assign-bulk
                      </Link>
                      .
                    </>
                  )
                },
                {
                  label: (
                    <>
                      Chọn <strong>Đợt tuyển</strong>, <strong>Role ứng tuyển</strong> (Mentor hoặc Mentee) và{" "}
                      <strong>Vòng phân công</strong> (Đánh giá hồ sơ hoặc Phỏng vấn), rồi nhấn{" "}
                      <strong>Tiếp tục</strong>.
                    </>
                  ),
                  sub: "Muốn đổi sang đợt, vai trò hay vòng khác thì bấm “← Chọn batch / role khác” ở đầu trang."
                },
                {
                  label: (
                    <>
                      Danh sách mở sẵn ở tab <strong>Chưa giao</strong> — những hồ sơ chưa có ai phụ trách. Mỗi
                      trang 10 hồ sơ, ai nộp trước đứng trước.
                    </>
                  ),
                  sub: "Tab “Đã giao” là hồ sơ đã có người nhận, tên người đó nằm ở cột “Người phụ trách”. Tab “Tất cả” gộp cả hai."
                },
                {
                  label: (
                    <>
                      Tick ô đầu dòng những hồ sơ muốn giao, hoặc nhấn <strong>Chọn cả trang</strong> để lấy
                      nguyên lô đang hiện.
                    </>
                  ),
                  sub: "“Chọn cả trang” chỉ chọn những hồ sơ đang hiện trên trang, không chọn cả đợt. Dấu tick vẫn giữ khi sang lô khác, đổi tab hay tìm kiếm, nên có thể chọn dần rồi giao một lần — số “Đang chọn” cho biết tổng cộng bao nhiêu. Nhấn “Bỏ chọn” để chọn lại từ đầu."
                },
                {
                  label: (
                    <>
                      Ở khung <strong>Giao cho người phụ trách</strong>, chọn đúng một người. Mỗi lần giao chỉ
                      cho một người; muốn chia cho nhiều người thì giao từng lượt, mỗi lượt một lô.
                    </>
                  ),
                  sub: "Ô này chỉ liệt kê người có quyền đánh giá (hoặc phỏng vấn) trong mùa của đợt tuyển. Không thấy tên ai thì vào Danh sách nhân sự tuyển sinh (/reviews/reviewer-pool) để cấp quyền cho người đó."
                },
                {
                  label: (
                    <>
                      Đọc lại câu <strong>Bạn sắp giao … cho …</strong>, rồi nhấn{" "}
                      <strong>Xác nhận giao hồ sơ</strong> (ở vòng phỏng vấn, nút này là{" "}
                      <strong>Xác nhận giao phỏng vấn</strong>).
                    </>
                  ),
                  sub: "Con số trong câu là số hồ sơ sẽ thật sự được giao. Hồ sơ đã có người phụ trách không bị giao thêm dù đang được tick, nên số này có thể nhỏ hơn số “Đang chọn”. Nút chỉ bấm được khi đã chọn người và tick ít nhất một hồ sơ chưa giao."
                },
                {
                  label: (
                    <>
                      Xác minh kết quả tại{" "}
                      <Link href="/reviews/progress" className="text-vam-green hover:underline">
                        /reviews/progress
                      </Link>{" "}
                      — ở dòng của người vừa nhận, cột &ldquo;Chưa bắt đầu&rdquo; phải tăng đúng số hồ sơ vừa giao.
                    </>
                  ),
                  sub: "Trên trang chia hồ sơ, các hồ sơ vừa giao cũng đã chuyển sang tab “Đã giao”."
                }
              ]}
            />

            <h3 className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-500">
              Lấy lại hồ sơ đã giao — Huỷ phân công
            </h3>
            <Checklist
              items={[
                {
                  label: (
                    <>
                      Cũng trên trang đó, mở tab <strong>Đã giao</strong> và tick những hồ sơ muốn lấy lại. Cột{" "}
                      <strong>Người phụ trách</strong> cho biết hồ sơ đang ở chỗ ai.
                    </>
                  )
                },
                {
                  label: (
                    <>
                      Ở khung <strong>Huỷ phân công</strong> cuối trang, ghi <strong>Lý do huỷ</strong>, rồi nhấn{" "}
                      <strong>Huỷ phân công đã chọn</strong>.
                    </>
                  ),
                  sub: "Lý do là bắt buộc (ít nhất 3 ký tự) và được lưu vào lịch sử của từng hồ sơ. Câu “Sắp trả … về hàng chờ” cho biết số hồ sơ sẽ được trả. Mỗi lần huỷ tối đa 25 hồ sơ."
                },
                {
                  label: (
                    <>
                      Hồ sơ quay về tab <strong>Chưa giao</strong> và giao lại được cho người khác theo các bước ở
                      trên.
                    </>
                  ),
                  sub: "Điểm và ghi chú người cũ đã nhập không bị xoá, vẫn nằm trong lịch sử của hồ sơ."
                }
              ]}
            />
            <div className="mt-4 space-y-2">
              <Callout variant="info">
                <strong>Không lo giao trùng:</strong> hồ sơ đã có người phụ trách chỉ nằm ở tab Đã giao và
                không được giao thêm lần nữa. Muốn đổi người thì huỷ phân công trước, rồi giao lại.
              </Callout>
              <Callout variant="warning">
                <strong>Không thấy hồ sơ trong tab Đã giao?</strong> Ở vòng Đánh giá hồ sơ, hồ sơ rời khỏi
                trang này ngay khi người chấm bắt đầu chấm. Muốn lấy lại hồ sơ đang chấm dở, mở hồ sơ đó
                trong mục{" "}
                <Link href="/applications" className="underline">
                  Ứng tuyển
                </Link>{" "}
                và bấm Huỷ phân công ở khung Giao Review.
              </Callout>
            </div>
          </SectionCard>
        )}

        {/* ── 4. Reviewer workflow ──────────────────────────────── */}
        <SectionCard
          number={isAdmin ? 4 : undefined}
          title="Hướng dẫn Reviewer — Quy trình làm việc"
          accent="green"
        >
          <Checklist
            items={[
              {
                label: (
                  <>
                    Đăng nhập tại{" "}
                    <Link href="/login" className="text-vam-green hover:underline">
                      /login
                    </Link>{" "}
                    bằng email và mật khẩu cá nhân.
                  </>
                )
              },
              {
                label: (
                  <>
                    Vào{" "}
                    <Link href="/reviews" className="text-vam-green hover:underline">
                      /reviews
                    </Link>{" "}
                    — danh sách các đơn được giao hiển thị ở đây.
                  </>
                ),
                sub: 'Các đơn có trạng thái "Chưa bắt đầu" là chưa xử lý.'
              },
              {
                label: 'Nhấn "Làm review" trên một đơn để mở trang chấm điểm.',
                sub: "Trang hiển thị thông tin ứng viên, câu trả lời đơn và form chấm điểm."
              },
              {
                label: "Đọc kỹ thông tin ứng viên: thông tin cơ bản, câu trả lời trong đơn (raw_payload).",
                sub: "Lưu ý xem phần câu hỏi động lực, mục tiêu và cam kết thời gian."
              },
              {
                label: "Chấm điểm 5 tiêu chí (mỗi tiêu chí từ 1 đến 5).",
                sub: "Xem bảng tiêu chí bên dưới để biết cách chấm."
              },
              {
                label: "Chọn kết quả đề xuất.",
                sub: "Xem bảng recommendation bên dưới."
              },
              {
                label: "Viết ghi chú nhận xét vào ô Ghi chú reviewer.",
                sub: "Ghi chú giúp core team ra quyết định cuối và hiểu context của reviewer."
              },
              {
                label: (
                  <>
                    Nhấn <strong>&ldquo;Lưu nháp&rdquo;</strong> nếu muốn tiếp tục sau, hoặc{" "}
                    <strong>&ldquo;Nộp Review&rdquo;</strong> để hoàn tất.
                  </>
                ),
                sub: "Sau khi nộp không thể chỉnh sửa. Nếu cần sửa, liên hệ admin để cancel và tạo lại."
              }
            ]}
          />

          <div className="mt-5 space-y-4">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Tiêu chí chấm điểm — đơn Mentee (1 = Yếu · 3 = Trung bình · 5 = Xuất sắc)
              </h3>
              <MenteeScoreGuide />
            </div>
            {isAdmin ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Tên trường dữ liệu (dùng khi đối chiếu file xuất điểm)
              </h3>
              <ScoreTable />
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Năm tiêu chí này dùng chung cho cả đơn mentor và đơn mentee, cả vòng hồ sơ và
                vòng phỏng vấn. Phần mô tả ở trên viết riêng cho việc chấm đơn mentee vòng hồ sơ.
              </p>
            </div>
            ) : null}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Kết quả đề xuất
              </h3>
              <RecommendationTable />
            </div>
          </div>
        </SectionCard>

        {/* ── 5. Security notes — ADMIN ONLY ────────────────────── */}
        {isAdmin && (
        <SectionCard
          number={5}
          title="Bảo mật & quản trị tài khoản"
          accent="amber"
        >
          <ul className="space-y-2 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
              <span>
                <strong>Không chia sẻ mật khẩu.</strong> Mỗi người tự đặt mật khẩu qua link Supabase Auth.
                Admin không cần biết mật khẩu của reviewer.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
              <span>
                <strong>Reviewer chỉ thấy đơn của mình.</strong> RLS (Row Level Security) trong database
                tự động giới hạn quyền đọc — không cần cấu hình thêm.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
              <span>
                <strong>Deactivate tài khoản sau mỗi mùa.</strong> Sau khi mùa review kết thúc, set{" "}
                <Code>status = inactive</Code> cho tài khoản reviewer tại /admin/users. Dữ liệu review
                vẫn được giữ lại, chỉ block login.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
              <span>
                <strong>Reviewer rời giữa mùa.</strong> Không sửa tay trong database. Vào
                /reviews/assign-bulk, mở tab Đã giao, tick các hồ sơ đang ghi tên người đó, ghi lý do rồi
                bấm Huỷ phân công đã chọn — hồ sơ về lại tab Chưa giao để giao cho người khác. Hồ sơ họ
                đang chấm dở thì huỷ trên trang của từng hồ sơ (xem mục 3).
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-amber-500">⚠</span>
              <span>
                <strong>Không cấp role admin/core_team cho reviewer thông thường.</strong> Role cao hơn
                có thể đọc toàn bộ dữ liệu và thực hiện các thao tác quản trị.
              </span>
            </li>
          </ul>
        </SectionCard>
        )}

        {/* ── 6. Test data ──────────────────────────────────────── */}
        {isAdmin && (
          <SectionCard
            number={6}
            title="Tạo dữ liệu test cho Bulk Assignment"
            accent="slate"
          >
            <p className="mb-3 text-sm text-slate-600">
              Pool hồ sơ hiện tại (S12-B1) chỉ có vài đơn và đã được review/approve. Để test
              luồng bulk assignment đầy đủ, tạo 4–6 đơn giả với SQL sau trong Supabase Studio:
            </p>
            <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-950 px-4 py-3 text-xs text-slate-200">
{`-- Thay <YOUR_BATCH_UUID> bằng id thật của intake batch cần test.
-- Lấy id: SELECT id, code, name FROM public.intake_batches;

INSERT INTO public.applications (
  role_applied, full_name, email_primary,
  status, intake_batch_id, submitted_at,
  source, consent_data_storage
) VALUES
  ('mentee','Test Mentee 1','testm1@vam-test.local','submitted','<YOUR_BATCH_UUID>',now(),'test',true),
  ('mentee','Test Mentee 2','testm2@vam-test.local','submitted','<YOUR_BATCH_UUID>',now(),'test',true),
  ('mentee','Test Mentee 3','testm3@vam-test.local','submitted','<YOUR_BATCH_UUID>',now(),'test',true),
  ('mentee','Test Mentee 4','testm4@vam-test.local','submitted','<YOUR_BATCH_UUID>',now(),'test',true),
  ('mentee','Test Mentee 5','testm5@vam-test.local','submitted','<YOUR_BATCH_UUID>',now(),'test',true),
  ('mentee','Test Mentee 6','testm6@vam-test.local','submitted','<YOUR_BATCH_UUID>',now(),'test',true);`}
            </pre>
            <div className="mt-3 space-y-2">
              <Callout variant="warning">
                <strong>Dọn dẹp sau khi test:</strong> Xoá các đơn test trước khi chạy production batch.
                <br />
                <code className="mt-1 block font-mono text-xs">
                  DELETE FROM public.applications WHERE source = &apos;test&apos; AND email_primary LIKE &apos;%@vam-test.local&apos;;
                </code>
              </Callout>
              <Callout variant="info">
                Sau khi insert, vào{" "}
                <Link href="/reviews/assign-bulk" className="text-blue-700 underline">
                  /reviews/assign-bulk
                </Link>
                , chọn đợt tuyển vừa dùng, Role ứng tuyển = Mentee, Vòng phân công = Đánh giá hồ sơ → các
                đơn test sẽ xuất hiện ở tab &ldquo;Chưa giao&rdquo;.
              </Callout>
            </div>
          </SectionCard>
        )}
      </div>
    </>
  );
}
