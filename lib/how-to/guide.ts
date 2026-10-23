// Single source of truth for the "How to Use idoc.club" guide. The My IDOC page and the first-sign-in welcome email
// (lib/notifications/legacy-welcome-email.ts) both render from this list, so the wording and links cannot drift apart.

export const HOW_TO_PATH = '/dashboard/how-to-use';

export const HOW_TO_SECTION_IDS = ['directory', 'contact', 'seminars', 'my-seminars'] as const;
export type HowToSectionId = (typeof HOW_TO_SECTION_IDS)[number];

const CLOUDINARY_CLOUD_NAME = 'z6xv27qx';
/** Cloudinary folder holding the recordings; `scripts/how-to-videos/upload.mjs` uploads each as `<folder>/<section id>`. */
export const HOW_TO_VIDEO_FOLDER = 'idoc/how-to';

/** Cloudinary delivery URL for a section's recording (format and quality chosen per viewer). */
export function howToVideoUrl(id: HowToSectionId): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/f_auto,q_auto/${HOW_TO_VIDEO_FOLDER}/${id}`;
}

/** Still frame from the recording, used as the player poster and the email thumbnail. */
export function howToVideoPosterUrl(id: HowToSectionId): string {
  return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_2,f_jpg,q_auto,w_1280/${HOW_TO_VIDEO_FOLDER}/${id}.jpg`;
}

export type HowToSection = {
  /** Where the feature lives on the site. */
  featureHref: string;
  featureLabel: string;
  id: HowToSectionId;
  /** Short paragraphs shown in the email and at the top of the page section. */
  summary: string[];
  /** Step-by-step list shown on the How to Use page only. */
  steps: string[];
  title: string;
  /**
   * Recording to play: `howToVideoUrl(id)` for a Cloudinary upload, or a same-origin file under /public. The
   * content security policy allows media only from this site and res.cloudinary.com. `null` shows a
   * "video coming soon" panel until the recording is published.
   */
  videoSrc: string | null;
};

export const HOW_TO_SECTIONS: readonly HowToSection[] = [
  {
    id: 'directory',
    title: 'Members Directory',
    featureHref: '/about/members-directory',
    featureLabel: 'Open the Members Directory',
    summary: [
      'Find colleagues around the world. The Map tab shows where IDOC members are concentrated; click a country to jump straight to its members.',
      'The Search Directory tab is a table you can search, filter by Member Type, Region or National Federation, and sort by any column. Your search, filters and sort are remembered for your next visit.',
    ],
    steps: [
      'Open Members Directory from the About IDOC menu.',
      'On the Map tab, hover over or click a country to see how many members it has, then open the members of that country in the directory.',
      'Switch to the Search Directory tab. Type a name in the search box to find a member.',
      'Use the Member Type, Region and National Federation filters to narrow the list.',
      'Click a column heading to sort. Use the page controls under the table to move through results.',
      'Click an email address to write to a member.',
    ],
    videoSrc: null,
  },
  {
    id: 'contact',
    title: 'Contact and the support inbox',
    featureHref: '/contact',
    featureLabel: 'Open Contact',
    summary: [
      'When you are signed in, Contact is your private support inbox with the IDOC team. Start a conversation, follow replies, and reply in the same thread.',
      'Choose the category that fits your question so it reaches the right person: Billing/Membership, Seminars/Courses, Technical Support, Make a suggestion, or Other.',
    ],
    steps: [
      'Open Contact from the main menu.',
      'Choose a category: Billing/Membership, Seminars/Courses, Technical Support, Make a suggestion, or Other.',
      'Write a short subject and your message, then select Start conversation.',
      'Your conversation appears under Your conversations with a status: Open, Responded to by admin, Member Replied, or Closed/Resolved. A "New reply" label tells you when the team has answered.',
      'Open a conversation to read the reply and respond in the same thread.',
    ],
    videoSrc: null,
  },
  {
    id: 'seminars',
    title: 'Seminars/Courses and how to register',
    featureHref: '/seminars',
    featureLabel: 'Open Seminars/Courses',
    summary: [
      'Browse upcoming IDOC and FEI seminars and courses. You must be signed in with an active membership to register, so sign in first if you are not already.',
      'FEI courses have an extra step. Your registration is not complete until FEI approves your participation, which happens after your National Federation registers you with FEI. FEI may approve you to audit the course only, meaning you attend as an auditor rather than as a full participant.',
    ],
    steps: [
      'Sign in to idoc.club (registration is not available when you are signed out), then open Seminars/Courses.',
      'On Available Seminars/Courses, select a seminar to read its details: dates, venue, language, levels, price and registration deadline.',
      'Select Register and follow the steps, including payment where one applies.',
      'For an FEI course, also make sure your National Federation registers you with FEI. Your Registration Status stays "Pending FEI Approval" until FEI decides.',
      'You are emailed whenever your registration status changes. FEI may approve you ("Approved by FEI"), approve you to audit only ("Approved to Audit Only by FEI"), or not approve you ("Not Approved by FEI").',
    ],
    videoSrc: null,
  },
  {
    id: 'my-seminars',
    title: 'The tabs on the Seminars page, especially My Seminars/Courses',
    featureHref: '/seminars?view=my',
    featureLabel: 'Open My Seminars/Courses',
    summary: [
      'The Seminars/Courses page has three tabs. Available Seminars/Courses lists what you can register for now. Past Seminars/Courses is the archive of completed courses. My Seminars/Courses is your own registration history and appears only when you are signed in.',
      'Inside My Seminars/Courses, "Upcoming & current" shows registrations you can still act on, and "Past" shows courses you have already attended. Each registration shows its Registration Status and Payment status, such as "Pending FEI Approval / Paid", and upcoming registrations have a Cancel registration button.',
    ],
    steps: [
      'Open Seminars/Courses and select the My Seminars/Courses tab (you will only see it when signed in).',
      'Upcoming & current: check the Registration Status and Payment status for each course. For FEI courses, look for the FEI decision here.',
      'Select a registration to open the seminar page with its full details.',
      'To cancel an upcoming registration, select Cancel registration on that row.',
      'Past: review the courses you have already completed.',
      'Use Available Seminars/Courses to register for more, and Past Seminars/Courses to browse the archive.',
    ],
    videoSrc: null,
  },
];

export function howToSectionPath(id: HowToSectionId): string {
  return `${HOW_TO_PATH}#${id}`;
}
