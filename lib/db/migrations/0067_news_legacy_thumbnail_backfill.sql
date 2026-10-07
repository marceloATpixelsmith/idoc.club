-- Backfill legacy News/Blog thumbnails in environments where migration 0064 was
-- already recorded before its legacy thumbnail data assignments were added.
-- Only NULL thumbnail_url rows are changed so administrator-selected replacements
-- are never overwritten.

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
where thumbnail_url is null
  and (
    lower(title) like '%jacques van daele%'
    or slug in ('in-memoriam-jacques-van-daele','in-memoriam-jacques-van-daele-1953-2026')
    or lower(title) like '%stephen clarke%'
    or slug in ('in-memoriam-stephen-clarke','in-memoriam-stephen-clarke-1952-2026')
    or lower(title) like '%judging guidelines%'
    or slug in ('fei-judging-guidelines','how-to-apply-the-fei-judging-guidelines-on-tension-submission-acceptance-of-the-contact-and-harmony')
    or lower(title) = 'fei rules revision'
    or slug = 'fei-rules-revision'
    or lower(title) like 'modern dressage judging:%'
    or slug in ('modern-dressage-judging','modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen')
    or lower(title) = 'new research on stress in dressage horses'
    or slug in ('stress-in-dressage-horses','new-research-on-stress-in-dressage-horses')
    or lower(title) = 'integrity beyond compliance'
    or slug = 'integrity-beyond-compliance'
  );
