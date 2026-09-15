/**
 * Informational header for the S12 mentor application form.
 *
 * Content only. This component renders no inputs and cannot affect eligibility
 * validation or submission behaviour. Every word comes from `texts` — the copy
 * admins edit at /admin/seasons-forms/form-texts, falling back to the approved
 * defaults in lib/application-form-text-core.ts. Emphasis (**…**) highlights the
 * numbers an applicant scans for.
 *
 * Layout follows the existing FormSection shell (same card, border, radius and
 * shadow) so it sits in the form's `grid gap-6` stack like any other section.
 * The two requirement lists sit side by side from `sm` upward and stack on
 * mobile.
 */

import { FormRichText } from "@/components/form-rich-text";
import { DEFAULT_APPLICATION_FORM_TEXTS, type ApplicationFormTexts } from "@/lib/application-form-text-core";

const STEP_KEYS = [
  ["mentor.process.step1_title", "mentor.process.step1_body", "mentor.process.step1_note"],
  ["mentor.process.step2_title", "mentor.process.step2_body", "mentor.process.step2_note"],
  ["mentor.process.step3_title", "mentor.process.step3_body", "mentor.process.step3_note"]
] as const;

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-vam-green">{children}</h3>
  );
}

const LIST_CLASS = "mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-600";

export function MentorProfileIntro({
  texts = DEFAULT_APPLICATION_FORM_TEXTS,
  includeApplicationProcess = true
}: {
  texts?: ApplicationFormTexts;
  includeApplicationProcess?: boolean;
}) {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
      <h2 className="text-base font-semibold text-vam-ink sm:text-lg">{texts["mentor.profile.heading"]}</h2>

      {/* Tinh thần tham gia */}
      <FormRichText text={texts["mentor.profile.spirit"]} className="mt-3 space-y-3 text-sm leading-6 text-slate-600" />

      {/* Năng lực kỳ vọng + Cam kết */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <SubHeading>{texts["mentor.profile.competencies_heading"]}</SubHeading>
          <FormRichText
            text={texts["mentor.profile.competencies"]}
            className="text-sm leading-6 text-slate-600"
            listClassName={LIST_CLASS}
            paragraphClassName="mt-2"
          />
        </div>

        <div className="rounded-md border border-vam-line bg-slate-50 p-4">
          <SubHeading>{texts["mentor.profile.commitments_heading"]}</SubHeading>
          <FormRichText
            text={texts["mentor.profile.commitments"]}
            className="text-sm leading-6 text-slate-600"
            listClassName={LIST_CLASS}
            paragraphClassName="mt-2"
          />
        </div>
      </div>

      {/* Quy trình trở thành Mentor chính thức */}
      {includeApplicationProcess ? (
        <div className="mt-5">
          <SubHeading>{texts["mentor.process.heading"]}</SubHeading>
          <FormRichText text={texts["mentor.process.intro"]} className="mt-2 space-y-2 text-sm leading-6 text-slate-600" />

          <ol className="mt-3 grid gap-3">
            {STEP_KEYS.map(([titleKey, bodyKey, noteKey], index) => (
              <li key={titleKey} className="flex gap-3 rounded-md border border-vam-line bg-white p-3">
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-vam-mint text-xs font-semibold text-vam-green"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-vam-ink">{texts[titleKey]}</p>
                  <FormRichText text={texts[bodyKey]} className="mt-1 space-y-2 text-sm leading-6 text-slate-600" />
                  {texts[noteKey] ? (
                    <FormRichText
                      text={texts[noteKey]}
                      className="mt-2 space-y-1 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900"
                      strongClassName="font-semibold"
                      listClassName="list-disc space-y-1 pl-4"
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {/* Closing */}
      {includeApplicationProcess && texts["mentor.process.closing"] ? (
        <FormRichText
          text={texts["mentor.process.closing"]}
          className="mt-4 space-y-2 border-t border-vam-line pt-4 text-sm leading-6 text-slate-600"
        />
      ) : null}
    </section>
  );
}
