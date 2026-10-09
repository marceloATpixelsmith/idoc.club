alter table idoc.news_articles
  add column if not exists external_url text;

alter table idoc.news_articles
  drop constraint if exists news_articles_external_url_check;

alter table idoc.news_articles
  add constraint news_articles_external_url_check
  check (external_url is null or external_url ~* '^https?://');

alter table idoc.news_articles
  drop constraint if exists news_articles_content_length_check;

alter table idoc.news_articles
  add constraint news_articles_content_length_check
  check (
    (external_url is null and char_length(content_html) between 1 and 20000)
    or
    (external_url is not null and char_length(content_html) between 0 and 20000)
  );
