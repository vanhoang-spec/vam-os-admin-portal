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
  number: string | number;
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
        <span
          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${accentRing[accent]}`}
        >
          {number}
        </span>
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
            <th className="px-3 py-2">Giá trị (value)</th>
            <th className="px-3 py-2">Hiển thị</th>
            <th className="px-3 py-2">Khi nào dùng</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-vam-line">
          {recs.map((r) => (
            <tr key={r.value}>
              <td className="px-3 py-2"><Code>{r.value}</Code></td>
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
        {/* ── 1. Account policy ─────────────────────────────────── */}
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
                <strong>Quản lý nhiều reviewer:</strong> Tất cả reviewer active sẽ xuất hiện tự động
                trong danh sách checklist tại{" "}
                <Link href="/reviews/assign-bulk" className="text-blue-700 underline">
                  /reviews/assign-bulk
                </Link>
                . Không cần cấu hình thêm.
              </p>
            </Callout>
          </SectionCard>
        )}

        {/* ── 3. Bulk assignment checklist ─────────────────────── */}
        {isAdmin && (
          <SectionCard number={3} title="Danh sách công việc — Chia hồ sơ" accent="green">
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
                  label: "Chọn Đợt tuyển và Vai trò ứng tuyển (mentee hoặc mentor) → nhấn Tiếp tục.",
                  sub: "Trang sẽ load danh sách hồ sơ và reviewer khả dụng."
                },
                {
                  label: (
                    <>
                      Mục A — Chọn trạng thái đơn cần giao. Mặc định bao gồm{" "}
                      <Code>submitted</Code>, <Code>under_data_check</Code>,{" "}
                      <Code>ready_for_screening</Code>.
                    </>
                  ),
                  sub: "Không chọn screening_assigned trừ khi bạn muốn giao lại hồ sơ đã có reviewer."
                },
                {
                  label: (
                    <>
                      Giữ nguyên tuỳ chọn{" "}
                      <strong>&ldquo;Bỏ qua hồ sơ đã có reviewer&rdquo;</strong> (mặc định bật). Điều này
                      tránh tạo duplicate review row.
                    </>
                  )
                },
                {
                  label: "Mục C — Tick chọn các reviewer sẽ nhận hồ sơ. Xem workload hiện tại để cân đối.",
                  sub: "Thuật toán sẽ ưu tiên giao nhiều hơn cho reviewer ít việc nhất (workload thấp nhất)."
                },
                {
                  label: "Mục D — Đặt hạn nộp (due_at) và ghi chú phân công nếu cần.",
                  sub: 'Ví dụ ghi chú: "S12 B1 — lần 1 — 50 mentee".'
                },
                {
                  label: "Mục E — Kiểm tra bảng phân bổ: số hồ sơ min/max giữa các reviewer chênh không quá 1.",
                  sub: "Sau đó tick ô xác nhận để mở nút submit."
                },
                {
                  label: 'Nhấn "Xác nhận giao hồ sơ". Hệ thống sẽ tạo review row và cập nhật trạng thái đơn.'
                },
                {
                  label: (
                    <>
                      Xác minh kết quả tại{" "}
                      <Link href="/reviews/progress" className="text-vam-green hover:underline">
                        /reviews/progress
                      </Link>{" "}
                      — cột &ldquo;Chưa bắt đầu&rdquo; phải tăng đúng số hồ sơ vừa giao.
                    </>
                  )
                }
              ]}
            />
            <div className="mt-4">
              <Callout variant="warning">
                <strong>Tránh chia 2 lần cùng một pool:</strong> Nếu cần chia thêm (batch 2, đợt bổ sung),
                giữ nguyên &ldquo;Bỏ qua hồ sơ đã có reviewer&rdquo; để hệ thống tự bỏ qua các đơn đã được giao,
                chỉ giao phần mới.
              </Callout>
            </div>
          </SectionCard>
        )}

        {/* ── 4. Reviewer workflow ──────────────────────────────── */}
        <SectionCard
          number={isAdmin ? 4 : 2}
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
                Tiêu chí chấm điểm (1 = Yếu · 3 = Trung bình · 5 = Xuất sắc)
              </h3>
              <ScoreTable />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">
                Kết quả đề xuất
              </h3>
              <RecommendationTable />
            </div>
          </div>
        </SectionCard>

        {/* ── 5. Security notes ─────────────────────────────────── */}
        <SectionCard
          number={isAdmin ? 5 : 3}
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
                <strong>Reviewer rời giữa mùa.</strong> Cancel các review chưa submit của họ
                (update <Code>status = cancelled</Code> trong database), sau đó chia lại các đơn đó
                qua /reviews/assign-bulk với tuỳ chọn &ldquo;Bỏ qua hồ sơ đã có reviewer&rdquo; tắt — hoặc chỉ giao
                đơn <Code>status = submitted</Code> (chưa re-assign).
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
                , chọn batch, role = mentee, status = submitted → các đơn test sẽ xuất hiện trong
                phần &ldquo;Hồ sơ sẽ được giao&rdquo;.
              </Callout>
            </div>
          </SectionCard>
        )}
      </div>
    </>
  );
}
