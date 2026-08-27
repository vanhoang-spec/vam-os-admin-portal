import { MENTOR_SUPPORT_CONTACTS } from "@/lib/mentor-intake-content";

export function MentorSupportContacts() {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
      <h2 className="text-base font-semibold text-vam-ink">Liên hệ hỗ trợ</h2>
      <p className="mt-1 text-sm text-slate-600">Nếu cần hỗ trợ khi điền hoặc gửi thông tin, anh/chị vui lòng liên hệ:</p>
      <ul className="mt-3 grid gap-3 text-sm text-slate-700">
        {MENTOR_SUPPORT_CONTACTS.map((contact) => (
          <li key={contact.name} className="rounded-md border border-vam-line bg-slate-50 p-3">
            <span className="font-medium text-vam-ink">{contact.name}</span> — {contact.role}
            {contact.phone ? <span> — <a className="text-vam-green underline" href={`tel:${contact.phone.replace(/\D/g, "")}`}>{contact.phone}</a></span> : null}
            {contact.email ? <span> — <a className="text-vam-green underline" href={`mailto:${contact.email}`}>{contact.email}</a></span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
