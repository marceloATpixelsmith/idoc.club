export const SUPPORT_CATEGORIES = ['billing_membership', 'seminars', 'technical_support'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  billing_membership: 'Billing/Membership',
  seminars: 'Seminars',
  technical_support: 'Technical Support',
};

export const STATUS_LABELS: Record<string, string> = {
  admin_responded: 'Responded to by admin',
  closed: 'Closed/Resolved',
  member_replied: 'Member Replied',
  open: 'Open',
};

export const SUPPORT_STATUSES = ['open', 'admin_responded', 'member_replied', 'closed'] as const;
