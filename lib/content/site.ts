export type NewsItem = {
  slug: string;
  title: string;
  date: string;
  category: string;
  excerpt: string;
};

export const news: NewsItem[] = [
  {
    slug: "in-memoriam-jacques-van-daele",
    title: "In Memoriam — Jacques Van Daele, 1953–2026",
    date: "March 2026",
    category: "IDOC News",
    excerpt:
      "A tribute from the International Dressage Officials Club. It is with deep sadness that we share the news of the passing of our dear colleague, Jacques van Daele, a man of many roles in the equestrian world.",
  },
  {
    slug: "in-memoriam-stephen-clarke",
    title: "In Memoriam — Stephen Clarke, 1952–2026",
    date: "February 2026",
    category: "IDOC News",
    excerpt:
      "With profound sadness, and an equally profound sense of gratitude, we share the news of the passing of our dear friend, colleague and former IDOC President, Stephen Clarke.",
  },
  {
    slug: "fei-judging-guidelines",
    title:
      "How to apply the FEI judging guidelines on tension, submission, contact and harmony",
    date: "January 2026",
    category: "Education",
    excerpt:
      "The FEI Dressage Judging Manual is explicit: quality of gaits and technical execution must be evaluated together with harmony. In our current climate, how we apply these guidelines is more than technical accuracy — it is the sport's credibility.",
  },
  {
    slug: "fei-rules-revision",
    title: "FEI Rules Revision",
    date: "December 2025",
    category: "Rules",
    excerpt:
      "The Periodical Rules Revision Policy, approved by the FEI Board in Lausanne (SUI) and endorsed by the General Assembly, sets the cycle for dressage rule updates.",
  },
];

export type BlogPost = {
  slug: string;
  title: string;
  author: string;
  date: string;
  excerpt: string;
};

export const blogPosts: BlogPost[] = [
  {
    slug: "modern-dressage-judging",
    title: "Modern Dressage Judging: Perception, Data, and the Evolving Role of Welfare",
    author: "Hans Christian Matthiesen",
    date: "March 2026",
    excerpt:
      "Recent public discussions have raised questions regarding judging standards and score distribution in international dressage. This article combines professional reflection with quantitative data analysis to examine whether perceived changes in scoring reflect actual trends.",
  },
  {
    slug: "stress-in-dressage-horses",
    title: "New Research on Stress in Dressage Horses",
    author: "Hans Christian Matthiesen",
    date: "February 2026",
    excerpt:
      "A study published in Animals investigated stress-related behaviours in 238 dressage horse–rider combinations, using objective measures and video analysis to quantify conflict behaviours such as mouth opening and tail swishing.",
  },
  {
    slug: "integrity-beyond-compliance",
    title: "Integrity Beyond Compliance",
    author: "Hans Christian Matthiesen",
    date: "January 2026",
    excerpt:
      "Code of Conduct and Conflict of Interest in FEI dressage judging — why the letter of the rule is only the beginning of an official's responsibility.",
  },
];

export type Seminar = {
  title: string;
  location: string;
  date: string;
  audience: string;
};

export const seminars: Seminar[] = [
  {
    title: "Para Dressage Transfer Up Course for L2 Judges",
    location: "Hartpury, Great Britain",
    date: "27–28 June 2026",
    audience: "Judges",
  },
  {
    title: "Para Dressage Transfer Up Course for L3 Judges",
    location: "Hartpury, Great Britain",
    date: "27–28 June 2026",
    audience: "Judges",
  },
  {
    title: "Dressage Judge Maintenance Course",
    location: "Falsterbo, Sweden",
    date: "10 July 2026",
    audience: "Judges",
  },
  {
    title: "Young Horse Seminar, Verden — Save the Date",
    location: "Verden, Germany",
    date: "6–8 August 2026",
    audience: "Judges & Stewards",
  },
];

export type BoardMember = {
  name: string;
  country: string;
  role: string;
  detail: string[];
  photo: string;
  fb: string | null;
};

