// scripts/benchmark-lib.mjs
export function createPRNG(seed) {
  let m = 0x80000000; // 2**31
  let a = 1103515245;
  let c = 12345;
  let state = seed ? seed : Math.floor(Math.random() * (m - 1));
  
  return function() {
    state = (a * state + c) % m;
    return state / (m - 1);
  };
}

const random = createPRNG(123456789);

export function generateS12MenteePayload(i) {
  return {
    "first_name": `Mentee_${i}`,
    "last_name": "Test",
    "email_primary": `test.mentee.${i}@example.com`,
    "phone_primary": `0900${i.toString().padStart(6, '0')}`,
    "mssv": `3120${i.toString().padStart(6, '0')}`,
    "school_raw": "Đại học Kinh tế TP.HCM",
    "major": "Computer Science",
    "class_cohort": "K46",
    "gpa_4": (2.5 + random() * 1.5).toFixed(2),
    "topics_top3": ["Tech", "Startup", "Finance"].sort(() => random() - 0.5).slice(0, 2),
    "goal_main": "I want to become a software engineer.",
    "challenges_text": "I lack practical experience.",
    "why_uehm": "To learn from experienced alumni.",
    "plan_in_season": "Participate actively and finish side projects.",
    "knowledge_about_uehm": "Through social media.",
    "commitments": ["yes"],
    "consent_data_storage": "yes"
  };
}
