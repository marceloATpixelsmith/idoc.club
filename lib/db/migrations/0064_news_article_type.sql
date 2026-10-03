alter table idoc.news_articles
  add column if not exists article_type varchar(10) not null default 'news';

alter table idoc.news_articles
  add column if not exists thumbnail_url text;

do $
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'news_articles_type_check'
      and conrelid = 'idoc.news_articles'::regclass
  ) then
    alter table idoc.news_articles
      add constraint news_articles_type_check check (article_type in ('news', 'blog'));
  end if;
end $;

create index if not exists news_articles_type_publication_idx
  on idoc.news_articles (article_type, status, publication_date);

-- Existing President's Blog items are migrated into the unified News/Blog store by title/slug.
update idoc.news_articles
set article_type = 'blog'
where lower(title) in (
  'modern dressage judging: perception, data, and the evolving role of welfare',
  'new research on stress in dressage horses',
  'integrity beyond compliance'
)
or slug in (
  'modern-dressage-judging',
  'modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen',
  'stress-in-dressage-horses',
  'new-research-on-stress-in-dressage-horses',
  'integrity-beyond-compliance'
);

-- Remove stale preferences for the removed Pages admin, then tighten the identifier constraint.
delete from idoc.administrator_table_preferences where table_identifier = 'content_pages';
alter table idoc.administrator_table_preferences
  drop constraint if exists administrator_table_preferences_identifier_check;
alter table idoc.administrator_table_preferences
  add constraint administrator_table_preferences_identifier_check
  check (table_identifier in ('memberships', 'support', 'news', 'seminars', 'seminar_registrations'));


-- Preserve the original featured images from the legacy idoc.club articles in IDOC's own
-- Cloudinary account so the redesign does not depend on the retired WordPress host.
update idoc.news_articles
set thumbnail_url = case
  when lower(title) like '%jacques van daele%' or slug in ('in-memoriam-jacques-van-daele','in-memoriam-jacques-van-daele-1953-2026')
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989373/jacques-van-daele.jpg'
  when lower(title) like '%stephen clarke%' or slug in ('in-memoriam-stephen-clarke','in-memoriam-stephen-clarke-1952-2026')
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989376/stephen-clarke.jpg'
  when lower(title) like '%judging guidelines%' or slug in ('fei-judging-guidelines','how-to-apply-the-fei-judging-guidelines-on-tension-submission-acceptance-of-the-contact-and-harmony')
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989380/fei-judging-guidelines.jpg'
  when lower(title) = 'fei rules revision' or slug = 'fei-rules-revision'
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989383/fei-rules-revision.jpg'
  when lower(title) like 'modern dressage judging:%' or slug in ('modern-dressage-judging','modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen')
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989387/modern-dressage-judging.jpg'
  when lower(title) = 'new research on stress in dressage horses' or slug in ('stress-in-dressage-horses','new-research-on-stress-in-dressage-horses')
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989391/stress-in-dressage-horses.jpg'
  when lower(title) = 'integrity beyond compliance' or slug = 'integrity-beyond-compliance'
    then 'https://res.cloudinary.com/z6xv27qx/image/upload/v1790989394/integrity-beyond-compliance.jpg'
  else thumbnail_url
end
where thumbnail_url is null;
