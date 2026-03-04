/**
 * Enrich HireEdge roles with:
 * - skills (core + optional)
 * - salary_uk (band)
 * - career paths (next roles)
 *
 * Input:  data/roles.json
 * Output: data/roles-enriched.json
 */

const fs = require("fs");
const path = require("path");

const INPUT = path.join(process.cwd(), "data", "roles.json");
const OUTPUT = path.join(process.cwd(), "data", "roles-enriched.json");

// --- 1) Skill Library (category -> core skills + optional skills)
const SKILLS = {
  "Data & AI": {
    core: ["SQL", "Excel", "Statistics", "Data Visualization", "Data Storytelling"],
    optional: [
      "Python",
      "R",
      "Power BI",
      "Tableau",
      "Machine Learning",
      "A/B Testing",
      "Data Warehousing",
      "ETL",
      "Snowflake",
      "BigQuery",
    ],
  },
  "Software Engineering": {
    core: ["Git", "APIs", "Testing", "Debugging", "System Design"],
    optional: [
      "JavaScript",
      "TypeScript",
      "React",
      "Node.js",
      "Python",
      "Java",
      "C#",
      "AWS",
      "Docker",
      "Kubernetes",
      "CI/CD",
    ],
  },
  Cybersecurity: {
    core: ["Security Fundamentals", "Risk Assessment", "Incident Response", "Access Control", "Networking"],
    optional: [
      "Pen Testing",
      "SIEM",
      "Threat Intelligence",
      "Cloud Security",
      "IAM",
      "OWASP",
      "Forensics",
      "Compliance (ISO 27001)",
      "SOC Operations",
    ],
  },
  "Product & Project": {
    core: ["Stakeholder Management", "Roadmapping", "Agile", "Requirements Gathering", "Prioritisation"],
    optional: [
      "Scrum",
      "Kanban",
      "Jira",
      "User Research",
      "Product Strategy",
      "OKRs",
      "Delivery Management",
      "Change Management",
      "PRINCE2",
      "SAFe",
    ],
  },
  "Business & Consulting": {
    core: ["Problem Solving", "Business Analysis", "Process Mapping", "Communication", "Presentation"],
    optional: ["RCA", "Lean", "Six Sigma", "Benchmarking", "Market Research", "Financial Modelling", "Strategy", "Operating Models", "Data Analysis"],
  },
  Marketing: {
    core: ["Marketing Strategy", "Campaign Management", "Customer Insights", "Content", "Analytics"],
    optional: ["SEO", "SEM", "Paid Social", "Email Marketing", "CRM", "Lifecycle", "GA4", "Marketing Automation", "A/B Testing", "Brand Management"],
  },
  Sales: {
    core: ["Prospecting", "Discovery", "Negotiation", "Pipeline Management", "Relationship Building"],
    optional: ["CRM (Salesforce/HubSpot)", "Solution Selling", "Account Management", "Territory Planning", "Partnerships", "Revenue Operations", "Forecasting"],
  },
  "HR & People": {
    core: ["Recruitment", "Employee Relations", "HR Operations", "Policy", "Communication"],
    optional: ["Talent Acquisition", "L&D", "Performance Management", "Compensation & Benefits", "HRIS", "Workforce Planning", "DEI", "Change Management"],
  },
  "Finance & Accounting": {
    core: ["Accounting Principles", "Financial Reporting", "Budgeting", "Excel", "Attention to Detail"],
    optional: ["FP&A", "Tax", "Audit", "Treasury", "Risk", "Financial Modelling", "Forecasting", "Payroll", "Compliance"],
  },
  Operations: {
    core: ["Process Improvement", "Planning", "Stakeholder Management", "Quality", "Execution"],
    optional: ["Supply Chain", "Procurement", "Logistics", "Inventory", "Lean", "Health & Safety", "Service Delivery", "Vendor Management", "Capacity Planning"],
  },
  "Design & Creative": {
    core: ["Design Thinking", "Wireframing", "Visual Design", "Prototyping", "Collaboration"],
    optional: ["Figma", "User Research", "Usability Testing", "Interaction Design", "Design Systems", "Branding", "Motion Design", "Accessibility"],
  },
  "Legal & Compliance": {
    core: ["Regulatory Knowledge", "Contract Review", "Risk Management", "Documentation", "Stakeholder Management"],
    optional: ["GDPR", "Corporate Law", "Compliance Audits", "Policy Drafting", "Governance", "Privacy", "Due Diligence"],
  },
  Healthcare: {
    core: ["Healthcare Operations", "Compliance", "Patient Safety", "Documentation", "Communication"],
    optional: ["Clinical Research", "Health Informatics", "Data Analysis", "Public Health", "Medical Devices", "Pharma"],
  },
  Education: {
    core: ["Teaching & Learning", "Curriculum Design", "Assessment", "Communication", "Stakeholder Management"],
    optional: ["Instructional Design", "Learning Tech", "Content Development", "Training Delivery", "Research Methods", "EdTech"],
  },
  "Emerging Tech": {
    core: ["Research", "Systems Thinking", "Problem Solving", "Data Literacy", "Innovation"],
    optional: ["IoT", "Robotics", "Web3", "Smart Contracts", "Quantum", "Digital Twins", "AI/ML", "Edge Computing", "Sustainability/ESG"],
  },
  "Executive Leadership": {
    core: ["Leadership", "Strategy", "Decision Making", "Communication", "Stakeholder Management"],
    optional: ["P&L Ownership", "People Management", "Fundraising", "Go-to-Market", "Operations", "Product Strategy", "Governance", "Scaling"],
  },
  "Customer Operations": {
    core: ["Customer Service", "Communication", "Problem Solving", "CRM Tools", "Process Adherence"],
    optional: ["Quality Assurance", "Escalation Handling", "Root Cause Analysis", "Workforce Management", "Knowledge Base", "CSAT/NPS"],
  },
};

