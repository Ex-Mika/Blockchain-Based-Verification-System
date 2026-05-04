import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const datasetDir = resolve(projectRoot, "datasets", "adult-uci");

const INPUT_FILES = [
  {
    path: resolve(datasetDir, "adult.data"),
    split: "train",
    skipHeader: false
  },
  {
    path: resolve(datasetDir, "adult.test"),
    split: "test",
    skipHeader: true
  }
];

const OUTPUT_FULL = resolve(datasetDir, "adult-credentials-full.json");
const OUTPUT_SAMPLE = resolve(datasetDir, "adult-credentials-sample-2048.json");
const OUTPUT_METADATA = resolve(datasetDir, "README.md");
const REQUESTED_SAMPLE_SIZES = [5, 10, 100, 1000, 2000, 10000];

const EXPECTED_COLUMNS = 15;
const ISSUER_ID = "uci-adult-dataset";
const SYNTHETIC_FIRST_NAMES = [
  "Alex",
  "Ana",
  "Andre",
  "Bianca",
  "Carlo",
  "Clara",
  "Daniel",
  "Diana",
  "Elena",
  "Emilio",
  "Gabriel",
  "Hannah",
  "Isaac",
  "Isabel",
  "Jasmine",
  "Jonas",
  "Kara",
  "Leo",
  "Lina",
  "Marco",
  "Mia",
  "Nico",
  "Paolo",
  "Rafael",
  "Rina",
  "Sofia",
  "Tomas",
  "Vera",
  "Yana",
  "Zion"
];
const SYNTHETIC_LAST_NAMES = [
  "Santos",
  "Reyes",
  "Cruz",
  "Garcia",
  "Mendoza",
  "Rivera",
  "Torres",
  "Ramos",
  "Flores",
  "Castillo",
  "Morales",
  "Navarro",
  "Bautista",
  "Villanueva",
  "Castro",
  "Mercado",
  "Herrera",
  "Ramirez",
  "Dela Cruz",
  "Aguilar",
  "Bennett",
  "Carter",
  "Foster",
  "Hayes",
  "Morgan",
  "Parker",
  "Reed",
  "Taylor",
  "Walker",
  "Young"
];
const SYNTHETIC_MIDDLE_INITIALS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

const rows = [];

for (const inputFile of INPUT_FILES) {
  const rawText = await readFile(inputFile.path, "utf8");
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("|")) {
      continue;
    }

    const values = line.split(",").map((part) => part.trim());
    if (values.length !== EXPECTED_COLUMNS) {
      continue;
    }

    const incomeLabel = values[14].replace(/\.$/, "");
    rows.push({
      split: inputFile.split,
      age: Number(values[0]),
      workclass: values[1],
      fnlwgt: Number(values[2]),
      education: values[3],
      educationNum: Number(values[4]),
      maritalStatus: values[5],
      occupation: values[6],
      relationship: values[7],
      race: values[8],
      sex: values[9],
      capitalGain: Number(values[10]),
      capitalLoss: Number(values[11]),
      hoursPerWeek: Number(values[12]),
      nativeCountry: values[13],
      incomeLabel
    });
  }
}

const credentials = rows.map((row, index) => {
  const sourceKey = [
    row.split,
    index + 1,
    row.age,
    row.workclass,
    row.fnlwgt,
    row.education,
    row.educationNum,
    row.maritalStatus,
    row.occupation,
    row.relationship,
    row.race,
    row.sex,
    row.capitalGain,
    row.capitalLoss,
    row.hoursPerWeek,
    row.nativeCountry,
    row.incomeLabel
  ].join("|");

  const credentialId = `ADULT-${String(index + 1).padStart(6, "0")}`;

  return {
    holderName: buildSyntheticHolderName(index),
    credentialTitle: buildCredentialTitle(row),
    recipient: deterministicAddress(sourceKey),
    credentialId,
    achievementCode: buildAchievementCode(row),
    issueDate: buildIssueDate(index),
    issuerId: ISSUER_ID,
    sourceSplit: row.split,
    sourceSummary: {
      age: row.age,
      education: row.education,
      occupation: row.occupation,
      nativeCountry: row.nativeCountry,
      incomeLabel: row.incomeLabel,
      hoursPerWeek: row.hoursPerWeek
    }
  };
});

await mkdir(datasetDir, { recursive: true });
await writeJson(OUTPUT_FULL, credentials);
await writeJson(OUTPUT_SAMPLE, credentials.slice(0, 2048));
for (const sampleSize of REQUESTED_SAMPLE_SIZES) {
  await writeJson(
    resolve(datasetDir, `adult-credentials-${sampleSize}.json`),
    credentials.slice(0, sampleSize)
  );
}
await writeFile(OUTPUT_METADATA, buildMetadata(credentials.length), "utf8");

