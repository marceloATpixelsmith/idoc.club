import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

test('admin page and drawer headings follow the shared title treatment', () => {
  const drawer = source('components/admin/admin-form-drawer.tsx');
  const member = source('app/(dashboard)/admin/members/member-detail-sheet.tsx');
  assert.match(drawer, /Dialog\.Title className="text-3xl font-semibold text-gold"/);
  assert.match(member, /SheetTitle className="text-3xl font-semibold text-gold">Member<\/SheetTitle>/);

  const expected = [
    ['app/(dashboard)/admin/revenue/page.tsx', 'Membership Revenue'],
    ['app/(dashboard)/admin/reconciliation/page.tsx', 'Stripe Reconciliation'],
    ['app/(dashboard)/admin/email-previews/page.tsx', 'Email Previews'],
    ['app/(dashboard)/admin/security/page.tsx', 'Super Admin Security Operations'],
  ] as const;
  for (const [path, heading] of expected) assert.match(source(path), new RegExp(`>${heading}<\\/h1>`));
});

test('shared button styling keeps text buttons bold and fully rounded', () => {
  const button = source('components/ui/button.tsx');
  const globals = source('app/globals.css');
  assert.match(button, /rounded-full text-sm font-bold/);
  assert.doesNotMatch(button, /xs: "[^"]*text-xs/);
  assert.match(globals, /\.idoc-secondary-button,[\s\S]*border-style: dotted;[\s\S]*font-size: 0\.9375rem;[\s\S]*font-weight: 700;/);
});

test('revenue date filter uses the standard blue dotted filter control', () => {
  const filters = source('app/(dashboard)/admin/revenue/revenue-filters.tsx');
  assert.match(filters, /<Button className="justify-start" data-idoc-table-control variant="outline">/);
});

test('admin table filter, Sort, and View controls use Title Case without changing public seminar controls', () => {
  const globals = source('app/globals.css');
  const sort = source('components/data-table/data-table-sort-list.tsx');
  const view = source('components/data-table/data-table-view-options.tsx');
  const seminarRegister = source('components/seminars/seminar-register-cta.tsx');

  assert.match(
    globals,
    /body:has\(\[data-idoc-admin-root\]\) \[data-idoc-table-control\],[^{]*\{[^}]*letter-spacing: normal;[^}]*text-transform: none;[^}]*\}/,
  );
  assert.doesNotMatch(
    globals,
    /(?:^|\n)\[data-idoc-table-control\],[^{]*\{[^}]*text-transform: none;/,
  );
  assert.match(sort, /\n\s+Sort\n/);
  assert.match(view, /\n\s+View\n/);
  assert.match(seminarRegister, /className="[^"]*uppercase[^"]*"[\s\S]*?>\s*Register\s*<ArrowUpRight/);
});

test('admins can create seminar registrations with manual payment methods only', () => {
  const page = source('app/(dashboard)/admin/seminars/registrations/page.tsx');
  const drawer = source('app/(dashboard)/admin/seminars/registrations/registration-create-drawer.tsx');
  const registrations = source('lib/seminars/registrations.ts');
  assert.match(page, /New Registration/);
  assert.match(page, /RegistrationCreateDrawer/);
  assert.match(drawer, /paymentMethods\.map/);
  assert.doesNotMatch(drawer, /online_stripe/);
  assert.match(registrations, /z\.enum\(MANUAL_PAYMENT_METHODS\)/);
  assert.match(registrations, /enabledMethods\.some/);
  assert.match(registrations, /isEntitled/);
  assert.match(registrations, /memberEntitled \? seminar\.member_price_cents : seminar\.non_member_price_cents/);
  assert.match(registrations, /Admin-created registrations must use Bank Transfer or Cash/);
});

test('public news list reuses homepage cards and article detail has Back to News', () => {
  const home = source('app/(marketing)/page.tsx');
  const news = source('app/(marketing)/news/page.tsx');
  const detail = source('app/(marketing)/news/[slug]/page.tsx');
  assert.match(home, /PublicNewsCard/);
  assert.match(news, /PublicNewsCard/);
  assert.match(news, /listAllPublicArticles\('news'\)/);
  assert.match(detail, /backHref="\/news"/);
  assert.match(detail, /backLabel="Back to News"/);
});


