import crypto from "crypto";

export function createPRNG(seed: number) {
  let m = 0x80000000;
  let a = 1103515245;
  let c = 12345;
  let state = seed ? seed : Math.floor(Math.random() * (m - 1));
  
  return function() {
    state = (a * state + c) % m;
    return state / (m - 1);
  };
}

export function generateS12MenteePayload(i: number, random: () => number) {
  return {
    first_name: `Mentee_${i}`,
    last_name: "Test",
    email_primary: `test.mentee.${i}@example.com`,
    phone_primary: `0900${i.toString().padStart(6, '0')}`,
    mssv: `3120${i.toString().padStart(6, '0')}`,
    school_raw: "Đại học Kinh tế TP.HCM",
    major: "Computer Science",
    class_cohort: "K46",
    gpa_4: (2.5 + random() * 1.5).toFixed(2),
    topics_top3: ["Tech", "Startup", "Finance"].sort(() => random() - 0.5).slice(0, 2),
    goal_main: "I want to become a software engineer.",
    challenges_text: "I lack practical experience.",
    why_uehm: "To learn from experienced alumni.",
    plan_in_season: "Participate actively and finish side projects.",
    knowledge_about_uehm: "Through social media.",
    commitments: ["yes"],
    consent_data_storage: "yes"
  };
}

export function generateBenchmarkDataset(seed = 123456789) {
  const random = createPRNG(seed);
  
  const season = { id: `season-1`, code: 'UEHM-S12', name: 'UEH Mentoring Season 12' };
  const program = { id: `prog-1`, code: 'MENTORING', name: 'Mentoring' };
  const batches = [
    { id: `batch-1`, season_id: season.id, code: 'INTAKE-1', name: 'Intake 1' },
    { id: `batch-2`, season_id: season.id, code: 'INTAKE-2', name: 'Intake 2' }
  ];

  const people: any[] = [];
  const mentee_profiles: any[] = [];
  const mentor_profiles: any[] = [];
  const applications: any[] = [];
  const matches: any[] = [];
  const application_answers: any[] = [];
  const admin_users: any[] = [];
  const mentoring_recaps: any[] = [];
  const event_participations: any[] = [];
  const person_season_memberships: any[] = [];
  const application_list_v1: any[] = [];
  const application_facets_v1: any[] = [];

  // 30 admin users
  for (let i = 0; i < 30; i++) {
    admin_users.push({
      id: `admin-${i}`,
      email: `admin${i}@example.com`,
      role: 'admin',
      status: 'active'
    });
  }

  // 1500 people
  for (let i = 0; i < 1500; i++) {
    people.push({
      id: `person-${i}`,
      full_name: `Person ${i}`,
      email_primary: `person${i}@example.com`
    });
  }

  // 1200 mentee profiles
  for (let i = 0; i < 1200; i++) {
    mentee_profiles.push({
      id: `mentee-prof-${i}`,
      person_id: `person-${i}`
    });
    person_season_memberships.push({
      id: `psm-mentee-${i}`,
      person_id: `person-${i}`,
      season_id: season.id,
      role: 'mentee'
    });
  }

  // 200 mentor profiles
  for (let i = 1200; i < 1400; i++) {
    mentor_profiles.push({
      id: `mentor-prof-${i}`,
      person_id: `person-${i}`
    });
    person_season_memberships.push({
      id: `psm-mentor-${i}`,
      person_id: `person-${i}`,
      season_id: season.id,
      role: 'mentor'
    });
  }

  // 400 matches
  for (let i = 0; i < 400; i++) {
    const menteeId = `person-${Math.floor(random() * 1200)}`;
    const mentorId = `person-${1200 + Math.floor(random() * 200)}`;
    matches.push({
      id: `match-${i}`,
      season_id: season.id,
      intake_batch_id: batches[0].id,
      mentee_person_id: menteeId,
      mentor_person_id: mentorId,
      status: 'active'
    });
    
    // add some recaps
    mentoring_recaps.push({
      id: `recap-${i}`,
      match_id: `match-${i}`,
      mentor_person_id: mentorId,
      mentee_person_id: menteeId,
      season_id: season.id
    });
  }

  // 1500 applications: 1200 with person_id, 300 without
  for (let i = 0; i < 1500; i++) {
    const hasPersonId = i < 1200;
    const personId = hasPersonId ? `person-${i}` : null;
    const payload = generateS12MenteePayload(i, random);
    
    applications.push({
      id: `app-${i}`,
      season_id: season.id,
      intake_batch_id: batches[Math.floor(random() * batches.length)].id,
      person_id: personId,
      role_applied: 'mentee',
      status: 'submitted',
      raw_payload: payload
    });

    for (let j = 0; j < 20; j++) {
      application_answers.push({
        id: `answer-${i}-${j}`,
        application_id: `app-${i}`,
        question_id: `q-${j}`,
        answer_text: `Answer ${j} for application ${i}`
      });
    }

    application_list_v1.push({
      id: `app-${i}`,
      person_id: personId,
      season_id: season.id,
      intake_batch_id: applications[i].intake_batch_id,
      role_applied: 'mentee',
      sbd: payload.mssv,
      source: null,
      acquisition_channel: (payload as any).acquisition_channel || null,
      submitted_at: '2026-01-01T00:00:00Z',
      status_unified: 'submitted',
      consent_unified: 'yes',
      full_name: hasPersonId ? people[i].full_name : `${payload.first_name} ${payload.last_name}`,
      email_primary: hasPersonId ? people[i].email_primary : payload.email_primary,
      season_code: season.code,
      intake_batch_code: batches.find(b => b.id === applications[i].intake_batch_id)?.code,
      search_blob: `app-${i} ${payload.mssv} ${hasPersonId ? people[i].full_name : `${payload.first_name} ${payload.last_name}`} ${hasPersonId ? people[i].email_primary : payload.email_primary}`.toLowerCase(),
      batch_season_id: applications[i].intake_batch_id || season.id
    });
  }

  // Precompute unique facets
  const uniqueFacets = new Set<string>();
  application_list_v1.forEach(a => {
    const key = `${a.season_id}|${a.intake_batch_id}|${a.role_applied}|${a.status_unified}|${a.consent_unified}|${a.batch_season_id}`;
    if (!uniqueFacets.has(key)) {
      uniqueFacets.add(key);
      application_facets_v1.push({
        season_id: a.season_id,
        intake_batch_id: a.intake_batch_id,
        role_applied: a.role_applied,
        status_unified: a.status_unified,
        consent_unified: a.consent_unified,
        batch_season_id: a.batch_season_id
      });
    }
  });

  for (let i = 0; i < 500; i++) {
    event_participations.push({
      id: `ep-${i}`,
      season_id: season.id,
      person_id: `person-${Math.floor(random() * 1500)}`,
      event_id: `event-1`
    });
  }

  const dataset = {
    seasons: [season],
    programs: [program],
    intake_batches: batches,
    people,
    mentee_profiles,
    mentor_profiles,
    applications,
    matches,
    application_answers,
    admin_users,
    mentoring_recaps,
    event_participations,
    person_season_memberships,
    application_list_v1,
    application_facets_v1
  };

  const checksum = crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex');

  return { dataset, checksum };
}