export const boardMembers: BoardMember[] = [
  {
    name: "Hans-Christian Matthiesen",
    country: "DEN",
    role: "IDOC President",
    detail: ["Dressage Judge FEI 5* / L4", "Course Director — Judge"],
    photo: "/board/hans.jpeg",
    fb: "https://www.facebook.com/hanschristian.matthiesen",
  },
  {
    name: "Janet Foy",
    country: "USA",
    role: "1st Vice-President",
    detail: ["Dressage Judge FEI 5* / L4", "FEI TD"],
    photo: "/board/janet.jpeg",
    fb: "https://www.facebook.com/janet.foy.14",
  },
  {
    name: "Sunil Shivdas",
    country: "IND",
    role: "2nd Vice-President",
    detail: ["Asian representative", "Dressage Judge FEI 4* / L3"],
    photo: "/board/sunil.jpeg",
    fb: "https://www.facebook.com/profile.php?id=100017773665966",
  },
  {
    name: "Alexandre Lacerda Leao",
    country: "BRA",
    role: "Secretary",
    detail: ["Dressage Judge FEI 4* / L3"],
    photo: "/board/alexandre.jpeg",
    fb: "https://www.facebook.com/alexandre.leao",
  },
  {
    name: "Raphäel Saleh",
    country: "FRA",
    role: "Western Europe & Africa representative",
    detail: ["Dressage Judge FEI 5* / L4"],
    photo: "/board/raphael.jpeg",
    fb: "https://www.facebook.com/raphael.saleh",
  },
  {
    name: "Omar Zayrik",
    country: "MEX",
    role: "Latin & South America representative",
    detail: ["Dressage Judge FEI 3* / L2"],
    photo: "/board/omar.jpeg",
    fb: "https://www.facebook.com/ozayrik",
  },
  {
    name: "Orsolya Hillier",
    country: "HUN",
    role: "Eastern & Central Europe representative",
    detail: ["Dressage Judge FEI 4* / L3"],
    photo: "/board/orsolya.jpeg",
    fb: "https://www.facebook.com/orsolya.hillier",
  },
  {
    name: "Susan Hoevenaars",
    country: "AUS",
    role: "Australia & Pacific region representative",
    detail: ["Dressage Judge FEI 5* / L4"],
    photo: "/board/susan.png",
    fb: "https://www.facebook.com/susan.hoevenaars.7",
  },
  {
    name: "Luc Verbocht",
    country: "BEL",
    role: "Treasurer",
    detail: [],
    photo: "/board/luc.jpeg",
    fb: "https://www.facebook.com/profile.php?id=100018976443615",
  },
  {
    name: "Katarzyna Widalska",
    country: "POL",
    role: "Steward",
    detail: ["Steward representative", "FEI Dressage Steward Level 3"],
    photo: "/board/katarzyna.jpeg",
    fb: "https://www.facebook.com/kasia.basia.7",
  },
  {
    name: "Lisa Gorretta",
    country: "USA",
    role: "Steward",
    detail: ["Steward representative", "FEI Dressage Steward Level 4"],
    photo: "/board/lisa.jpg",
    fb: "https://www.facebook.com/lisa.gorretta/photos",
  },
  {
    name: "Marco Orsini",
    country: "GER",
    role: "Para Dressage representative",
    detail: ["FEI Para Dressage Judge Level 4"],
    photo: "/board/marco.jpeg",
    fb: null,
  },
];

export type GeneralAssemblyEdition = {
  place: string;
  dates: string;
  note?: string;
  docs: { label: string; href?: string }[];
};

export const generalAssemblyEditions: GeneralAssemblyEdition[] = [
  {
    place: "Frankfurt",
    dates: "December 18–20, 2025",
    docs: [
      {
        label: "IDOC General Assembly — Agenda",
        href: "https://idoc.club/wp-content/uploads/sites/58/2025/09/2025-IDOC-General-Assembly-FEI-Maintenance-Course-Frankfurt-Preliminary-Program_v2.pdf",
      },
    ],
  },
  {
    place: "Frankfurt",
    dates: "December 15–17, 2023",
    docs: [
      {
        label: "IDOC General Assembly — Final Program",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/11/General_Assembly_Final_Program_IDOC_2003.pdf",
      },
    ],
  },
  {
    place: "Frankfurt",
    dates: "December 16–18, 2022",
    docs: [
      {
        label: "IDOC General Assembly — Final Program",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/01/IDOC-General-Assembly-Final-Program-1.pdf",
      },
      {
        label: "IDOC — President's end of the year message",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/02/IDOC_2022.pdf",
      },
    ],
  },
  {
    place: "Frankfurt",
    dates: "December 2019",
    docs: [
      {
        label: "IDOC General Assembly — Final Program Judges",
        href: "https://idoc.club/wp-content/uploads/sites/58/2018/12/IDOC-General-Assembly-Final-Program-Judges.pdf",
      },
      {
        label: "Annual report, Frankfurt, December 2019, General Assembly",
        href: "https://idoc.club/wp-content/uploads/sites/58/2019/12/IDOC.pdf",
      },
    ],
  },
  {
    place: "Frankfurt",
    dates: "December 14–16, 2018",
    docs: [
      {
        label: "IDOC General Assembly — Final Program Judges",
        href: "https://idoc.club/wp-content/uploads/sites/58/2018/12/IDOC-General-Assembly-Final-Program-Judges.pdf",
      },
      {
        label: "IDOC General Assembly — Final Program Stewards",
        href: "https://idoc.club/wp-content/uploads/sites/58/2018/12/IDOC-General-Assembly-Final-Program-Stewards_updated.pdf",
      },
      { label: "Proxy form" },
    ],
  },
  {
    place: "Geneva",
    dates: "December 8–9, 2017",
    note: "The 2017 General Assembly took place in Geneva on December 8 and 9, 2017. This General Assembly was different from the others: there was no Refresher Seminar, as members had ample opportunity to participate in one of the five seminars (Amsterdam, Aachen, Gothenburg, Stuttgart, London) held during the year.",
    docs: [
      {
        label: "IDOC General Assembly — Final Programme",
        href: "https://idoc.club/wp-content/uploads/sites/58/2017/12/IDOC-General-Assembly-Final-Programme-2017-12-04.pdf",
      },
      { label: "Proxy form" },
    ],
  },
  {
    place: "Amsterdam",
    dates: "January 26–28, 2017",
    docs: [
      {
        label: "2016 IDOC Schedule",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/01/2016-IDOC-SCHEDULE-2.pdf",
      },
      {
        label: "GA Agenda and meeting documents",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/01/GA-Agenda-and-meeting-documents-2.pdf",
      },
    ],
  },
  {
    place: "West Palm Beach",
    dates: "February 9–16, 2016",
    docs: [
      {
        label: "2016 IDOC Schedule",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/01/2016-IDOC-SCHEDULE-2.pdf",
      },
      {
        label: "GA Agenda and meeting documents",
        href: "https://idoc.club/wp-content/uploads/sites/58/2023/01/GA-Agenda-and-meeting-documents-2.pdf",
      },
    ],
  },
];

