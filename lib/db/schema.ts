import {
  pgSchema,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  uuid,
  boolean,
  date,
  time,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

export const idocSchema = pgSchema('idoc');

export const users = idocSchema.table('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  // AUTH-IDENTITY-003: `email` is the normalized (trimmed, case-folded) identity used for lookup,
  // comparison, and uniqueness -- every existing call site keeps using it unchanged. This column
  // separately preserves the display form (trimmed, Unicode-normalized, but not case-folded) as the
  // member actually typed it, so casing isn't silently discarded while normalization still governs
  // identity. Nullable because it's populated at signup/email-change; existing rows are backfilled
  // to their current `email` value by this column's own migration.
  emailDisplay: varchar('email_display', { length: 255 }),
  passwordHash: text('password_hash').notNull(),
  accountState: varchar('account_state', { length: 30 }).notNull().default('unverified'),
  sessionVersion: integer('session_version').notNull().default(0),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  emailVerifiedAt: timestamp('email_verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  uniqueIndex('users_normalized_email_unique').on(sql`lower(${table.email})`),
  check('users_account_state_check', sql`${table.accountState} in ('unverified', 'onboarding', 'active', 'suspended', 'migrated_pending', 'deleted')`),
]);

export const authSessions = idocSchema.table('auth_sessions', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 64 }).notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sessionVersion: integer('session_version').notNull(),
  authenticatedAt: timestamp('authenticated_at', { withTimezone: true }).notNull(),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull(),
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: varchar('revoke_reason', { length: 80 }),
  // A short, human-readable device/browser label (e.g. "Chrome on macOS") derived from the
  // request's User-Agent header at the moment this session was created -- see
  // lib/auth/session-device-label.ts. Deliberately never the raw User-Agent string itself: the
  // whole point of the "Active sessions" list is letting the owner tell their own device apart from
  // an intruder's, and this derived label is the minimum data that actually serves that purpose.
  deviceLabel: varchar('device_label', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('auth_sessions_active_user_idx').on(table.userId, table.lastActivityAt).where(sql`${table.revokedAt} is null`),
  index('auth_sessions_expiry_idx').on(table.absoluteExpiresAt),
]);

export const teams = idocSchema.table('teams', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  stripeCustomerId: text('stripe_customer_id').unique(),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeProductId: text('stripe_product_id'),
  planName: varchar('plan_name', { length: 50 }),
  subscriptionStatus: varchar('subscription_status', { length: 20 }),
});

export const teamMembers = idocSchema.table('team_members', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  role: varchar('role', { length: 50 }).notNull(),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
});

export const activityLogs = idocSchema.table('activity_logs', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  userId: integer('user_id').references(() => users.id),
  action: text('action').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  ipAddress: varchar('ip_address', { length: 45 }),
});

