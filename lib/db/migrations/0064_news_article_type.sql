alter table idoc.news_articles
  add column article_type varchar(10) not null default 'news';

alter table idoc.news_articles
  add column thumbnail_url text;

alter table idoc.news_articles
  add constraint news_articles_type_check check (article_type in ('news', 'blog'));

create index news_articles_type_publication_idx
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
  drop constraint administrator_table_preferences_identifier_check;
alter table idoc.administrator_table_preferences
  add constraint administrator_table_preferences_identifier_check
  check (table_identifier in ('memberships', 'support', 'news', 'seminars', 'seminar_registrations'));
