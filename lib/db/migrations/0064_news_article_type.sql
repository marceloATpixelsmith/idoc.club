alter table idoc.news_articles
  add column article_type varchar(10) not null default 'news';

alter table idoc.news_articles
  add constraint news_articles_type_check check (article_type in ('news', 'blog'));

create index news_articles_type_publication_idx
  on idoc.news_articles (article_type, status, publication_date);