export const invitations = idocSchema.table('invitations', {
  id: serial('id').primaryKey(),
  teamId: integer('team_id')
    .notNull()
    .references(() => teams.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull(),
  invitedBy: integer('invited_by')
    .notNull()
    .references(() => users.id),
  invitedAt: timestamp('invited_at').notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
});

export const teamsRelations = relations(teams, ({ many }) => ({
  teamMembers: many(teamMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  teamMembers: many(teamMembers),
  invitationsSent: many(invitations),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  team: one(teams, {
    fields: [invitations.teamId],
    references: [teams.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  team: one(teams, {
    fields: [activityLogs.teamId],
    references: [teams.id],
  }),
  user: one(users, {
    fields: [activityLogs.userId],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type TeamDataWithMembers = Team & {
  teamMembers: (TeamMember & {
    user: Pick<User, 'id' | 'email'>;
  })[];
};

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_TEAM = 'CREATE_TEAM',
  REMOVE_TEAM_MEMBER = 'REMOVE_TEAM_MEMBER',
  INVITE_TEAM_MEMBER = 'INVITE_TEAM_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
}

/** IDOC roles are authorization claims managed only by trusted server code. */
export const applicationRoles = idocSchema.table('application_roles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  role: varchar('role', { length: 20 }).notNull(),
  grantedBy: integer('granted_by').references(() => users.id),
  grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('application_roles_active_unique').on(table.userId, table.role).where(sql`${table.revokedAt} is null`),
  check('application_roles_role_check', sql`${table.role} in ('member', 'administrator', 'super_admin')`),
]);

export const profiles = idocSchema.table('profiles', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().unique().references(() => users.id),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  address1: varchar('address_1', { length: 200 }).notNull(),
  address2: varchar('address_2', { length: 200 }),
  city: varchar('city', { length: 100 }).notNull(),
  stateProvince: varchar('state_province', { length: 100 }).notNull(),
  postalCode: varchar('postal_code', { length: 30 }).notNull(),
  countryCode: varchar('country_code', { length: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Singleton, server-owned public organization identity. Private settings must use separate tables. */
export const organizationSettings = idocSchema.table('organization_settings', {
  id: integer('id').primaryKey().default(1),
  address1: varchar('address_1', { length: 200 }),
  address2: varchar('address_2', { length: 200 }),
  city: varchar('city', { length: 100 }),
  stateProvince: varchar('state_province', { length: 100 }),
  postalCode: varchar('postal_code', { length: 30 }),
  country: varchar('country', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [check('organization_settings_singleton_check', sql`${table.id} = 1`)]);

/** Seminar payment choices are durable identities, not membership-payment provider state. */
export const seminarPaymentMethods = idocSchema.table('seminar_payment_methods', {
  id: serial('id').primaryKey(),
  canonicalId: varchar('canonical_id', { length: 40 }).notNull().unique(),
  displayLabel: varchar('display_label', { length: 100 }).notNull(),
  enabled: boolean('enabled').notNull().default(false),
  systemProtected: boolean('system_protected').notNull().default(false),
  displayOrder: integer('display_order').notNull(),
  instructionsHtml: text('instructions_html'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('seminar_payment_methods_identity_check', sql`${table.canonicalId} in ('online_stripe', 'bank_transfer', 'cash_event')`),
  check('seminar_payment_methods_stripe_protected_check', sql`${table.canonicalId} <> 'online_stripe' or (${table.enabled} and ${table.systemProtected} and ${table.instructionsHtml} is null)`),
  uniqueIndex('seminar_payment_methods_display_order_unique').on(table.displayOrder),
]);

/** The perk list shown on every membership-tier box on the public membership page and on the
 * dashboard's payment box. A plain ordered list of labels -- superadmin-editable, not tied to any
 * particular membership tier or classification. */
export const membershipPerks = idocSchema.table('membership_perks', {
  id: serial('id').primaryKey(),
  label: varchar('label', { length: 200 }).notNull(),
  displayOrder: integer('display_order').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('membership_perks_display_order_unique').on(table.displayOrder),
  check('membership_perks_label_length_check', sql`char_length(${table.label}) between 1 and 200`),
]);

/** Evidence captured only when a member actually submits the onboarding form. */
export const onboardingConsents = idocSchema.table('onboarding_consents', {
  profileId: integer('profile_id').primaryKey().references(() => profiles.id, { onDelete: 'cascade' }),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }).notNull(),
  privacyAcceptedAt: timestamp('privacy_accepted_at', { withTimezone: true }).notNull(),
  keepUpdatedOptIn: boolean('keep_updated_opt_in').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const professionalRoles = idocSchema.table('professional_roles', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  roleType: varchar('role_type', { length: 20 }).notNull(),
  nationalFederationCountryCode: varchar('national_federation_country_code', { length: 2 }),
  idocRegion: varchar('idoc_region', { length: 40 }),
  feiId: varchar('fei_id', { length: 40 }),
  officialStatuses: varchar('official_statuses', { length: 120 }).array(),
  isTechnicalDelegate: boolean('is_technical_delegate'),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  verifiedBy: integer('verified_by').references(() => users.id),
}, (table) => [check('professional_roles_type_check', sql`${table.roleType} in ('judge', 'steward', 'veterinarian')`)]);

export const memberships = idocSchema.table('memberships', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  status: varchar('status', { length: 30 }).notNull(),
  startsOn: date('starts_on').notNull(),
  validUntil: date('valid_until').notNull(),
  graceEndsOn: date('grace_ends_on'),
  membershipType: varchar('membership_type', { length: 30 }).notNull().default('standard'),
  source: varchar('source', { length: 30 }).notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('memberships_status_check', sql`${table.status} in ('active', 'grace', 'expired', 'canceled', 'suspended', 'complimentary', 'review_required')`),
  check('memberships_dates_check', sql`${table.validUntil} >= ${table.startsOn}`),
]);

export const profileChangeHistory = idocSchema.table('profile_change_history', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  actorId: integer('actor_id').notNull().references(() => users.id),
  beforeJson: jsonb('before_json').notNull(),
  afterJson: jsonb('after_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = idocSchema.table('audit_log', {
  id: serial('id').primaryKey(),
  actorId: integer('actor_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: varchar('entity_id', { length: 100 }).notNull(),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Validated, per-administrator data-table state. Transient UI state (selection, open menus,
 * confirmations, and loading indicators) is deliberately never stored here. */
export const administratorTablePreferences = idocSchema.table('administrator_table_preferences', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tableIdentifier: varchar('table_identifier', { length: 40 }).notNull(),
  preferences: jsonb('preferences').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('administrator_table_preferences_user_table_unique').on(table.userId, table.tableIdentifier),
  check('administrator_table_preferences_identifier_check', sql`${table.tableIdentifier} in ('memberships', 'support', 'news', 'seminars', 'content_pages')`),
]);

/** Member-owned, immutable threaded support. Public UUIDs keep internal sequence IDs out of URLs. */
export const supportConversations = idocSchema.table('support_conversations', {
  id: serial('id').primaryKey(),
  publicId: uuid('public_id').notNull().defaultRandom().unique(),
  memberUserId: integer('member_user_id').notNull().references(() => users.id),
  category: varchar('category', { length: 30 }).notNull(),
  subject: varchar('subject', { length: 160 }).notNull(),
  status: varchar('status', { length: 30 }).notNull().default('open'),
  assignedAdminUserId: integer('assigned_admin_user_id').references(() => users.id),
  memberReadAt: timestamp('member_read_at', { withTimezone: true }),
  adminReadAt: timestamp('admin_read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('support_conversations_category_check', sql`${table.category} in ('billing_membership', 'seminars', 'technical_support')`),
  check('support_conversations_status_check', sql`${table.status} in ('open', 'admin_responded', 'member_replied', 'closed')`),
  check('support_conversations_subject_length_check', sql`char_length(${table.subject}) between 1 and 160`),
  index('support_conversations_member_activity_idx').on(table.memberUserId, table.updatedAt),
  index('support_conversations_admin_queue_idx').on(table.assignedAdminUserId, table.status, table.updatedAt),
]);

export const supportMessages = idocSchema.table('support_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull().references(() => supportConversations.id),
  authorUserId: integer('author_user_id').notNull().references(() => users.id),
  authorSide: varchar('author_side', { length: 10 }).notNull(),
  body: text('body').notNull(),
  idempotencyKey: uuid('idempotency_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('support_messages_author_side_check', sql`${table.authorSide} in ('member', 'admin')`),
  check('support_messages_body_length_check', sql`char_length(${table.body}) between 1 and 10000`),
  uniqueIndex('support_messages_author_idempotency_unique').on(table.authorUserId, table.idempotencyKey),
  index('support_messages_thread_idx').on(table.conversationId, table.createdAt, table.id),
]);

/** A conversation may be owned by several administrators. Read progress is deliberately stored
 * per administrator so opening a shared thread never clears another administrator's unread state. */
export const supportConversationAdministrators = idocSchema.table('support_conversation_administrators', {
  conversationId: integer('conversation_id').notNull().references(() => supportConversations.id),
  administratorUserId: integer('administrator_user_id').notNull().references(() => users.id),
  assignedByUserId: integer('assigned_by_user_id').references(() => users.id),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.conversationId, table.administratorUserId] }),
  index('support_conversation_administrators_admin_idx').on(table.administratorUserId, table.conversationId),
]);

export const supportAdministratorReadCursors = idocSchema.table('support_administrator_read_cursors', {
  conversationId: integer('conversation_id').notNull().references(() => supportConversations.id),
  administratorUserId: integer('administrator_user_id').notNull().references(() => users.id),
  readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.conversationId, table.administratorUserId] })]);

export const supportCategoryDefaults = idocSchema.table('support_category_defaults', {
  category: varchar('category', { length: 30 }).notNull(),
  administratorUserId: integer('administrator_user_id').notNull().references(() => users.id),
  updatedBy: integer('updated_by').notNull().references(() => users.id),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.category, table.administratorUserId] }), check('support_category_defaults_category_check', sql`${table.category} in ('billing_membership', 'seminars', 'technical_support')`)]);

/** Administrator-authored News/Blog articles. `publicationDate` is the administrator-set target date
 * (also the displayed article date); `publishedAt` is the actual timestamp the article went live,
 * set either by an immediate publish or by the scheduled-publish Cron transition. Public visibility
 * additionally requires `publicationDate <= now()` even when status is already 'published', so a
 * defense-in-depth check never leaks a future-dated article ahead of its scheduled time. */
export const newsArticles = idocSchema.table('news_articles', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 160 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  subtitle: varchar('subtitle', { length: 300 }),
  contentHtml: text('content_html').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  publicationDate: timestamp('publication_date', { withTimezone: true }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  updatedByUserId: integer('updated_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('news_articles_status_check', sql`${table.status} in ('draft', 'scheduled', 'published', 'archived')`),
  check('news_articles_slug_format_check', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check('news_articles_title_length_check', sql`char_length(${table.title}) between 1 and 200`),
  check('news_articles_subtitle_length_check', sql`${table.subtitle} is null or char_length(${table.subtitle}) between 1 and 300`),
  check('news_articles_content_length_check', sql`char_length(${table.contentHtml}) between 1 and 20000`),
  index('news_articles_publication_queue_idx').on(table.status, table.publicationDate),
]);

/** Revisioned CMS pages with explicit union/intersection audience rules. */
export const contentPages = idocSchema.table('content_pages', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 160 }).notNull().unique(),
  title: varchar('title', { length: 200 }).notNull(),
  summary: varchar('summary', { length: 500 }),
  contentHtml: text('content_html').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  audienceMode: varchar('audience_mode', { length: 10 }).notNull().default('any'),
  publishAt: timestamp('publish_at', { withTimezone: true }),
  seoTitle: varchar('seo_title', { length: 200 }),
  seoDescription: varchar('seo_description', { length: 320 }),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  updatedByUserId: integer('updated_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('content_pages_status_check', sql`${table.status} in ('draft', 'published', 'archived')`),
  check('content_pages_audience_mode_check', sql`${table.audienceMode} in ('any', 'all')`),
  check('content_pages_slug_format_check', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  check('content_pages_title_length_check', sql`char_length(${table.title}) between 1 and 200`),
  check('content_pages_content_length_check', sql`char_length(${table.contentHtml}) between 1 and 20000`),
  index('content_pages_publication_idx').on(table.status, table.publishAt),
]);

export const contentPageAudiences = idocSchema.table('content_page_audiences', {
  pageId: integer('page_id').notNull().references(() => contentPages.id, { onDelete: 'cascade' }),
  audience: varchar('audience', { length: 20 }).notNull(),
}, (table) => [primaryKey({ columns: [table.pageId, table.audience] }), check('content_page_audiences_value_check', sql`${table.audience} in ('public', 'member', 'judge', 'steward', 'veterinarian')`)]);

export const contentPageRevisions = idocSchema.table('content_page_revisions', {
  id: serial('id').primaryKey(),
  pageId: integer('page_id').notNull().references(() => contentPages.id, { onDelete: 'cascade' }),
  revisionNumber: integer('revision_number').notNull(),
  snapshotJson: jsonb('snapshot_json').notNull(),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('content_page_revisions_number_unique').on(table.pageId, table.revisionNumber)]);

/** Administrator-authored seminars. `paymentMethodCanonicalId` references the same canonical
 * `seminar_payment_methods` identities Organization Settings owns (migration 0038) -- a seminar
 * never invents its own payment-method identity. `priceCents`/`paymentMethodCanonicalId` become
 * immutable at the application layer once any registration exists (lib/seminars/seminars.ts),
 * and `capacity` may only be lowered to at least the current active-registration count. */
export const seminars = idocSchema.table('seminars', {
  id: serial('id').primaryKey(),
  title: varchar('title', { length: 200 }).notNull(),
  description: text('description').notNull(),
  seminarDate: date('seminar_date').notNull(),
  startTime: time('start_time').notNull(),
  endTime: time('end_time').notNull(),
  timezone: varchar('timezone', { length: 60 }).notNull(),
  location: text('location').notNull(),
  capacity: integer('capacity').notNull(),
  priceCents: integer('price_cents').notNull(),
  registrationDeadline: timestamp('registration_deadline', { withTimezone: true }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('draft'),
  paymentMethodCanonicalId: varchar('payment_method_canonical_id', { length: 40 }).notNull().references(() => seminarPaymentMethods.canonicalId),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  updatedByUserId: integer('updated_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('seminars_status_check', sql`${table.status} in ('draft', 'published', 'canceled')`),
  check('seminars_title_length_check', sql`char_length(${table.title}) between 1 and 200`),
  check('seminars_description_length_check', sql`char_length(${table.description}) between 1 and 10000`),
  check('seminars_location_length_check', sql`char_length(${table.location}) between 1 and 2000`),
  check('seminars_capacity_check', sql`${table.capacity} > 0`),
  check('seminars_price_check', sql`${table.priceCents} >= 0`),
  check('seminars_time_order_check', sql`${table.endTime} > ${table.startTime}`),
  index('seminars_status_date_idx').on(table.status, table.seminarDate),
]);

/** One row per member registration; canceling reuses the same row (registration_status flips back
 * to 'registered' on re-registration) rather than inserting a second row, so the unique constraint
 * on (seminar_id, profile_id) is a real, permanent duplicate-registration guard, not just a
 * point-in-time check. `paymentStatus` and `registrationStatus` are deliberately independent
 * columns -- canceling a registration never overwrites its payment history and vice versa. */
export const seminarRegistrations = idocSchema.table('seminar_registrations', {
  id: serial('id').primaryKey(),
  seminarId: integer('seminar_id').notNull().references(() => seminars.id),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  registrationStatus: varchar('registration_status', { length: 20 }).notNull().default('registered'),
  paymentStatus: varchar('payment_status', { length: 30 }).notNull(),
  stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }).unique(),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }).unique(),
  expectedAmountCents: integer('expected_amount_cents'),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  checkoutStatus: varchar('checkout_status', { length: 20 }),
  checkoutCreatedAt: timestamp('checkout_created_at', { withTimezone: true }),
  paymentStatusUpdatedAt: timestamp('payment_status_updated_at', { withTimezone: true }),
  disputedAt: timestamp('disputed_at', { withTimezone: true }),
  chargebackAt: timestamp('chargeback_at', { withTimezone: true }),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  markedPaidByUserId: integer('marked_paid_by_user_id').references(() => users.id),
  registeredAt: timestamp('registered_at', { withTimezone: true }).notNull().defaultNow(),
  canceledAt: timestamp('canceled_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('seminar_registrations_registration_status_check', sql`${table.registrationStatus} in ('registered', 'canceled')`),
  check('seminar_registrations_payment_status_check', sql`${table.paymentStatus} in ('unpaid', 'pending', 'bank_transfer_pending', 'cash_pending', 'paid', 'refunded', 'partially_refunded', 'refund_failed', 'disputed', 'chargeback')`),
  check('seminar_registrations_expected_amount_check', sql`${table.expectedAmountCents} is null or ${table.expectedAmountCents} >= 0`),
  check('seminar_registrations_currency_check', sql`${table.currency} = 'EUR'`),
  check('seminar_registrations_checkout_status_check', sql`${table.checkoutStatus} is null or ${table.checkoutStatus} in ('open', 'complete', 'expired', 'superseded')`),
  uniqueIndex('seminar_registrations_seminar_profile_unique').on(table.seminarId, table.profileId),
  index('seminar_registrations_seminar_status_idx').on(table.seminarId, table.registrationStatus),
  index('seminar_registrations_profile_idx').on(table.profileId),
]);

export const notificationOutbox = idocSchema.table('notification_outbox', {
  id: serial('id').primaryKey(),
  kind: varchar('kind', { length: 50 }).notNull(),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 50 }),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: varchar('lease_owner', { length: 100 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  // Stable per-notice-cycle identity (e.g. `membership.renewal_reminder:{profileId}:{currentPeriodEnd}`)
  // so a re-run scan can't enqueue the same notice twice. Nullable: the two pre-existing kinds never set it.
  dedupeKey: varchar('dedupe_key', { length: 150 }).unique(),
}, (table) => [index('notification_claim_idx').on(table.availableAt, table.id).where(sql`${table.sentAt} is null and ${table.deadLetteredAt} is null`)]);

export const stripeEvents = idocSchema.table('stripe_events', {
  id: serial('id').primaryKey(),
  externalEventId: varchar('external_event_id', { length: 255 }).notNull().unique(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const emailVerificationTokens = idocSchema.table('email_verification_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  pendingEmail: varchar('pending_email', { length: 255 }).notNull(),
  // AUTH-IDENTITY-003: carries the requested address's display-form casing through the change
  // transaction so completion can populate users.emailDisplay the same way signup does.
  pendingEmailDisplay: varchar('pending_email_display', { length: 255 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Digests for anonymous account-recovery and imported-member activation links. */
export const accountTokens = idocSchema.table('account_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  purpose: varchar('purpose', { length: 30 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('account_tokens_purpose_check', sql`${table.purpose} in ('password_reset', 'migration_activation')`),
  index('account_tokens_claim_idx').on(table.tokenHash, table.purpose, table.expiresAt).where(sql`${table.consumedAt} is null`),
]);

export const accountDeliveryOutbox = idocSchema.table('account_delivery_outbox', {
  id: serial('id').primaryKey(),
  tokenId: integer('token_id').notNull().unique().references(() => accountTokens.id),
  userId: integer('user_id').notNull().references(() => users.id),
  purpose: varchar('purpose', { length: 30 }).notNull(),
  encryptedPayload: text('encrypted_payload').notNull(),
  keyVersion: varchar('key_version', { length: 30 }).notNull(),
  messageId: varchar('message_id', { length: 100 }).notNull().unique(),
  availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
  leaseOwner: varchar('lease_owner', { length: 100 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 50 }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  terminalAt: timestamp('terminal_at', { withTimezone: true }),
  terminalReason: varchar('terminal_reason', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('account_delivery_claim_idx').on(table.availableAt, table.id).where(sql`${table.sentAt} is null and ${table.deadLetteredAt} is null`)]);

/** Short-lived 6-digit codes for signup/login/password-reset email verification. Sent
 * synchronously (not via the async account_delivery_outbox worker) since a 30-minute-lifetime
 * code shouldn't sit in a delivery queue. user_id is null for signup_verification, where no
 * user row exists yet until the password step completes. */
export const emailOtpCodes = idocSchema.table('email_otp_codes', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id),
  email: varchar('email', { length: 255 }).notNull(),
  purpose: varchar('purpose', { length: 30 }).notNull(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('email_otp_codes_purpose_check', sql`${table.purpose} in ('signup_verification', 'login_verification', 'password_reset')`),
  index('email_otp_codes_lookup_idx').on(table.email, table.purpose, table.expiresAt).where(sql`${table.consumedAt} is null`),
]);

export const accountRequestLimits = idocSchema.table('account_request_limits', {
  id: serial('id').primaryKey(),
  purpose: varchar('purpose', { length: 30 }).notNull(),
  identifierHash: varchar('identifier_hash', { length: 64 }).notNull(),
  originHash: varchar('origin_hash', { length: 64 }).notNull(),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
  requestCount: integer('request_count').notNull().default(1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('account_request_limits_bucket_unique').on(table.purpose, table.identifierHash, table.originHash, table.windowStartedAt)]);

export const billingAccounts = idocSchema.table('billing_accounts', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().unique().references(() => profiles.id),
  provider: varchar('provider', { length: 30 }).notNull().default('stripe'),
  externalCustomerId: varchar('external_customer_id', { length: 255 }).notNull().unique(),
});

export const subscriptions = idocSchema.table('subscriptions', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }).notNull().unique(),
  priceId: varchar('price_id', { length: 255 }).notNull(),
  status: varchar('status', { length: 30 }).notNull(),
  currentPeriodEnd: date('current_period_end').notNull(),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('subscriptions_status_check', sql`${table.status} in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired')`),
  uniqueIndex('subscriptions_one_open_path_per_profile').on(table.profileId)
    .where(sql`${table.status} in ('active', 'trialing', 'past_due', 'incomplete')`),
]);

/** Server-owned renewal intent. This never grants entitlement: memberships remains authoritative. */
export const renewalPreferences = idocSchema.table('renewal_preferences', {
  profileId: integer('profile_id').primaryKey().references(() => profiles.id),
  currentMode: varchar('current_mode', { length: 20 }).notNull(),
  pendingMode: varchar('pending_mode', { length: 20 }),
  effectiveOn: date('effective_on'),
  expectedChargeCents: integer('expected_charge_cents'),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  externalCheckoutSessionId: varchar('external_checkout_session_id', { length: 255 }).unique(),
  externalSetupIntentId: varchar('external_setup_intent_id', { length: 255 }).unique(),
  externalPaymentMethodId: varchar('external_payment_method_id', { length: 255 }),
  externalRecurringPriceId: varchar('external_recurring_price_id', { length: 255 }),
  externalSubscriptionScheduleId: varchar('external_subscription_schedule_id', { length: 255 }).unique(),
  transitionState: varchar('transition_state', { length: 30 }).notNull().default('current'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('renewal_preferences_current_mode_check', sql`${table.currentMode} in ('recurring', 'non_recurring')`),
  check('renewal_preferences_pending_mode_check', sql`${table.pendingMode} is null or ${table.pendingMode} in ('recurring', 'non_recurring')`),
  check('renewal_preferences_transition_state_check', sql`${table.transitionState} in ('current', 'awaiting_setup', 'pending_activation', 'cancel_pending', 'failed')`),
  check('renewal_preferences_pending_shape_check', sql`(${table.pendingMode} is null and ${table.effectiveOn} is null) or (${table.pendingMode} is not null and ${table.effectiveOn} is not null)`),
  check('renewal_preferences_expected_charge_check', sql`${table.expectedChargeCents} is null or (${table.expectedChargeCents} = 8000 and ${table.currency} = 'EUR')`),
]);

/** One row per payment event, Stripe-verified or administrator-entered manually. */
export const payments = idocSchema.table('payments', {
  id: serial('id').primaryKey(),
  profileId: integer('profile_id').notNull().references(() => profiles.id),
  source: varchar('source', { length: 30 }).notNull(),
  externalPaymentId: varchar('external_payment_id', { length: 255 }).unique(),
  amountCents: integer('amount_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
  reference: text('reference'),
  administratorId: integer('administrator_id').references(() => users.id),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('payments_source_check', sql`${table.source} in ('stripe_recurring', 'stripe_one_time', 'paypal', 'bank_transfer', 'cash', 'complimentary')`),
  check('payments_amount_check', sql`${table.amountCents} > 0`),
  check(
    'payments_evidence_check',
    sql`(${table.source} in ('stripe_recurring', 'stripe_one_time') and ${table.externalPaymentId} is not null)
      or (${table.source} in ('paypal', 'bank_transfer', 'cash', 'complimentary') and ${table.administratorId} is not null)`,
  ),
]);


/** Immutable links from a Stripe refund to its original seminar or membership payment. */
export const paymentRefunds = idocSchema.table('payment_refunds', {
  id: serial('id').primaryKey(),
  seminarRegistrationId: integer('seminar_registration_id').references(() => seminarRegistrations.id),
  membershipPaymentId: integer('membership_payment_id').references(() => payments.id),
  externalRefundId: varchar('external_refund_id', { length: 255 }).unique(),
  idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull().unique(),
  amountCents: integer('amount_cents').notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
  status: varchar('status', { length: 30 }).notNull(),
  reason: text('reason').notNull(),
  administratorId: integer('administrator_id').references(() => users.id),
  failureCode: varchar('failure_code', { length: 100 }),
  providerEvidence: jsonb('provider_evidence'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  refundedAt: timestamp('refunded_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('payment_refunds_owner_check', sql`num_nonnulls(${table.seminarRegistrationId}, ${table.membershipPaymentId}) = 1`),
  check('payment_refunds_amount_check', sql`${table.amountCents} > 0`),
  check('payment_refunds_currency_check', sql`${table.currency} = 'EUR'`),
  check('payment_refunds_status_check', sql`${table.status} in ('pending', 'succeeded', 'failed', 'canceled')`),
  uniqueIndex('payment_refunds_one_pending_seminar').on(table.seminarRegistrationId).where(sql`${table.status} = 'pending'`),
  uniqueIndex('payment_refunds_one_pending_membership').on(table.membershipPaymentId).where(sql`${table.status} = 'pending'`),
]);

/** Current reconciliation snapshot only — wiped and rewritten on every successful cron run, not accumulated history. */
export const reconciliationFindings = idocSchema.table('reconciliation_findings', {
  id: serial('id').primaryKey(),
  kind: varchar('kind', { length: 30 }).notNull(),
  profileId: integer('profile_id').references(() => profiles.id),
  externalCustomerId: varchar('external_customer_id', { length: 255 }),
  externalSubscriptionId: varchar('external_subscription_id', { length: 255 }),
  summary: text('summary').notNull(),
  details: jsonb('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('reconciliation_findings_kind_check', sql`${table.kind} in ('status_conflict', 'orphaned_subscription', 'repeated_failure', 'unlinked_customer', 'pending_schedule_conflict', 'refund_conflict', 'missing_refund', 'dispute', 'chargeback', 'seminar_payment_conflict')`),
]);

/** Append-only heartbeat log, one row per cron execution, so a failed run doesn't read as a silent "all clear." */
export const reconciliationRuns = idocSchema.table('reconciliation_runs', {
  id: serial('id').primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  status: varchar('status', { length: 20 }).notNull(),
  findingsCount: integer('findings_count').notNull().default(0),
  errorMessage: text('error_message'),
}, (table) => [
  check('reconciliation_runs_status_check', sql`${table.status} in ('completed', 'failed')`),
]);

export const migrationMap = idocSchema.table('migration_map', {
  id: serial('id').primaryKey(),
  legacyType: varchar('legacy_type', { length: 50 }).notNull(),
  legacyId: varchar('legacy_id', { length: 255 }).notNull(),
  newEntityId: varchar('new_entity_id', { length: 255 }),
  disposition: varchar('disposition', { length: 40 }).notNull(),
  confidence: varchar('confidence', { length: 20 }),
  reviewedBy: integer('reviewed_by').references(() => users.id),
}, (table) => [uniqueIndex('migration_map_source_unique').on(table.legacyType, table.legacyId)]);

/** Encrypted TOTP factors. Secret material is always application-encrypted before persistence.
 * Previously also held WebAuthn factor rows (factor_type='webauthn', secret columns left null,
 * proof material in a since-removed webauthn_credentials table) -- passkey/WebAuthn support was
 * removed in favor of Google sign-in + TOTP only; see the migration that dropped those tables. */
export const mfaFactors = idocSchema.table('mfa_factors', {
  factorId: varchar('factor_id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 100 }).notNull(),
  factorType: varchar('factor_type', { length: 20 }).notNull().default('totp'),
  status: varchar('status', { length: 20 }).notNull(),
  encryptedSecret: text('encrypted_secret').notNull(),
  encryptionKeyId: varchar('encryption_key_id', { length: 100 }).notNull(),
  lastAcceptedCounter: integer('last_accepted_counter'),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lifecycleReason: varchar('lifecycle_reason', { length: 200 }),
  replacedByFactorId: varchar('replaced_by_factor_id', { length: 36 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('mfa_factors_type_check', sql`${table.factorType} in ('totp')`),
  check('mfa_factors_status_check', sql`${table.status} in ('pending', 'active', 'disabled', 'revoked', 'replaced')`),
  uniqueIndex('mfa_factors_one_active_totp').on(table.userId, table.applicationId, table.factorType)
    .where(sql`${table.status} = 'active' and ${table.factorType} = 'totp'`),
  index('mfa_factors_owner_idx').on(table.userId, table.applicationId),
]);

export const mfaEnrollmentTransactions = idocSchema.table('mfa_enrollment_transactions', {
  transactionId: varchar('transaction_id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 100 }).notNull(),
  factorId: varchar('factor_id', { length: 36 }).notNull().references(() => mfaFactors.factorId, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 40 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('mfa_enrollment_purpose_check', sql`${table.purpose} in ('mfa-enrollment', 'authenticator-replacement', 'mfa-recovery')`),
  check('mfa_enrollment_attempt_count_check', sql`${table.attemptCount} >= 0`),
  index('mfa_enrollment_owner_idx').on(table.userId, table.applicationId, table.expiresAt),
]);

export const mfaChallengeTransactions = idocSchema.table('mfa_challenge_transactions', {
  transactionId: varchar('transaction_id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 100 }).notNull(),
  purpose: varchar('purpose', { length: 20 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  satisfiedFactorId: varchar('satisfied_factor_id', { length: 36 }).references(() => mfaFactors.factorId),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check('mfa_challenge_purpose_check', sql`${table.purpose} in ('login', 'password-reset', 'step-up')`),
  check('mfa_challenge_attempts_check', sql`${table.attemptCount} >= 0 and ${table.maxAttempts} > 0 and ${table.attemptCount} <= ${table.maxAttempts}`),
  index('mfa_challenge_owner_idx').on(table.userId, table.applicationId, table.expiresAt),
]);

export const mfaRecoveryCodes = idocSchema.table('mfa_recovery_codes', {
  recoveryCodeId: varchar('recovery_code_id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 100 }).notNull(),
  generationId: varchar('generation_id', { length: 36 }).notNull(),
  digest: varchar('digest', { length: 64 }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('mfa_recovery_codes_digest_unique').on(table.userId, table.applicationId, table.digest),
  index('mfa_recovery_codes_generation_idx').on(table.userId, table.applicationId, table.generationId),
]);

export const mfaRememberedDevices = idocSchema.table('mfa_remembered_devices', {
  rememberedDeviceId: varchar('remembered_device_id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 100 }).notNull(),
  factorId: varchar('factor_id', { length: 36 }).notNull().references(() => mfaFactors.factorId, { onDelete: 'cascade' }),
  tokenDigest: varchar('token_digest', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: varchar('revoke_reason', { length: 200 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('mfa_remembered_devices_digest_unique').on(table.tokenDigest),
  index('mfa_remembered_devices_owner_idx').on(table.userId, table.applicationId, table.expiresAt),
]);

/** Ordinary-member login verification trust. This is deliberately independent from TOTP factors. */
export const loginTrustedDevices = idocSchema.table('login_trusted_devices', {
  trustedDeviceId: varchar('trusted_device_id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  applicationId: varchar('application_id', { length: 100 }).notNull(),
  tokenDigest: varchar('token_digest', { length: 64 }).notNull(),
  sessionVersionAtIssue: integer('session_version_at_issue').notNull(),
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: varchar('revoke_reason', { length: 200 }),
}, (table) => [
  uniqueIndex('login_trusted_devices_digest_unique').on(table.tokenDigest),
  index('login_trusted_devices_owner_idx').on(table.userId, table.applicationId, table.expiresAt),
]);

export type Profile = typeof profiles.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type ProfessionalRole = typeof professionalRoles.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