console.log(`Generated ${credentials.length} transformed credentials.`);
console.log(`Full dataset: ${OUTPUT_FULL}`);
console.log(`Sample dataset: ${OUTPUT_SAMPLE}`);
for (const sampleSize of REQUESTED_SAMPLE_SIZES) {
  console.log(`Requested sample ${sampleSize}: ${resolve(datasetDir, `adult-credentials-${sampleSize}.json`)}`);
}

function deterministicAddress(sourceKey) {
  const hex = sha256(sourceKey);
  return `0x${hex.slice(0, 40)}`;
}

function buildAchievementCode(row) {
  return [
    "UCI-ADULT",
    sanitizeToken(row.education),
    normalizeIncomeLabel(row.incomeLabel)
  ].join("-");
}

function buildCredentialTitle(row) {
  const educationKey = sanitizeToken(row.education);
  const titleMap = {
    "PRESCHOOL": "Foundational Learning Readiness Credential",
    "1ST-4TH": "Primary Education Completion Credential",
    "5TH-6TH": "Upper Primary Education Credential",
    "7TH-8TH": "Junior Secondary Education Credential",
    "9TH": "Secondary Education Progress Credential",
    "10TH": "Secondary Education Progress Credential",
    "11TH": "Senior Secondary Education Progress Credential",
    "12TH": "Senior Secondary Education Completion Credential",
    "HS-GRAD": "High School Graduate Workforce Credential",
    "SOME-COLLEGE": "College Studies Career Readiness Credential",
    "ASSOC-ACDM": "Associate Academic Achievement Credential",
    "ASSOC-VOC": "Associate Vocational Skills Credential",
    "BACHELORS": "Bachelor-Level Professional Readiness Credential",
    "MASTERS": "Master-Level Professional Achievement Credential",
    "DOCTORATE": "Doctoral-Level Professional Achievement Credential",
    "PROF-SCHOOL": "Professional School Achievement Credential"
  };

  return titleMap[educationKey] || `${formatTitleToken(row.education)} Achievement Credential`;
}

function buildIssueDate(index) {
  const start = new Date(Date.UTC(2025, 0, 1));
  start.setUTCDate(start.getUTCDate() + (index % 365));
  return start.toISOString().slice(0, 10);
}

function sanitizeToken(value) {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeIncomeLabel(value) {
  const trimmed = String(value).trim();

  if (trimmed === "<=50K") {
    return "LTE50K";
  }

  if (trimmed === ">50K") {
    return "GT50K";
  }

  return sanitizeToken(trimmed);
}

function formatTitleToken(value) {
  return String(value)
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}

function buildSyntheticHolderName(index) {
  const firstName = SYNTHETIC_FIRST_NAMES[index % SYNTHETIC_FIRST_NAMES.length];
  const lastName = SYNTHETIC_LAST_NAMES[Math.floor(index / SYNTHETIC_FIRST_NAMES.length) % SYNTHETIC_LAST_NAMES.length];
  const middleInitial = SYNTHETIC_MIDDLE_INITIALS[
    Math.floor(index / (SYNTHETIC_FIRST_NAMES.length * SYNTHETIC_LAST_NAMES.length))
      % SYNTHETIC_MIDDLE_INITIALS.length
  ];

  return `${firstName} ${middleInitial}. ${lastName}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildMetadata(recordCount) {
  return [
    "# UCI Adult Credentials",
    "",
    "Transformed from the public UCI Adult dataset into the frontend's Merkle-tree credential shape.",
    "",
    "Source:",
    "- UCI Adult dataset: https://archive.ics.uci.edu/dataset/2/adult",
    "- License: CC BY 4.0",
    "",
    `Generated record count: ${recordCount}`,
    "",
    "Output files:",
    "- `adult-credentials-full.json`: full transformed dataset",
    "- `adult-credentials-sample-2048.json`: first 2,048 records for easier frontend testing",
    ...REQUESTED_SAMPLE_SIZES.map((sampleSize) => {
      return `- \`adult-credentials-${sampleSize}.json\`: first ${sampleSize.toLocaleString()} transformed records`;
    }),
    "",
    "Credential mapping:",
    "- `holderName`: deterministic synthetic generic name for demo verification",
    "- `credentialTitle`: human-readable credential title derived from education level",
    "- `recipient`: deterministic synthetic Ethereum-style address derived from the source row",
    "- `credentialId`: sequential synthetic identifier",
    "- `achievementCode`: derived from education and income label",
    "- `issueDate`: deterministic synthetic issue date",
    "- `issuerId`: `uci-adult-dataset`"
  ].join("\n");
}