// --- 2) Salary bands (GBP/year) by seniority
const SALARY_BANDS = {
  Entry: { min: 20000, max: 28000 },
  Mid: { min: 28000, max: 45000 },
  Senior: { min: 45000, max: 70000 },
  Lead: { min: 60000, max: 85000 },
  Manager: { min: 55000, max: 85000 },
  Head: { min: 75000, max: 110000 },
  Director: { min: 90000, max: 140000 },
  "C-Level": { min: 120000, max: 220000 },
};

// Optional category multipliers (tech/data often higher)
const CATEGORY_MULTIPLIER = {
  "Data & AI": 1.1,
  "Software Engineering": 1.15,
  Cybersecurity: 1.15,
  "Product & Project": 1.1,
  "Emerging Tech": 1.15,
  "Executive Leadership": 1.2,
};

const SENIORITY_RANK = {
  Entry: 1,
  Mid: 2,
  Senior: 3,
  Lead: 4,
  Manager: 5,
  Head: 6,
  Director: 7,
  "C-Level": 8,
};

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function pickSkills(category, seniority) {
  const lib = SKILLS[category] || { core: [], optional: [] };

  const core = lib.core.slice(0, 6);

  const optionalCount =
    seniority === "Entry" ? 4 :
    seniority === "Mid" ? 6 :
    seniority === "Senior" ? 7 :
    seniority === "Lead" ? 7 :
    seniority === "Manager" ? 6 :
    seniority === "Head" ? 5 :
    seniority === "Director" ? 4 : 4;

  const optional = shuffle([...lib.optional]).slice(0, optionalCount);

  const addOns = [];
  if (["Senior", "Lead", "Manager", "Head", "Director", "C-Level"].includes(seniority)) addOns.push("Stakeholder Management");
  if (["Manager", "Head", "Director", "C-Level"].includes(seniority)) addOns.push("People Management");
  if (["Head", "Director", "C-Level"].includes(seniority)) addOns.push("Strategic Planning");

  return dedupe([...core, ...optional, ...addOns]).slice(0, 12);
}

function salaryFor(category, seniority) {
  const band = SALARY_BANDS[seniority] || SALARY_BANDS["Mid"];
  const mult = CATEGORY_MULTIPLIER[category] || 1.0;

  const min = Math.round((band.min * mult) / 500) * 500;
  const max = Math.round((band.max * mult) / 500) * 500;

  return {
    currency: "GBP",
    period: "year",
    min,
    max,
    note: "Starter estimate band. Replace with live market data later.",
  };
}

function buildCareerPaths(role, allRoles) {
  const sameCat = allRoles.filter((r) => r.category === role.category);
  const myRank = SENIORITY_RANK[role.seniority] || 2;

  const next = sameCat
    .filter((r) => (SENIORITY_RANK[r.seniority] || 2) > myRank)
    .sort((a, b) => (SENIORITY_RANK[a.seniority] || 2) - (SENIORITY_RANK[b.seniority] || 2))
    .slice(0, 5)
    .map((r) => r.slug);

  const previous = sameCat
    .filter((r) => (SENIORITY_RANK[r.seniority] || 2) < myRank)
    .sort((a, b) => (SENIORITY_RANK[b.seniority] || 2) - (SENIORITY_RANK[a.seniority] || 2))
    .slice(0, 3)
    .map((r) => r.slug);

  return { previous_roles: previous, next_roles: next };
}

function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("❌ Missing input file:", INPUT);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT, "utf8");
  const dataset = JSON.parse(raw);

  if (!dataset.roles || !Array.isArray(dataset.roles)) {
    console.error("❌ roles.json must be an object with a 'roles' array.");
    process.exit(1);
  }

  const roles = dataset.roles;

  const enrichedRoles = roles.map((r) => ({
    ...r,
    skills: pickSkills(r.category, r.seniority),
    salary_uk: salaryFor(r.category, r.seniority),
    career_paths: buildCareerPaths(r, roles),
  }));

  const enrichedDataset = {
    ...dataset,
    total_roles: enrichedRoles.length,
    roles: enrichedRoles,
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(enrichedDataset, null, 2), "utf8");
  console.log("✅ Wrote:", OUTPUT, "roles:", enrichedRoles.length);
}

main();