export const aboutGoals: string[] = [
  "Promotion of the principles of horsemanship, more particularly of the schooling according to the basic rules of classic equitation.",
  "Maintenance of an independent position of the dressage judges as well as an impartial exercise of the judgment activities.",
  "Cooperation with international equestrian associations and other associations in matters which pertain to the judgment of dressage training.",
  "Implementation and testing of proposals concerning the refinement of requirements, assessments and judgment procedures as regards dressage tests.",
  "Further education of judges and education of candidate judges, organization of meetings and seminars for judges.",
  "Dissemination of information with regard to questions of judgment and dressage tests.",
  "Defending the interests of members.",
];

export const aboutDocuments: { label: string; href: string }[] = [
  {
    label: "Statutes 2022 — Approved by the General Assembly",
    href: "https://idoc.club/wp-content/uploads/sites/58/2024/07/Statutes-2022-approved-by-the-General-Assembly.pdf",
  },
  {
    label: "2010 Statuten — Staatsblad 01.07.10",
    href: "https://idoc.club/wp-content/uploads/sites/58/2017/03/2010.Statuten-staatsblad.01.07.10.pdf",
  },
  {
    label: "Internal Regulations (2010-10-6)",
    href: "https://idoc.club/wp-content/uploads/sites/58/2017/03/2010-10-6-Internal-Regulations.pdf",
  },
];

export const aboutHonoraryMembers: string[] = [
  "Wolfang Nigli (SWI)",
  "Eric Lette (SWE)",
  "Joachim Bösche, Dr (GER)",
  "Heinz Schütte, Dr (GER)",
  "Maria Güinther",
  "Linda Zang (USA)",
];

export const aboutMilestones: { date: string; text: string }[] = [
  {
    date: "November 16–19, 2009",
    text: "The FEI releases the report from the General Assembly in Copenhagen, summarising the main decisions taken.",
  },
  {
    date: "November 18, 2009",
    text: "The IDJC General Assembly, organised during the German Masters in Stuttgart, changes the name of the club to IDOC.",
  },
  {
    date: "January 15, 2010",
    text: "The FEI officially recognises IDOC as a full Associate Member.",
  },
  {
    date: "December 1, 2019",
    text: "IDOC releases a press statement regarding abusive treatment of horses during the warm-up phase at FEI competitions.",
  },
];

export const membersDirectoryPlaceholder: { name: string; country: string; role: string; level: string }[] = [
  { name: "Anna Bergström", country: "SWE", role: "Judge", level: "FEI 4* / L3" },
  { name: "Carlos Medina", country: "ESP", role: "Judge", level: "FEI 3* / L2" },
  { name: "Danielle Roux", country: "FRA", role: "Steward", level: "Steward Level 3" },
  { name: "Elena Rossi", country: "ITA", role: "Judge", level: "FEI 5* / L4" },
  { name: "Fiona Walsh", country: "IRL", role: "Veterinarian", level: "FEI Vet" },
  { name: "Gerd Lindqvist", country: "FIN", role: "Judge", level: "FEI 4* / L3" },
  { name: "Hiroshi Tanaka", country: "JPN", role: "Steward", level: "Steward Level 2" },
  { name: "Isabel Duarte", country: "POR", role: "Judge", level: "FEI 3* / L2" },
  { name: "Johan de Vries", country: "NED", role: "Judge", level: "FEI 5* / L4" },
  { name: "Karin Schuster", country: "AUT", role: "Veterinarian", level: "FEI Vet" },
  { name: "Liam O'Connor", country: "CAN", role: "Steward", level: "Steward Level 4" },
  { name: "Mariana Silva", country: "BRA", role: "Judge", level: "FEI 4* / L3" },
];
