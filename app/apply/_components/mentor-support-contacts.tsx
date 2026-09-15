import { FormRichText } from "@/components/form-rich-text";
import { DEFAULT_APPLICATION_FORM_TEXTS, type ApplicationFormTexts } from "@/lib/application-form-text-core";

/** Liên hệ hỗ trợ cuối form mentor và form gia hạn mentor. Chữ admin sửa được. */
export function MentorSupportContacts({ texts = DEFAULT_APPLICATION_FORM_TEXTS }: { texts?: ApplicationFormTexts }) {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
      <h2 className="text-base font-semibold text-vam-ink">{texts["mentor.contacts.heading"]}</h2>
      <FormRichText text={texts["mentor.contacts.intro"]} className="mt-1 space-y-2 text-sm text-slate-600" />
      <FormRichText
        text={texts["mentor.contacts.list"]}
        className="mt-3 grid gap-3 text-sm text-slate-700"
        listClassName="grid gap-3"
        itemClassName="rounded-md border border-vam-line bg-slate-50 p-3"
        strongClassName="font-medium text-vam-ink"
      />
    </section>
  );
}
