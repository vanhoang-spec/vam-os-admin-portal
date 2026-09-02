const MENTEE_SUPPORT_CONTACTS = Object.freeze([
  {
    name: "Trần Mỹ Anh",
    role: "Support Team UEH Mentoring",
    phone: "0394983679"
  },
  {
    name: "Bùi Trần Hoàng Vy",
    role: "Support Team UEH Mentoring",
    phone: "0936359670"
  }
]);

export function MenteeSupportContacts() {
  return (
    <section className="rounded-lg border border-vam-line bg-white p-5 shadow-soft sm:p-6">
      <h2 className="text-base font-semibold text-vam-ink">Liên hệ hỗ trợ</h2>
      <p className="mt-1 text-sm text-slate-600">
        Nếu cần hỗ trợ khi điền hoặc gửi thông tin, bạn vui lòng liên hệ:
      </p>
      <ul className="mt-3 grid gap-3 text-sm text-slate-700">
        {MENTEE_SUPPORT_CONTACTS.map((contact) => (
          <li key={contact.name} className="rounded-md border border-vam-line bg-slate-50 p-3">
            <span className="font-medium text-vam-ink">{contact.name}</span> — {contact.role}
            <span>
              {" — "}
              <a
                className="text-vam-green underline"
                href={`tel:${contact.phone.replace(/\\D/g, "")}`}
              >
                {contact.phone}
              </a>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