test('News/Blog form sizes fields for their content and keeps long metadata on separate rows', () => {
  const drawer = source('app/(dashboard)/admin/news/news-drawer.tsx');
  assert.match(drawer, /className="max-w-sm space-y-1\.5"[\s\S]*publicationDate/);
  assert.match(drawer, /<div className="space-y-4">[\s\S]*htmlFor="title"[\s\S]*htmlFor="subtitle"[\s\S]*htmlFor="slug"/);
  assert.doesNotMatch(drawer, /htmlFor="subtitle"[\s\S]{0,300}md:grid-cols-2/);
});

test('legacy News/Blog thumbnails remain visible in admin and have a dedicated post-0064 backfill migration', () => {
  const articles = source('lib/news/articles.ts');
  const migration = source('lib/db/migrations/0067_news_legacy_thumbnail_backfill.sql');
  const journal = source('lib/db/migrations/meta/_journal.json');
  const snapshot = source('lib/db/migrations/meta/0067_snapshot.json');
  assert.match(articles, /coalesce\(thumbnail_url,\$\{legacyThumbnailSql\(\)\}\) as admin_thumbnail_url/);
  assert.match(articles, /thumbnail_url: row\.admin_thumbnail_url \?\? row\.thumbnail_url/);
  assert.match(migration, /where thumbnail_url is null/);
  assert.match(migration, /jacques-van-daele\.jpg/);
  assert.match(migration, /stephen-clarke\.jpg/);
  assert.match(journal, /"idx": 67[\s\S]*"tag": "0067_news_legacy_thumbnail_backfill"/);
  assert.match(snapshot, /"prevId": "d1608e44-2a96-4fd9-a066-006600000066"/);
});


test('Tiptap image upload shows a visible loading state while the image is uploaded and inserted', () => {
  const editor = source('components/tiptap/simple-editor-field.tsx');
  assert.match(editor, /LoaderCircle className="animate-spin"/);
  assert.match(editor, /role="status"/);
  assert.match(editor, /Uploading image and inserting it into the editor\.\.\./);
  assert.match(editor, /disabled=\{isImageUploading\}/);
});


test('Tiptap images can be selected and drag-resized with their width persisted into HTML', () => {
  const imageNode = source('components/tiptap/image-node.ts');
  const imageNodeView = source('components/tiptap/image-node-view.tsx');
  assert.match(imageNode, /ReactNodeViewRenderer\(ImageNodeView\)/);
  assert.match(imageNode, /renderHTML: \(attributes\) => attributes\.width \? \{ width: attributes\.width \} : \{\}/);
  assert.match(imageNodeView, /aria-label="Resize image"/);
  assert.match(imageNodeView, /cursor-nwse-resize/);
  assert.match(imageNodeView, /editor\.commands\.setNodeSelection\(position\)/);
  assert.match(imageNodeView, /registeredHandlersRef = useRef<RegisteredResizeHandlers \| null>\(null\)/);
  assert.match(imageNodeView, /window\.addEventListener\('pointermove', handlers\.pointerMove/);
  assert.match(imageNodeView, /window\.addEventListener\('pointercancel', handlers\.pointerCancel\)/);
  assert.match(imageNodeView, /window\.removeEventListener\('pointermove', handlers\.pointerMove\)/);
  assert.match(imageNodeView, /moveEvent\.pointerId !== active\.pointerId/);
  assert.match(imageNodeView, /updateAttributes\(\{ width: Math\.round\(nextWidth\) \}\)/);
  assert.match(imageNodeView, /touchAction: 'none'/);
  assert.match(imageNodeView, /size-6 cursor-nwse-resize/);
  assert.match(imageNodeView, /className="block h-auto w-full max-w-full cursor-pointer"/);
});
