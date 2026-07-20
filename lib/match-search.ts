export type MentorSearchable = {
  full_name: string | null;
  email_primary: string | null;
  company_current: string | null;
};

export type MenteeSearchable = {
  full_name: string | null;
  email_primary: string | null;
  school_code: string | null;
};

export function normalizeVn(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d");
}

export function matchesMentorSearch(m: MentorSearchable, query: string): boolean {
  const q = normalizeVn(query.trim());
  if (!q) return true;
  return (
    normalizeVn(m.full_name ?? m.email_primary ?? "").includes(q) ||
    normalizeVn(m.company_current ?? "").includes(q)
  );
}

export function matchesMenteeSearch(m: MenteeSearchable, query: string): boolean {
  const q = normalizeVn(query.trim());
  if (!q) return true;
  return (
    normalizeVn(m.full_name ?? m.email_primary ?? "").includes(q) ||
    normalizeVn(m.school_code ?? "").includes(q)
  );
}

export function filterMentors<T extends MentorSearchable>(mentors: T[], query: string): T[] {
  if (!query.trim()) return mentors;
  return mentors.filter((m) => matchesMentorSearch(m, query));
}

export function filterMentees<T extends MenteeSearchable>(mentees: T[], query: string): T[] {
  if (!query.trim()) return mentees;
  return mentees.filter((m) => matchesMenteeSearch(m, query));
}
