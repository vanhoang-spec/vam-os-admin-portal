import { MembershipLifecycleControls } from "@/app/people/[id]/membership-lifecycle-controls";
import { AccountImportClient } from "@/app/admin/users/import/import-client";
import { SubmitButton } from "@/components/submit-button";
import { createCrmNoteFormAction } from "@/lib/lifecycle-crm";

import { notFound } from "next/navigation";

export default function E2eHarnessPage() {
  if (process.env.VAM_OS_E2E_HARNESS !== "1") {
    return notFound();
  }
  return (
    <main className="p-8">
      <h1>E2E Test Harness</h1>
      <div id="lifecycle-harness">
        <MembershipLifecycleControls
          personId="00000000-0000-0000-0000-000000000000"
          memberships={[
            {
              id: "11111111-1111-1111-1111-111111111111",
              role: "mentor",
              status: "active",
              intakeBatchCode: "B1",
              programLabel: "Program 1",
              seasonLabel: "Season 1"
            },
            {
              id: "22222222-2222-2222-2222-222222222222",
              role: "mentee",
              status: "paused",
              intakeBatchCode: "B1",
              programLabel: "Program 1",
              seasonLabel: "Season 1"
            }
          ]}
          programs={[{ id: "10000000-0000-0000-0000-000000000000", label: "P1" }]}
          seasons={[{ id: "20000000-0000-0000-0000-000000000000", label: "S1" }]}
          enabled={true}
        />
      </div>
      <div id="crm-harness" className="mt-8">
        <form action={createCrmNoteFormAction} className="grid gap-3 rounded-md border border-vam-line bg-slate-50 p-3">
          <input type="hidden" name="person_id" value="00000000-0000-0000-0000-000000000000" />
          <textarea name="content" required rows={3} className="w-full" defaultValue="Test note" />
          <SubmitButton aria-label="Thêm ghi chú CRM" pendingText="Đang lưu..." className="w-fit bg-vam-green text-white">
            Thêm ghi chú CRM
          </SubmitButton>
        </form>
      </div>
      <div id="import-harness" className="mt-8">
        <AccountImportClient />
      </div>
    </main>
  );
}
