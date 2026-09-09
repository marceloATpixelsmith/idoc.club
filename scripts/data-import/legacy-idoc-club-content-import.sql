-- Legacy content import: IDOC News, President's Blog, and Seminars from idoc.club (WordPress)
-- ============================================================================================
--
-- Source: the live legacy WordPress site at https://idoc.club (WordPress REST API,
-- https://idoc.club/wp-json/wp/v2/posts), fetched and transcribed on 2026-09-09.
--
-- The legacy site stores all three content types as WordPress "posts", distinguished only by
-- category:
--   - category "homepage-news" (27 posts, 26 imported -- see point 5) -> idoc.news_articles
--         (public IDOC News)
--   - category "president-blog" (7 posts)   -> idoc.news_articles  (President's Blog; the new
--         schema has one unified News/Blog table -- see docs/01-solution-architecture-and-
--         data-model.md and docs/08-product-roadmap-and-functional-requirements.md, "an
--         initial, unified News/Blog article slice"). The public /blog page currently renders a
--         hardcoded array (lib/content/site.ts) rather than querying this table; wiring that page
--         to idoc.news_articles is a separate application change, outside this data import.
--   - category "seminars" (4 posts)         -> idoc.seminars
-- These three category sets are mutually exclusive and exhaustive across the 38 published posts
-- on the legacy site as of the fetch date.
--
-- Every full article/post body was fetched individually (not just index/excerpt data) and:
--   - content_html for idoc.news_articles was passed through the exact tag allowlist used by
--     lib/news/sanitize.ts (a/blockquote/br/code/em/h2/h3/h4/hr/li/ol/p/pre/strong/ul, with
--     b->strong, i->em, h1->h2, h5->h3, h6->h4, and script/style/iframe/object/embed/svg/math
--     removed entirely including their contents) so the stored value already matches what the
--     application would itself persist on save.
--   - idoc.seminars.description is a plain-text column (not HTML); each seminar's legacy post
--     body was converted to readable plain text and prefixed with its original source URL.
--   - Titles/subtitles were entity-decoded to plain text. Where a legacy title embedded a byline
--     via "<br/>by <author>" (mostly the President's Blog posts), the title and byline were split;
--     the byline became the article's `subtitle`. Where no byline was present, `subtitle` falls
--     back to the legacy WordPress excerpt (trimmed to fit the 300-character column limit).
--
-- IMPORTANT -- read before running:
--
-- 1. idoc.seminars has no source data on the legacy site for several NOT NULL columns, because
--    the legacy site only ever published narrative course announcements, not a structured
--    registration record. Every such value is marked "ASSUMPTION" in scripts/data-import
--    generation (see the per-row SQL comments below) and MUST be reviewed by an administrator
--    before the imported seminars are relied on for real registrations:
--      - start_time / end_time: no time-of-day was ever published; defaulted to 09:00-17:00.
--      - registration_deadline: defaulted to 14 days before the seminar where the source gave no
--        explicit application deadline.
--      - payment_method_canonical_id: the legacy site could list multiple payment options (or an
--        external third-party payment link) per seminar, but this schema allows only one
--        canonical method per seminar row; the closest match was chosen.
--      - Two of the four seminars were multi-day events on the legacy site (e.g. "June 27th-28th,
--        2026"); idoc.seminars has only a single `seminar_date` column, so `seminar_date` holds
--        the first day and the full date range is preserved in the `description` text.
--
-- 2. created_by_user_id / updated_by_user_id (idoc.news_articles and idoc.seminars) are NOT NULL
--    foreign keys to idoc.users with no legacy equivalent (the legacy WordPress authorship isn't
--    a member of this system). This script resolves an existing administrator or super_admin
--    automatically via the _import_admin temp table below and aborts loudly if none exists --
--    it never fabricates a user. Run this only after at least one administrator account exists
--    in the target database.
--
-- 3. This script is idempotent: idoc.news_articles rows use ON CONFLICT (slug) DO NOTHING (slugs
--    are the legacy WordPress slugs, already unique on the source site), and idoc.seminars rows
--    use a WHERE NOT EXISTS guard keyed on (title, seminar_date) since that table has no unique
--    business key. Re-running this script after a partial run will not create duplicates. Each
--    insert is wrapped in a `WITH ins AS (INSERT ... RETURNING ...)` CTE so a row skipped by one
--    of those guards also skips its idoc.audit_log entry (point 6) -- audit rows are written only
--    for rows this run actually created.
--
-- 4. Most imported rows are inserted with status='published' (mirroring their live status on the
--    legacy site) using the legacy post's original UTC publish timestamp
--    (publication_date/published_at for news_articles). Two seminars are the exception -- see
--    point 7. This is a one-time data import, NOT a numbered schema migration (see
--    lib/db/migrations/ + tests/migration-immutability.test.ts) and should be run by hand against
--    the target database once, after migrations 0040 and 0041 are applied.
--
-- 5. One homepage-news post, "ga-assembly2024" (IDOC/FEI Seminar Frankfurt + General Assembly
--    Program 2024), is intentionally excluded. Its legacy page body is a MemberPress
--    "you are unauthorized to view this page unless you are a member" placeholder -- the real,
--    member-gated content was never exposed to the public REST API this import reads from, and
--    publishing that placeholder as if it were the article would be actively misleading. Someone
--    with legacy site admin/member access should pull that page's real body and add it separately.
--
-- 6. Every row this script actually inserts also gets one idoc.audit_log row, matching the
--    'admin.news_article.created' / 'admin.seminar.created' actions and after_json shape that
--    lib/news/articles.ts / lib/seminars/seminars.ts themselves write on creation, attributed to
--    the same resolved administrator, so the import leaves the same evidence trail a normal
--    admin-authored create would.
--
-- 7. Both Hartpury Para Dressage courses (wp post ids 3242, 3244) stated their legacy course fee
--    in GBP 150, not EUR. idoc.seminars has no currency column -- docs/07-administrator-and-
--    operations-runbook.md documents seminar price as EUR, and lib/seminars/checkout.ts hard-codes
--    Stripe currency:'eur' -- so storing 150 as price_cents=15000 would silently sell a GBP 150
--    course for EUR 150. Both rows are therefore imported with status='draft' (never public,
--    never open for registration) rather than 'published', with the GBP amount preserved as-is in
--    price_cents/description for an administrator to correct (and republish) once a real
--    EUR-equivalent price and payment route are decided.
--
-- Usage: psql "$DATABASE_URL" -f scripts/data-import/legacy-idoc-club-content-import.sql

BEGIN;

CREATE TEMP TABLE _import_admin AS
SELECT ar.user_id AS id
FROM idoc.application_roles ar
WHERE ar.role IN ('super_admin', 'administrator') AND ar.revoked_at IS NULL
ORDER BY (ar.role = 'super_admin') DESC, ar.user_id ASC
LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _import_admin) THEN
    RAISE EXCEPTION 'No administrator or super_admin user found in idoc.application_roles -- create one before running this import.';
  END IF;
END $$;


-- IDOC News (legacy category: homepage-news) (26 rows) -----------------------------------------------------------
-- source: https://idoc.club/tips-for-both/ (wp post id 779)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'tips-for-both',
    'Tips for both Judges and Stwewards',
    'When you look at our “colleagues” – the riders and the trainers club, they have shown that our dressage community needs something, which is not the FEI, to connect them.',
    '<p>When you look at our “colleagues” – the riders and the trainers club, they have shown that our dressage community needs something, which is not the FEI, to connect them. The IDOC works for all officials involved in dressage. We have the sport and discipline as a common interest, even though we work in different parts of “stage”.</p>
<p>We have to work hard on communication and education, on all levels.</p>
<p>We have to work together, not only with the FEI but also in close connection with the Judge General, to keep the line in judging and stay true to the good system we already have, but we are also obliged to look into other and new ways on how to improve the sport. I think for all officials the welfare of the horse is paramount and it will always be important to work close together with all involved parties to keep up with the highest standards in this regard.</p>
<p><strong><em>Hans-Christian Matthiesen, <br>IDOC President</em></strong></p>',
    'published',
    '2017-02-06T22:32:00Z'::timestamptz,
    '2017-02-06T22:32:00Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idoc-importance-potential/ (wp post id 2384)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idoc-importance-potential',
    'IDOC Importance & Potential',
    'When you look at our “colleagues” – the riders and the trainers club, they have shown that our dressage community needs something, which is not the FEI, to connect them.',
    '<p>When you look at our “colleagues” – the riders and the trainers club, they have shown that our dressage community needs something, which is not the FEI, to connect them. The IDOC works for all officials involved in dressage. We have the sport and discipline as a common interest, even though we work in different parts of “stage”.</p>
<p>We have to work hard on communication and education, on all levels.</p>
<p>We have to work together, not only with the FEI but also in close connection with the Judge General, to keep the line in judging and stay true to the good system we already have, but we are also obliged to look into other and new ways on how to improve the sport. I think for all officials the welfare of the horse is paramount and it will always be important to work close together with all involved parties to keep up with the highest standards in this regard.</p>
<p><strong><em>Hans-Christian Matthiesen,<br>
IDOC President</em></strong></p>',
    'published',
    '2023-07-10T21:38:58Z'::timestamptz,
    '2023-07-10T21:38:58Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idoc-seminar-for-judges-young-horses-in-ermelo/ (wp post id 2739)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idoc-seminar-for-judges-young-horses-in-ermelo',
    'IDOC seminar for Judges (Young Horses) in Ermelo',
    'August 3-6, twenty eight FEI and National ‘S’ judges made their way from the Americas (North, Central, and South) to attend a continuing judges’ education seminar, graciously supported by IDOC,',
    '<p>August 3-6, twenty eight FEI and National  ‘S’ judges made their way from the Americas (North, Central, and South) to attend a continuing judges’ education seminar, graciously supported by IDOC, at the World Longine’s FEI World Breeding Dressage Championships for Young Horses in Ermelo,  The Netherlands. Over the course of three long, action packed days, Dutch FEI 5*/Level 4 judge, Mariette Saunders, conducted a fantastic educational forum. Her enthusiasm, knowledge and experience, humor and honest evaluations of each horse and rider were greatly appreciated by the group. Her openness to discussion, and to answering all of our questions helped us see, and better discern the details in using the correct score range and to better give meaningful remarks in our own judging of Young Horses.</p>
<p>We looked not only in depth at the scores for each of the Gait boxes, but also at the scores for the Submission and the Perspective boxes. We were certainly exposed to the whole gamut of gaits, different conformations, temperaments and types of horses, as well as a good variety of the many things that can happen, good and bad, in the young horse tests! We got a lot of opportunities to use the 5-10 score range, but we especially enjoyed the opportunity to see <strong>so many</strong> quality horses which enabled us to practice seeing the nuances in the 8, 9, and 10 range. This, in particular, was very appreciated by our group who often, where we all live, see very few Young Horse Tests, let alone many of good to excellent quality.</p>
<p>The facility, footing, and infrastructure at Ermelo made it a very enjoyable experience, despite Mother Nature being very moody, with an ever changing mix of rain, sun, downpours, lightning and thunder.  The covered spectators’ area kept us dry and afforded us an excellent view of the action in the main area. (A CDI and some of the small final classes were held in another arena on the facility.) Also of note was the fabulous DJ who mixed music on the spot for each horse throughout the weekend, greatly enhancing the performances, and experience; as well as the treat of having the start list as well as the score board and announcer giving the pedigree and breeder of each horse, as well as the rider, owner, and breed registry, and country it was representing.</p>
<p>The First Qualification classes were huge, with 40-45 horses in them.  From that class at each age range, the horses placing 12th and above went on to directly compete in the Finals, and the remainder went on to show in the Small Finals (consolation test) where the top three placings there could earn their way back to join the top 12 from the original test in the finals.  It made for some very competitive and exciting competition!  We were able to watch the 4 year olds (which was offered by the show as not part of the FEI Championships, but rather a national class, with horses from many countries there competing), as well as the FEI World Championship’s Competitions for 5, 6, and 7 year old horses.</p>
<p>Days were long, but somehow Mariette’s voice held out and her palpable enthusiasm didn’t wane. She stated that judging the final classes here was “like being in a candy shop”, and that it was! We enjoyed a constant stream of amazing horses representing countries across the globe, as well as a gathering of many of the dressage world’s elite, with not only top riders and horses, but trainiers, judges, and breeders in attendance. We were treated to some moments and performances that gave us goosebumps and even brought us, and our instructor, to tears–not easy to do with a group of people that has been judging for decades!</p>
<p>We greatly appreciated seeing the competition emphasis being on rewarding not only top athletes with quality <em>natural</em> gaits, but also in recognizing correct training and development, harmony, and confidence in the horses.  Mechanical and manufactured gaits, rider induced tension, and training not reflecting the classical pyramid was clearly not earning high marks.</p>
<p>The resounding feedback from the group was that they would return in a heartbeat should another opportunity for a forum at this championship happen in the future! Many thanks to Janet Foy, who not only envisioned this fabulous opportunity for those of us from the American continents, but who, along with her travel agent, Pam Chesnut, arranged it; to Mariette Sanders who went above and beyond in sharing her knowledge; and to Kristi Wysocki and Kari McClain who helped things run smoothly for the participants on site, as Janet was quite busy as part of the official judging panel for this event.  Thanks also to the following participants who took this opportunity  to expand their knowledge, at their own expense, and admirably for no credit of any kind. From the USA: Gary Rockwell, Jeanne McDonald, Kari McClain, Kristi Wysocki, Charlie Musco, Cindy Canace, David Schmutz, Lisa Schmidt, Nancy Benton, Sandy Hotz, Louise Koch, Sarah Geike, Debby Savage, Elizabeth Kane, Jodi Jones Lees, Sue Mandas, Christel Carlson, Agnes Billington; From Canada: Cara Whitham, Ali Buchanan, Joan McCartney, Brenda Minor, John MacPherson; From Columbia: Cesar Torrente; From Peru: Marian Cuningham; From Argentina: Sandra Smith, Gabriel Armando, Constanza Comaleras.</p>',
    'published',
    '2023-08-11T17:23:56Z'::timestamptz,
    '2023-08-11T17:23:56Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/15-principles-for-horse-welfare/ (wp post id 2918)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    '15-principles-for-horse-welfare',
    '15 Principles for Horse Welfare',
    'Assure that essential individual indicators for animal welfare are met based on the 5 domains of 1. nutrition 2. physical environment 3. Health 4. interactions with environment, other animals,',
    '<ol>
<li>Assure that essential individual indicators for animal welfare are met based on the 5 domains of  1. nutrition 2. physical environment 3. Health 4. interactions with environment, other animals, humans and Mental state. These factors should not be resource based or limited.</li>
<li>Commit to respect every horse equally regardless of its use (breeding, recreation, or sport) and ensure that training and performance objectives are consistent with the individual’s genetic potential, temperament, and development.</li>
<li>Commit to the need for ongoing training of the horse, its rider and all its handlers to achieve the best possible interaction between horse and man.</li>
<li>Recognize that the horse is a social, sentient, and neotenic animal and be alert to the physical, emotional, and intellectual implications of these characteristics.</li>
<li>Appreciate the character-building, emotional, and physical benefits of dealing with horses especially for young people and those with mental or physical disabilities.</li>
<li>Commit in training to utilize natural behaviors to enhance the horse’s ability to understand the human objective.</li>
<li>Accept the responsibility for the wellbeing of the horse throughout its entire life including after its sporting career has ended and until death. All decisions must be made in the best interest of the horse, informed by the most recent advice available.</li>
<li>Promise never to discipline out of anger or frustration.</li>
<li>Pledge strict adherence to all anti-doping regulations and procedures.</li>
<li>Ensure prompt and appropriate treatment in case of injury or illness.</li>
<li>Dutifully display characteristics of good sportsmanship and strive to present equestrian sport favorably at competitions.</li>
<li>Require that all regulations related to horse welfare are based on sound scientific evidence and are scrutinized and approved by the FEI Veterinary Committee. Recognize knowledge regarding horses and their wellbeing is incomplete and be open-minded to new scientific evidence.</li>
<li>Commit to being transparent and Demonstrate a willingness to engage with all stakeholders (including the public) to enhance understanding of equine welfare and recognize the legitimacy of differing opinions.</li>
<li>Appreciate and disseminate the history of the horse and the role it plays in our cultural heritage.</li>
<li>Enhance the positive contributions of equestrian sport to people and the environment.</li>
</ol>',
    'published',
    '2023-10-10T22:42:55Z'::timestamptz,
    '2023-10-10T22:42:55Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idoc-general-assembly-fei-refresher-seminar/ (wp post id 2942)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idoc-general-assembly-fei-refresher-seminar',
    'IDOC General Assembly &  FEI Refresher Seminar',
    'On behalf of IDOC President, Hans-Christian Matthiesen, it is a great pleasure to invite you all to the 2023 International Dressage Officials Club General Assembly + FEI/IDOC Seminar, which will',
    '<p>On behalf of IDOC President, Hans-Christian Matthiesen, it is a great pleasure to invite you all to the 2023 International Dressage Officials Club General Assembly + FEI/IDOC Seminar, which will take place during the CDI 5* Frankfurt, 15-17 December 2023.</p>
<p><strong>GENERAL ASSEMBLY DETAILS</strong></p>
<ul>
<li><strong>Date and Time:</strong> The assembly will take place on Friday, December 15th, 2023, at 15:00.</li>
<li><strong>Location:</strong> Gestüt Schafhof.</li>
<li><strong>Accommodation:</strong> The Marriott Frankfurt is the official show hotel. I will send you the link with a special rate shortly. Additionally, numerous other hotels catering to various budgets are available within walking distance from the Festhalle.</li>
<li><strong>Transport:</strong> We will arrange transportation to and from the Internationales Festhallenreitturnier showground. Further practical details will be provided shortly.</li>
<li><strong>Agenda:</strong> Apart from the GA itself, IDOC traditionally invites guest speakers to give short presentations on relevant subjects. This year our guests and their talking points will be:
<ul>
<li>Ronan Murphy, FEI new Dressage, Para Dressage and Vaulting Director: “FEI news and updates”</li>
<li>Dr. Inga A. Wolframm, Van Hall Larenstein University of Applied Sciences: “Bias in judging”</li>
<li>Daniel Göheln, BlackHorseOne: “The need for a statistical threshold/cut off for good/bad judging”</li>
<li>Lisa Goretta and Dianna Muennich (FEI Dressage Stewards): “Difficult situations at competitions and how to deal with them”</li>
</ul>
</li>
</ul>
<p>IDOC SEMINAR DETAILS</p>
<p>In keeping with tradition, IDOC in collaboration with FEI, will be hosting a seminar during the CDI 5* Frankfurt. This will commence on <strong>Friday, December 15th at 8am and conclude by lunchtime on Sunday, December 17th.</strong></p>
<p><strong><br>
FEI IN-PERSON MAINTENANCE COURSE DETAILS</strong></p>
<p>The judges who need to take this course should apply through your National Federation directly via the FEI Database Course Calendar (<a href="https://club.us10.list-manage.com/track/click?u=90a83c0c39aeed03f1aa265cb&amp;id=653a8be9c5&amp;e=6e737bf937">download invitation</a>). If you have any questions regarding registration, please contact <a href="mailto:anna.milne@fei.org">anna.milne@fei.org</a>.  Be aware that the deadline to apply to the FEI Seminar was postponed to 15 November 2023.  For the video assessment &amp; theory session (Saturday afternoon at the showground), please bring your own devices (computers, tablets, smartphones should work too).</p>
<p><a href="https://idoc.club/documents/general-assembly/2023-IDOC-General-Assembly-Preliminary-Program.pdf">IDOC General Assembly 2023 – Preliminary Program </a></p>',
    'published',
    '2023-10-25T14:56:58Z'::timestamptz,
    '2023-10-25T14:56:58Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/paris2024-olympic-games/ (wp post id 2948)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'paris2024-olympic-games',
    'Paris2024 OLYMPIC GAMES',
    'INTERNATIONAL TECHNICAL OFFICIALS DRESSAGE: Ground Jury President Raphaël Saleh (FRA) Member: Henning Lehrmann (GER) Member: Isobel Wessels (GBR) Member: Mariette Sanders (NED) Member: Magnus Ringmark (SWE) Member: Michael Osinski (USA)',
    '<p><strong>INTERNATIONAL TECHNICAL OFFICIALS </strong></p>




<p><strong>DRESSAGE: Ground Jury President </strong></p>


<p>Raphaël Saleh (FRA)</p>


<p>




<p><strong>Member: </strong></p>


<p>Henning Lehrmann (GER)</p>


<p>




<p><strong>Member: </strong></p>


<p>Isobel Wessels (GBR)</p>


<p>




<p><strong>Member: </strong></p>


<p>Mariette Sanders (NED)</p>


<p>




<p><strong>Member: </strong></p>


<p>Magnus Ringmark (SWE)</p>


<p>




<p><strong>Member: </strong></p>


<p>Michael Osinski (USA)</p>


<p>




<p><strong>Member: </strong></p>






<p>Susanne Baarup (DEN)</p>









<p><strong>JSP Member: </strong></p>


<p>Andrew Gardner (GBR)</p>


<p>




<p><strong>JSP Member: </strong></p>


<p>Mary Seefried (AUS)</p>


<p>




<p><strong>JSP Member: </strong></p>






<p>Henk van Bergen (NED)</p>









<p><a href="https://idoc.club/documents/news/Paris2024-ITOs-12-October2023-1.pdf">Paris2024 – ITOs- 12 October2023 (1)</a></p>',
    'published',
    '2023-10-25T15:37:48Z'::timestamptz,
    '2023-10-25T15:37:48Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/2965-2/ (wp post id 2965)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    '2965-2',
    'Young Horses Seminar (5 & 6 YO) With  Mariette Sanders- Van Gansewinkel',
    'On the 28th of November 2023 we would like to invite you to our Young Horses Seminar. 19:00 CET Together we are discussing the requirements to judge Young Horse classes,',
    '<p>On the 28th of November 2023 we would like to invite you to our Young Horses Seminar. 19:00 CET</p>
<p>Together we are discussing the requirements to judge Young Horse classes, which involves judging some videos of Young Horses followed by a detailed evaluation.</p>
<p>Our partner Black Horse One offers the option to judge on <a href="https://equestrian-hub.com/">www.equestrian-hub.com</a>. For this your own device is required, which can be a phone, tablet or laptop with the recommended browser Google Chrome.</p>
<p>After your Registration you will find a test/practice protocol in the to do list on the left of your Dashboard. The tutorial attached guides you through the process of of getting you set up and giving marks and comments.</p>
<p>Here is your most important link:</p>
<ul>
<li><a href="https://equestrian-hub.com/">Equestrian Hub</a> (For registration and your own judging)
<ul>
<li>Questions? Ask us anytime:mariette@sangan.demon.nl<a href="mailto:ozayrik@gmail.com">ozayrik@gmail.com</a></li>
</ul>
</li>
</ul>
<p>Thank you and see you soon!</p>',
    'published',
    '2023-11-09T02:01:40Z'::timestamptz,
    '2023-11-09T02:01:40Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/para-dressage-seminar-judges-stewards-with-marco-orsini-katarzyna-widalska/ (wp post id 2972)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'para-dressage-seminar-judges-stewards-with-marco-orsini-katarzyna-widalska',
    'Para Dressage  Seminar Judges & Stewards with Marco Orsini & Katarzyna Widalska',
    'The seminar is open to all national and international dressage and para dressage judges and stewards who wish to understand the differences between dressage and para dressage rules from the',
    '<p>The seminar is open to all national and international dressage and para dressage judges and stewards who wish to understand the differences between dressage and para dressage rules from the perspective of an official. Participants will have the opportunity to discuss the requirements for judging para dressage classes and assess the quality of performance of movements,</p>
<p>with particular emphasis on grades I, II, and III.</p>
<p>December 5, 2023</p>
<p>13:00-17:30 CET ZOOM</p>
<p>Info:  k.widalska@o2.pl</p>',
    'published',
    '2023-11-09T02:25:11Z'::timestamptz,
    '2023-11-09T02:25:11Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-news/ (wp post id 3006)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-news',
    'FEI News',
    'In this edition of the FEI Newsletter: New Travel Insurance Partner, Key Event Requirements (KERs) System, FEI sets criteria for participation of Russian and Belarusian Athletes, Horses and Officials in',
    '<p><strong>In this edition of the FEI Newsletter:  </strong>New Travel Insurance Partner,  Key Event Requirements (KERs) System,  FEI sets criteria for participation of Russian and Belarusian Athletes, Horses and Officials in FEI Events</p>
<p><a href="https://idoc.club/documents/news/Federation-Equestre-Internationale.pdf">DOWNLOAD &gt;&gt;</a></p>',
    'published',
    '2023-12-30T19:31:32Z'::timestamptz,
    '2023-12-30T19:31:32Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/joint-statement-from-stakeholders/ (wp post id 3032)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'joint-statement-from-stakeholders',
    'Joint Statement From Stakeholders',
    'Joint Statement by the IDTC, IDRC, and IDOC',
    '<p>Joint Statement by the IDTC, IDRC, and IDOC</p>
<a href="https://idoc.club/documents/news/JOINT-STATEMENT-FROM-STAKEHOLDERS-Feb-2024.pdf">JOINT STATEMENT FROM STAKEHOLDERS Feb 2024</a>',
    'published',
    '2024-02-21T17:23:54Z'::timestamptz,
    '2024-02-21T17:23:54Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idoc-general-assembly-2024/ (wp post id 3091)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idoc-general-assembly-2024',
    'IDOC General Assembly 2024 – Save the Date',
    'On behalf of IDOC President, Hans-Christian Matthiesen, it is a great pleasure to invite you all to save the date for this years assembly. DECEBMER 19th to 21st, 2024 Details',
    '<p>On behalf of IDOC President, Hans-Christian Matthiesen, it is a great pleasure to invite you all to save the date for this years assembly.</p>
<p>DECEBMER 19th to 21st, 2024</p>
<p><strong>Details to come!</strong></p>',
    'published',
    '2024-03-25T22:05:29Z'::timestamptz,
    '2024-03-25T22:05:29Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-tack-update/ (wp post id 3108)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-tack-update',
    'Update on the FEI TACK, Equipment & Dress Database',
    'Please be informed that the next update of the FEI Tack, Equipment & Dress Database (FEI Tack App) will be released after the Easter holidays, on 8 April 2024. Further to',
    '<p>Please be informed that the next update of the FEI Tack, Equipment &amp; Dress Database (FEI Tack App) will be released after the Easter holidays, <strong>on 8 April 2024.</strong></p>
<p>Further to feedback received from numerous Athletes and Officials, who are seeking clarity regarding the use of tack and equipment during the Olympic &amp; Paralympic Games in Paris 2024, the FEI agreed that this would be the last update of the FEI Tack App prior to the Games.</p>
<p>The temporary pause of updates to the FEI Tack App will be applied to all FEI Disciplines, including non-Olympic Disciplines.</p>
<p>Following the conclusion of the Olympic &amp; Paralympic Games in Paris 2024, the updates shall resume on every first Monday of the month, as per the usual process.</p>
<p><em>FEI Press Release</em></p>',
    'published',
    '2024-04-09T18:41:26Z'::timestamptz,
    '2024-04-09T18:41:26Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-update-official/ (wp post id 3111)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-update-official',
    'FEI Update – Official',
    'FEI President Ingmar De Vos elected unanimously as President of the Association of Summer Olympic International Federations The election – which was unanimous – took place at the Association of',
    '<h2><strong>FEI President Ingmar De Vos elected unanimously as President of the Association of Summer Olympic International Federations</strong></h2>
<p>The election – which was unanimous – took place at the Association of Summer Olympic International Federations (ASOIF) 48th General Assembly at SportAccord World Sport &amp; Business Summit, the world’s most influential sport industry gathering, in Birmingham on 9 April 2024.</p>
<p>“I hope to build on the legacy created by Francesco Ricci Bitti and I will make it my mission to continue strengthening the role of the Summer International Sports Federations in the Olympic Movement.” FEI President, Ingmar De Vos (BEL)</p>
<p>Read the full press release <a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=3957c291d7&amp;e=81d9588f38">here</a>.</p>
<h2>Get ready for the FEI World Cup™ Finals 2024, Riyadh (KSA)</h2>
<p>The Longines FEI Jumping and the FEI Dressage World CupTM Finals, taking place in Riyadh (KSA) from 16 to 20 April 2024, are just around the corner! This will be the inaugural occasion for the FEI World Cup™ Finals to be held in Asia for Dressage, and the second time for Jumping since the finals held in Kuala Lumpur, Malaysia in 2006. Additionally, it will mark the premiere of both the Longines FEI Jumping World Cup™ Final and the FEI Dressage World Cup™ Final in the Middle East region.</p>
<p>The Finals will bring together 51 athletes in the two disciplines: Jumping (34), Dressage (17) in a bid to claim one of the most prestigious trophies in the equestrian world.</p>
<p>Discover the participating athletes and horses right here:</p>
<ul>
<li><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=9000e6ca43&amp;e=81d9588f38">Longines FEI Jumping World Cup™ Final</a></li>
<li><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=6cecc0df98&amp;e=81d9588f38">FEI Dressage World Cup™ Final</a></li>
</ul>
<p>As always, you can follow all the action live on <a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=e343a5baf7&amp;e=81d9588f38">FEI.tv</a>.</p>
<p>To stay up to date on the latest news from the FEI World CupTM Finals 2024 click here and for all further information we invite you to visit the the <a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=8f68fb1af4&amp;e=81d9588f38">FEI World Cup™ Finals 2024</a> website.</p>
<h2>FEI Tack App – Last update before Paris 2024</h2>
<p>Please be informed that the last update of the FEI Tack, Equipment &amp; Dress Database (FEI Tack App) was released after the Easter holidays, on 8 April 2024.</p>
<p>Further to feedback received from numerous Athletes and Officials, who are seeking clarity regarding the use of tack and equipment during the Olympic &amp; Paralympic Games in Paris 2024, the FEI agreed that this would be the last update of the FEI Tack App prior to the Games. The temporary pause of updates to the FEI Tack App will be applied to all FEI Disciplines, including non-Olympic Disciplines.</p>
<p>Following the conclusion of the Olympic &amp; Paralympic Games in Paris 2024, the updates shall resume on every first Monday of the month, as per the usual process.</p>
<p>See more <a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=55c576a325&amp;e=81d9588f38">here</a>.</p>
<h2>Did you know that ponies may be tested during Pony Measuring Sessions?</h2>
<p>In order for ponies to be allowed to take part in FEI Pony Competitions they need to be of regulatory height. Height does matter!</p>
<p>All ponies presented at FEI Pony Measuring Sessions may be subject to sampling under the FEI’s Equine Anti-Doping and Controlled Medication Regulations (EADCMRs) from the time of their arrival at the Pony Measuring Station until their departure.</p>
<p>Ponies are considered as being “In-Competition” while at FEI Pony Measuring Sessions and must therefore be free from Prohibited Substances. A positive test may lead to the invalidation of the result of the relevant pony measurement. Testing is in place in order to protect the welfare of the ponies and prevent the use of Prohibited Substances and/or Methods in an attempt to try and affect the measuring result.</p>
<h2>FEI DIRECTORY</h2>
<p>Updates to the FEI Database</p>
<p>Monthly summary on the key changes/updates in the FEI Database with regards to the FEI’s member National Federations. All details can be found on the FEI Database by clicking on each NF’s name listed below:</p>
<p><strong><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=5ffd39490d&amp;e=81d9588f38">BER – BERMUDA EQUESTRIAN FEDERATION</a></strong><br>
Mr Colin SIMONS has been elected President of the NF.</strong></p>
<p><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=256657c9e0&amp;e=81d9588f38">ESA – FEDERACIÓN SALVADOREÑA DE ECUESTRES</a></strong><br>
Mr José DIMAS ROMANO and Ms Melissa BUSTAMANTE have been elected respectively President and Secretary General of the NF.</p>
<p><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=dc5b7fc3a6&amp;e=81d9588f38">GEO – NATIONAL EQUESTRIAN FEDERATION OF GEORGIA </a></strong><br>
Mr Shalva GACHECHILADZE and Mr Tomike GACHECHILADZE have been elected respectively President and Secretary General of the NF.</p>
<p><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=0dc14e8a2d&amp;e=81d9588f38">IRI – EQUESTRIAN FEDERATION OF THE ISLAMIC</a></strong><br>
Mr. Mohammad KAZEMIAN has been elected President of the NF.</p>
<p><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=f73e4d2cba&amp;e=81d9588f38">PHI – EQUESTRIAN ASSOCIATION OF THE PHILIPPINES</a></strong><br>
Mr Steven Cesar Gamboa VIRATA has been elected President of the NF.</p>
<p><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=1df1cfb92a&amp;e=81d9588f38">TUR – TURKISH EQUESTRIAN FEDERATION</a></strong><br>
The NF has a new postal address.</p>
<p><strong><a href="https://fei.us2.list-manage.com/track/click?u=f3c033c6fc400852db8365079&amp;id=038e948a9f&amp;e=81d9588f38">UKR – UKRAINIAN EQUESTRIAN FEDERATION</a></strong><br>
Ms Kseniia MARTYNOVA has been elected Secretary General of the NF</p>',
    'published',
    '2024-04-10T19:57:30Z'::timestamptz,
    '2024-04-10T19:57:30Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/joint-stakeholder-club-meeting/ (wp post id 3115)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'joint-stakeholder-club-meeting',
    'Save the Date – Joint Stakeholder Club Meeting',
    'SAVE THE DATE Joint Stakeholder Club Meeting IDTC – IDRC – IDOC – DO 5-6 November 2024 Lier – Belgium The agenda will follow shortly',
    '<p><strong>SAVE THE DATE</strong></p>
<p>Joint Stakeholder Club Meeting<br>
IDTC – IDRC – IDOC – DO<br>
5-6 November 2024<br>
Lier – Belgium</p>
<p>The agenda will follow shortly</p>',
    'published',
    '2024-04-13T14:44:19Z'::timestamptz,
    '2024-04-13T14:44:19Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-sports-forum/ (wp post id 3119)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-sports-forum',
    'FEI Sports Forum',
    'LATEST INFORMATION ON FEI SPORTS FORUM 2024 With only a few days to go until the FEI Sports Forum 2024, which will be held on 29 and 30 April at',
    '<p><strong>LATEST INFORMATION ON FEI SPORTS FORUM 2024</strong></p>
<p>With only a few days to go until the FEI Sports Forum 2024, which will be held on 29 and 30 April at the prestigious IMD Business School in the Olympic capital Lausanne (SUI), we are pleased to provide you with the latest information about this important event.</p>
<p><strong>Timetable and logistical information</strong><br>
The event will begin on Monday, 29 April at 09.00 CEST and will end on Tuesday, 30 April at 17.00 CEST. The timetable along comprehensive logistical information is available in the dedicated online hub here.</p>
<p><strong>Supporting documents</strong><br>
Recently the hub has been updated with supporting documents for Session 1: Equine Ethics and Wellbeing Commission Final Report and proposed action plan and Session 6: Equity in equestrian: assessing gender equality across key roles and levels.</p>
<p>The Equine Ethics and Wellbeing Commission was created by the FEI in May 2022 and was tasked with providing independent advice and recommendations to the FEI for ensuring equine welfare is safeguarded through ethical, evidence-based policy and practices in relation to training, management, performance and competition practices, and to improve the sport’s social license to operate (SLO).</p>
<p>Over 18 months, the Commission, which was chaired by Natalie Waran, Professor of Animal Welfare, produced a report entitled “A Good Life for Horses: A vision for the future involvement of horses in sport” which is now available in the Session Documents section of the online hub. The report, which is the result of a large-scale consultation with the equestrian community through online surveys, a presentation to the FEI General Assembly 2022, FEI Sports Forum 2023 and discussions with the FEI Board, is a comprehensive document, which will be used as a basis for a presentation on a proposed action plan for the equestrian community led by the FEI and the ensuing discussion with the Sports Forum delegates.</p>
<p>The first document for Session 6, entitled “FEI Sports: Gender Statistics,” presents numerical data on gender distribution among athletes and FEI officials in Olympic and non-Olympic disciplines, along with gender ratios in related rankings, participation rates, and registrations. The second document offers a summary of insights from a recent research study on the Global Equestrian Market. This study examines the economic influence of equestrian sports, the worldwide fan base, the development of diverse target group segments, and some of the key benefits of equestrian sports for sponsors.</p>
<p><strong>Live broadcast</strong><br>
The FEI Sports Forum will be broadcast live and will be available to watch here. Those following the event remotely will be able to join the discussion through a live chat.</p>
<p>The sessions will also be available in replay mode after the end of the Sports Forum.</p>
<p><strong>Contact</strong><br>
For any queries on the FEI Sports Forum 2024, please contact feisportsforum@fei.org.</p>
<p>We encourage everyone to join us in person in Lausanne or follow online the proceedings and debates, which will be crucial for the future of equestrian sport.</p>',
    'published',
    '2024-04-26T17:02:56Z'::timestamptz,
    '2024-04-26T17:02:56Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/have-the-scores-gone-down/ (wp post id 3122)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'have-the-scores-gone-down',
    'Have the scores gone down?',
    'Maybe they have. The FEI invited all the stakeholder clubs to a meeting in Riyadh. It was a good meeting where we had the chance to discuss certain proposals for',
    '<p><strong>Maybe they have.</strong></p>
<p>The FEI invited all the stakeholder clubs to a meeting in Riyadh. It was a good meeting where we had the chance to discuss certain proposals for changes in dressage. An overall discussion of the direction of the sport and a good opportunity to sit together and balance expectations. Besides the FEI and the stakeholder club representatives (IDOC was represented by two judges and one steward) there was athletes representatives, board members, veterinary committee members, the President of the FEI and the FEI Dressage director.</p>
<p>In Hagen the IDRC called for a meeting with some riders and judges. Again a good opportunity to talk and discuss. The meeting was fruitful and we all agreed, that we would like to organize these meeting on a more regular basis. The idea is to come together as more united in the sport. Even if we sometimes have slightly different opinions, the discussions are important.</p>
<p>The format for the meetings might change, but the most important thing is to keep the momentum and the discussion going.</p>
<p>This weekend at the CDIO in Compiegne we also had a meeting with representatives from the FEI, Dressage committee, riders, trainers, chef d’equipes, organizers and judges (including the Ground Jury from Paris). Good and honest discussions about judging and other related points.</p>
<p>I think, I can speak for many judges, when I say that the current time is a “bit difficult”. At the present time our sport is under much scrutiny, and sadly for some negative reasons, as it is in relation to welfare.</p>
<p>Welfare is at the heart of our sport and, as judges, because we have the “best seats in the house”, we have responsibilities that come with our job.</p>
<p>When we are confronted with issues that might be of concern, then we need to seen to react.</p>
<p>We need to be better and stand up for the horse. We need to look forward into the future and start to embrace changes. The perception that we ignore symptoms of stress and negative tension in dressage is prevalent, both within the sport and among others on the periphery. What should weigh the most? The technically correct or the expressive, perhaps impressive, risk-taking ride ?</p>
<p>All officials are responsible for the Horse welfare. Some would even say, that we – as officials – play an important role and have the “key” to change !</p>
<p>This should not be seen as an excuse, because there is only one way forward, but for many years in dressage there has been too much focus on consensus in dressage judging, understood in the way that it has been considered a “wrong judgment” if there were too much difference or too much variation in the results.</p>
<p>Perhaps the time has come to change this perception. Perhaps we should call for more “straightforwardness” in the assessments, especially when it comes to the evaluation of stress symptoms and negative tension in dressage.</p>
<p>Remarks such as “short neck”, “tight in the back”, “tension”, “open mouth/visible tongue” are not uncommon in dressage. As an official, you of course have to assess whether it is momentary or whether it is a trend throughout the test. You have to look at the overall picture and if it is unsightly because of tension and resistance, then there must be a clear direction in your assessment. We can no longer use our “position” as an excuse, nor that the horse’s conformation is not optimal and perhaps makes it look partially “wrong” and therefore does not contribute to a better overall picture.</p>
<p>We must be better at assessing and prioritizing the Overall picture and Harmony. Signs of stress and discomfort (head and neck position: short, tight necks, open mouth, visible tongue (color), tight back, rhythm problems, uneven steps etc) must be given more weight in the grading. Whenever you see it as a judge, you must deduct and give a clear remark about it.</p>
<p>So yes, maybe the scores are lower now. For a good reason. Keep the focus…and the good work.</p>
<p>IDOC will keep you updated on the outcomings of the meetings. Good dialogue is the way forward.</p>
<p>Best regards,</p>
<p><strong>Hans Christian Matthiesen</strong><br>
IDOC President</p>',
    'published',
    '2024-05-05T18:40:45Z'::timestamptz,
    '2024-05-05T18:40:45Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idtc-meeting-save-the-date/ (wp post id 3176)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idtc-meeting-save-the-date',
    'IDTC Meeting – Save the Date',
    'November 5th 12.00 to November 6th 14:00 Location: KNHS De Beek 125 Ermelo, The Netherlands',
    '<a href="https://idoc.club/documents/news/IDTC-Meeting-Save-the-Date.pdf">IDTC Meeting Save the Date</a>',
    'published',
    '2024-11-02T20:09:17Z'::timestamptz,
    '2024-11-02T20:09:17Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/importance-of-ce/ (wp post id 3181)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'importance-of-ce',
    'The Importance of CE and In-Person Meetings',
    'Matthiesen wites about the role of the International Dressage Official Club (IDOC) and the obligation that comes with it. He reflects on IDOC’s presence with judges and steward seminars and exams recently held at the championship for young horses in Poland and last weekend at the first CDI-W in M...',
    '<p><em>Matthiesen wites about the role of the International Dressage Official Club (IDOC) and the obligation that comes with it. He reflects on IDOC’s presence with judges and steward seminars and exams recently held at the championship for young horses in Poland and last weekend at the first CDI-W in Mexico. </em></p>
<h3><strong>On the Importance of Continuing Education and In-Person Meetings for Officials</strong></h3>
<p>As part of an official activity, there is <strong>a mandatory obligation to educate yourself at all times</strong>. As an international official, the training is determined by the FEI and the Education plan; all depending on level, function and discipline.</p>
<p><strong>Adapt to Changing Times and Social Licence<br>
</strong>“Continuing education is more important than ever. The sport is criticized and the role as officials are under more pressure than before. The people’s attitude towards animal welfare changes over time and rules and guidelines must be adjusted and adapted to it so that <strong>social licence</strong>  and society’s acceptance of equestrian sport can be maintained. Many stakeholder groups have pointed out the <strong>important role of officials</strong> in this process. There must be clear guidelines that must be followed by everyone and be the same for the parties involved. Judges have different level of experience and knowledge. We need to fill in these gaps and provide them with efficient tools to assess and mark the movements, like they are supposed to. That is just some of the reasons why continuing education is so important.”</p>
<p>The trend in the sport changes with time, as does the quality of the horses and training. Right now it is vital to look into the future and get the focus back on the basic training of the horse. Important aspects in the perception of horse welfare must be simultaneously updated and integrated into the training of officials. Many initiatives have already been put in place and hard work is being done to develop the sport into a more future-proof and transparent version.</p>
<p><strong>Run and Done by Volunteers<br>
</strong>Since the corona epidemic hit, we have developed a good online concept which reaches as many officials as possible.; also for national officials, which are not yet part of the FEI family. Remember that many (most) pay for their education themselves. <strong>Acting as an official is a voluntary job</strong>, which is performed very professionally by many. As an international official, it is a long education that spans many years with many tests and exams. The quality of the courses and exams must be top notch, especially when people do this voluntarily without getting paid.</p>
<p><strong>IDOC is a non-profit organization</strong> and we are proud to say that we spend <strong>most of our budget on education for dressage officials</strong>. It is important for us to work together with the FEI, but also National Federations and the company BlackHorse have helped us a lot. The technical part today give us so many opportunities and possibilities for all the participants, online or in-person. We want to provide the officials with a professional set-up, which we can with the support of BlackHorse. We have currently started a more permanent online education system in cooperation with the company.</p>
<p><strong>More In-Person Meetings Need to be Organized<br>
</strong>Even though must of the theory part can be done with videos, it is still very crucial that we can organize these seminar during a competition. <strong>Online sessions can not replace in-person meetings</strong>. The competition makes the seminar so much more relevant for all parties and we need to host them across the globe, not just where the sport is centered in Western Europe. Other parts of the world need to be reached.</p>
<p>Luckily we have good cooperation with many show organizers, but we could still use more. We are depending on the organizers, not only for the seminars, but also when it comes to arranging “Sit-ins” and “shadow-judging” (part of the education plan and preparation for exams). Most mentor officials are happy to help, but not all organizers are positive and open towards the seminars or even the shadow judging, citing reasons (excuses?) such as space, time, or technical assistance in the show office. This is a pity and hinders progress.</p>
<p>At the end of the day, we are all depending on the continuing education of the officials, now maybe more than ever before.</p>
<p>IDOC will continue to work closely together with the FEI and the organizers. We work hard on getting more and more professional, with good course directors, good technical support and in the best surroundings. We owe it to the sport.</p>
<p><strong>Testimonials from…</strong></p>
<p><strong>Daniel Göhlen </strong>(GER) of BlackHorse stated, “we have now worked together with IDOC on many occasions, we have developed a great set-up and the exchange of ideas between us, makes it fantastic. We strive to develop the technical part of the education system. Giving the right support to the officials is very important to us. Both online education and in-person seminars works for us, no matter where in the world”.</p>
<p><strong>Omar Zayrik </strong>(MEX) is a 3* FEI judge, show director of the CDI-W Mexico, and IDOC board member. He said, “as a representative and official from the Central and South American region I know how important it is to have an in-person meeting and seminar in our region. The distances are big, so even if you come from the same region, you still have to fly 8 hours to get to a seminar. They are important not only for the international officials, but also the national judges. I am proud that we, with the help from sponsors Arquitectura Ecuestre and IDOC, organized one for dressage judges (with Raphael Saleh and HC Matthiesen as course directors) and stewards (with Dianna Muennich and Lisa Goretta as course directors).”</p>
<p><strong>Lukas Walter </strong>(POL) is a 3* FEI judge and IDOC member): “I have participated in many IDOC seminars, including the ones for my exams. IDOC has done a tremendous job, and for us it was a great pleasure and honor to organize, now for the second year in a row, the young horse seminar with exams in Radzionkow (course director: Raphael Saleh and HC Matthiesen) together with the Polish Equestrian Federation, the organizers of the YH championships, and IDOC. We had people attending from all parts of the world and we’ve got good feedback from the participants. It’s great to be able to give something back to the system, that has helped me a lot in my journey as an official.”</p>
<p><strong>IDOC</strong> added, “over the last years we organized good and popular seminars with National Federations (eg the Polish and Italian NFs), but also with private organizers (such as Schafhof Connect/Linsenhoff/Rath family in Kronberg, GER). Without them it would not have been possible for us to reach out to so many officials in such a professional way. Other players, like the European Equestrian Federation, could also be in on a future joint venture.”</p>',
    'published',
    '2024-11-15T18:36:33Z'::timestamptz,
    '2024-11-15T18:36:33Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-elections-2025/ (wp post id 3204)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-elections-2025',
    'FEI Elections & Appointments process 2025',
    'The process for candidatures for FEI Elections and Appointments 2025 is now officially open! There are 20 positions open to candidacies including Chairpersons for Regional Group V, Jumping, Dressage and Eventing Committees as well as open positions for Members of FEI Tribunal and for the followin...',
    '<p>Dear National Federations,</p>
<p>The process for candidatures for FEI Elections and Appointments 2025 is now officially open!</p>
<p>There are 20 positions open to candidacies including Chairpersons for Regional Group V, Jumping, Dressage and Eventing Committees as well as open positions for Members of FEI Tribunal and for the following committees: Jumping, Dressage, Para Equestrian, Eventing, Driving and Veterinary.</p>
<p>The complete list of positions including details on job specifications and the relevant procedures in terms of deadlines, timelines and candidate requirements are now available <strong><a href="http://tracking.fei.org/tracking/click?d=RUQ5_cDWKiEmQsftlB11D6fvMqpb-DvSJrFtoZCKKYyoOgGgjU64z9yJwkKTx8_n__RY3pgU3TOQ2lMsJu0XLM37J6YjMJThfatJ343i__meAul5kcg67iOfRbWvRLyEVH4GSMsg4Ie5UzXw0XS3YgYEgWuK-xClzqW55Pa4A5ghrkkyQ5e9L_gaJIBbIqw2Lg2">here</a> </strong><strong>on </strong><a href="http://inside.fei.org">inside.fei.org</a><strong>.</strong></p>
<p>The deadline to receive applications for all open positions is 1 May 2025 23:59 CEST and must be sent to <a href="mailto:elections&amp;appointments@fei.org">elections&amp;appointments@fei.org</a>.</p>
<p>Candidates for all the positions will be announced in June 2025.</p>
<p>The FEI is committed to diversity and inclusion within its workforce, and encourages all candidates, irrespective of gender, nationality, religious and ethnic backgrounds, including persons living with disabilities, to apply to become a part of the organisation.</p>
<p>If you have any questions do not hesitate to contact Francisco P. Lima, FEI Director Governance &amp; Institutional Affairs at <strong><a href="mailto:francisco.lima@fei.org?subject=Elections%20%26%20Appointments%202025">francisco.lima@fei.org</a>.</strong></p>
<p><strong>Rules Revision Process 2025</strong></p>
<p>Based on the FEI Statutes and on the FEI Rules Revision Process Policy (available <a href="http://tracking.fei.org/tracking/click?d=IepYFsu7bveVA1zyUjTQMOgmiKSxOJJQFNdHgsXDpjHnlrN4rM_MC6SIEMl7az_BaG3PixBvVkwj_ED97Q_nv018yAL28ioumHt2XKkAFCUBFlLo25Xo2Kh6N7wpLjhbLHHrIDB0qX-89ETNmVCLaa1RUCQFRzd3kCckk4s8NbzBmK0n9mTpc0f7Ke0seKrELcVG4-gNUn_YmvbB6PFoECdKjPg6UnVKWZIUJUvaHRW7Ja4A0dKW_Ey2JN3FlDj21bFiRd0Rwqx5tjs09GddRf9gFy4RJYXehiddi5j6qitA7qFVfLq-S1kmMQDhVaJifxnj-qWgBty_jisOfw8VxAcA7PC8GWL8Y4J1ey6k-wP0DldonFq7ybUlxxnUEJm0rvXjye1FQPLFT2QXWAnylVJu_fLw3LlBMa-wfWRAnPn1BWh5P28pFQJjPrT7fUAxiQ2">here</a>) please note that by <strong>1 March 2025 23:59 CEST </strong> National Federations and Stakeholders with whom the FEI has signed an MOU have the opportunity to propose Rules changes as per the FEI Periodical Rules Revision Policy (available <a href="http://tracking.fei.org/tracking/click?d=pdoe4qknsud3OfAgKHvAVlRLwnlSqHLklTfbrmd0Halecwoxn5njtHqz9W-QonryJ789kKmLzgMcKR3vTJaSqh6CjONbhqHjS1mDZPIrjytjgIJ7jIRP4gI1QtDJJ9dPr-_sfyXenpsoituZjiqi4RCpUjeqbWsxyQ7Hbib8BAdh5JNfFu6NotIDPmbS_qcP0sId9xPBSAvZZD9Ltpzhm_A1LC_4gRdsuFf3FU44MYFniofb5XM_GDFUmibJTcQ3abUwXKRDf48CC0pPjHr4RTd9ByNE_Th7M5X5sASsQtP_FcFh885rrB3KxwIpQB7r5mIypMktwCQxhiN5kQZDaX9mkppxVL32tpRgxz6ucEfcXSOo3ORhr-f7foVf6nYIgxaJmsTzAAfJsPIrSR5DZZ8RN3D4o66phf-XIjflRTy4obsxIYclll6MAm9Xyui6sJfcjs0Y31jhqTQW0x3_J_o1">here</a>).</p>
<p>As per the Periodical Rules Revision Policy the Jumping, Eventing, Driving &amp; Para Driving Rules will be fully reviewed in 2025.</p>
<p>The other set of FEI Sport Rules, as mentioned in the Policy and explained at the FEI General Assembly 2023 2023 in Mexico DF (MEX), can only be modified in the following cases:</p>
<ol>
<li>Urgent repairs, i.e., changes in the Rules that cannot await because of their impact on the welfare of the Horses or the safety of the Athletes.</li>
<li>Correction of inconsistencies, manifest errors, contradictions, etc.</li>
<li>New/recently introduced rule(s) that has(ve) proven to be problematic in its implementation.</li>
<li>Implementation of new technology development(s) relevant to the specific set of Rules.</li>
<li>IOC, IPC, WADA, ASOIF and similar organisations’ policies’ implementation; and</li>
<li>Other scenarios not foreseen by this Policy as considered and approved by the Board.</li>
</ol>
<p>Therefore, if you are proposing a change to a Sport Rules other than the Jumping, Eventing, Driving &amp; Para Driving Rules, please use the general template provided to you available on the website <a href="http://tracking.fei.org/tracking/click?d=pdoe4qknsud3OfAgKHvAVlRLwnlSqHLklTfbrmd0Halecwoxn5njtHqz9W-QonryJ789kKmLzgMcKR3vTJaSqh6CjONbhqHjS1mDZPIrjytjgIJ7jIRP4gI1QtDJJ9dPr-_sfyXenpsoituZjiqi4RCpUjeqbWsxyQ7Hbib8BAdh5JNfFu6NotIDPmbS_qcP0sId9xPBSAvZZD9Ltpzhm_A1LC_4gRdsuFf3FU44MYGoB4f6pCo7OGPjmpb-cTWedRrp1t0cFiC5Hniu8axcWmIwmmDdhmNXIOfPc3VCvFPG4pMKHIESH3SSSX80N7AwChffsGedhiE4E3WH0fvpQPgmhXBalzVWSzrc5pdMmgqGQPmca1qgy1x3I0JYl8HGyjirWrujgGRm3wfI6OvgOYjFyhaDexBnqX_areOrq8Lef6QQJuRbRR3s0HiSw0tPZ4plQUhSlas4dbP8MeWqhSE1">here</a> named “OTHER FEI RULES &amp; REGULATIONS TEMPLATE”) and indicate on which of the above criteria your proposed rule change is based. Compliance with these criteria will be strictly monitored in order to ensure that the number of proposed rule changes is reasonable.</p>
<p>Please note these criteria do not apply to proposed changes to the FEI General Regulations, FEI Statutes, Internal Regulations of the FEI, Internal Regulations of the FEI Tribunal and Sport Rules for Series.</p>
<p>Only proposals submitted online on the <a href="http://tracking.fei.org/tracking/click?d=Pqtmp4pKEGuiUCsmJFGsOVNAhN4wF8ONW-EW0vgbLwvJtTaTts4R8893Pkap4v_dCLggKq_9vjyi3H1SFg9vDKOTUwgFpttTWdpnjz30GUx9RfjDuIX2WbAogScNulMnGA2OIYScu5wSwMGxMhgtYNNc7kfAVRigjeiy2X0njjOMBmWZOC452K_Vv94fajRptzYELoBN8cG3w9bIBPG1dRwarYnev5jq3iJAQh5JMK3PIiU7QTpOwLbiT0LEmpl8IxIQ2zhP4aSvlIjcnsv6k42L97AiIugPH2i5ZBAkJamzUV5MLrxOH2l7f6ckirb6faiALbnoEbPAKl7-k3Xue1E5hTipcaPBrxBKHgRlS973uAe-ArOZQaZW8hgXKzXK4Q2"><strong>Rules Revision Platform</strong></a><strong> </strong>using the respective Templates will be accepted. The Rules Revision Platform is accessible <a href="http://tracking.fei.org/tracking/click?d=Pqtmp4pKEGuiUCsmJFGsOVNAhN4wF8ONW-EW0vgbLwvJtTaTts4R8893Pkap4v_dCLggKq_9vjyi3H1SFg9vDKOTUwgFpttTWdpnjz30GUx9RfjDuIX2WbAogScNulMnGA2OIYScu5wSwMGxMhgtYNNc7kfAVRigjeiy2X0njjPBURR3YaZuBeghOPzeRSv5MLFeRck6kK2EBvJktetjc07-qlMisq7TTyNR7Pkx2OiYeWkHYy_0KDndSOtzpft38ZeIrGrepmnNGomLHMl2pfPpxIW0DLSRveWVVkBspln135LYRd-sonxbVU6Y8xXjXK2JXAkLnBTPW4v4knaIDrob8PdmLKz_ZmgOB_76LgD9NTl46kSA0pUkauTrnhtT1g2">here</a>. The Rules Revision Platform is also accessible through the general <a href="http://tracking.fei.org/tracking/click?d=VZrY6pYTm-fn7awBJWZ3I5uKg-dLvcLbbzmZ7SA3R2uWQVvPw_0336VsGjPV-2jwZ_BdmEm5sTWsgTztX7UrSxSiJ7HEz4Y7bqtQf4f8NDttBYoRs0A6cjRxaNSPYTXBcsBvfkU9Uc08pyXHDl71VQsruhyMFlSmKYEDjytXr7k8iZaZU5X7P-CzRNFQryotV2ErcmTV2tgrf0VDKxUWMaw1">FEI Rules Revision</a> page on <a href="http://inside.fei.org">inside.fei.org</a>.</p>
<p>If you have any questions do not hesitate to contact Francisco P. Lima, FEI Director Governance &amp; Institutional Affairs at <a href="mailto:francisco.lima@fei.org?subject=Rules%20Revision%20Process%202025"><strong>Francisco.lima@fei.org</strong></a><strong>.</strong></p>
<p>Kind regards,</p>
<p><strong>FEI Communications Department</strong></p>',
    'published',
    '2025-02-01T17:52:20Z'::timestamptz,
    '2025-02-01T17:52:20Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idoc-general-assembly-fei-refresher-seminar-2025/ (wp post id 3261)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idoc-general-assembly-fei-refresher-seminar-2025',
    'IDOC General Assembly 2025 & FEI Maintenance Course Program',
    'It is a great pleasure to invite you all to the 2025 International Dressage Officials Club General Assembly + FEI/IDOC Seminar, which will take place during the CDI 5* Frankfurt, 18 – 20 December 2025.',
    '<p>Dear Members,</p>
<p>It is a great pleasure to invite you all to the 2025 International Dressage Officials Club General Assembly + FEI/IDOC Seminar, which will take place during the CDI 5* Frankfurt, 18 – 20 December 2025.</p>
<p><strong>IDOC GENERAL ASSEMBLY DETAILS</strong></p>
<ul>
<li><strong>Date and Time: </strong> Friday, December 19th, 2025, at 15:00.</li>
<li><strong>Location: </strong>Gestüt Schafhof.</li>
<li><strong>Transportation: </strong>Will be arranged to and from the Marriott Hotel Frankfurt (Hamburger Allee 2, Frankfurt am Main), at 13:30 on Friday (Dec. 19th 2025).</li>
<li><strong>Agenda: </strong>Will be sent shortly.</li>
<li><strong>Dinner at Schafhof:</strong> Offered after the GA</li>
</ul>
<p><strong>FEI MAINTENANCE COURSE &amp; IDOC<br>
SEMINAR FOR DRESSAGE JUDGES</strong></p>
<p><strong>December 18th to 20th</strong></p>
<p>In keeping with tradition, IDOC will be hosting a seminar and a FEI Maintenance Course during the CDI 5* Frankfurt.</p>
<p>The tickets to access the showground (Festhalle) will be distributed on Wednesday, December 17th, at the lobby of the Marriott Hotel, from 16h to 18h. The official schedule of the Seminar ends on Saturday by 13h00.</p>
<p>Download the <a href="https://idoc.club/documents/general-assembly/2025-IDOC-General-Assembly-FEI-Maintenance-Course-Frankfurt-Preliminary-Program_v2.pdf">event agenda</a> for more details.</p>
<p>IDOC won’t provide tickets for the Freestyle on Sunday morning. If you are interested in watching it, please find more information and purchase details directly in the <a href="https://festhallenreitturnier-frankfurt.com/">competition site</a></p>
<p><strong>FEI MAINTENANCE COURSE DETAILS</strong></p>
<p>The judges who would like to take this course should apply through your National Federation directly via the <a href="https://data.fei.org/Calendar/OfficialCourseSearch.aspx">FEI Database Course Calendar</a>. If you have any questions regarding registration, please contact <a href="mailto:anna.milne@fei.org?subject=&amp;body=">anna.milne@fei.org</a>.</p>
<p>Be aware that the deadline to apply to the FEI Seminar is 18 November 2025.</p>
<p>For the video assessment &amp; theory session (Thursday afternoon, Dec. 18th, at the showground – “Blauer Saal”), please bring your own devices (computers, tablets, smartphones should work too).</p>
<p><a href="https://data.fei.org/UploadFile/DownloadInvitationCourse/4097">DOWNLOAD INVITE »</a></p>
<p><strong>IDOC DRESSAGE JUDGES SEMINAR DETAILS</strong></p>
<p>The seminar is also open for national judges and FEI officials not willing to take the assessment officially (although everyone is welcome to take it as a practice!).</p>
<p>If this is you case, please register with <a href="mailto:secretary@idoc.club?subject=&amp;body=">secretary@idoc.club</a></p>
<p><strong>FEES</strong></p>
<p><strong>IDOC/FEI Dressage Judge Seminar + General Assembly</strong></p>
<p>Includes the showground tickets for the 18, 19 and 20 Dec.</p>
<p>€ 300 <a href="https://buy.stripe.com/dR628z5Eu9by9jO8wY">PURCHASE »</a></p>
<p><strong>FEI In-Person Maintenance Course (register with FEI) + General Assembly</strong></p>
<p>It includes the showground tickets for the 18, 19 and 20 Dec.</p>
<p><strong>€ 300 </strong><a href="https://buy.stripe.com/eVaeVleb073q53yfZr">PURCHASE »</a></p>
<p><strong>Just IDOC General Assembly (Showground access not included): </strong>Free of charge but you must RVSP to <a href="mailto:secretary@idoc.club?subject=&amp;body=">secretary@idoc.club</a>.</p>
<p><strong>NOTE:</strong> It is also possible to pay in cash at the venue with IDOC Tresurer, Luc Verbocht. It is also possible to pay by bank transfer:<br>
DIRECT TRANSFER: IDOC VZW</p>
<p>Account : BE87 4163 2131 2894</p>
<p>Swift : KREDBEBBXXX (or BIC KREDBEBB)</p>
<p>KBC Bank NV</p>
<p>Havenlaan 2</p>
<p>Brussels</p>
<p>Belgium</p>
<p>I look forward to seeing you all in Frankfurt!</p>
<p><strong>Alexandre Lacerda Leão</strong></p>
<p>Secretary<br>
International Dressage Officials Club<br>
Van De Reydtlaan 83<br>
2960 Brecht (Belgium)<br>
M: <a>+ 1 617 769 2302</a><br>
<a href="mailto:secretary@idoc.club?subject=&amp;body=">secretary@idoc.club</a></p>',
    'published',
    '2025-09-19T17:18:17Z'::timestamptz,
    '2025-09-19T17:18:17Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-general-assembly-wrap-up-report/ (wp post id 3277)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-general-assembly-wrap-up-report',
    'FEI General Assembly Wrap-Up Report',
    'The main decisions taken by the General Assembly are summarised in this report.',
    '<p><a href="https://idoc.club/documents/general-assembly/2-GA25-wrap-up-report-GA-7Nov2025.pdf">2 - GA25 - wrap-up report GA-7Nov2025</a> <a href="https://idoc.club/documents/general-assembly/15.2_GA25_Dressage-Rules-Memo.pdf">15.2_GA25_Dressage Rules Memo</a></p>',
    'published',
    '2025-11-19T01:14:59Z'::timestamptz,
    '2025-11-19T01:14:59Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/proposals-for-rule-changes-of-dressage-rules-2025/ (wp post id 3282)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'proposals-for-rule-changes-of-dressage-rules-2025',
    'Proposals for Rule Changes of Dressage Rules 2025',
    'Proposed changes to the Dressage Rules together with the corresponding explanations, the comments received as well as the reasoning for accepting or not accepting each proposal.',
    '<a href="https://idoc.club/documents/general-assembly/15.2_GA25_Dressage-Rules-Memo.pdf">15.2_GA25_Dressage Rules Memo</a>',
    'published',
    '2025-11-19T01:19:09Z'::timestamptz,
    '2025-11-19T01:19:09Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/fei-rules-revision/ (wp post id 3312)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'fei-rules-revision',
    'FEI Rules Revision',
    'The Periodicial Rules Revision Policy, approved by the FEI Board during its in-person meeting in Lausanne (SUI) on 19, 20 and 21 June 2019 and endorsed by the General Assembly on 19 November 2019.',
    '<p>Read the FEI Periodical Rules Revision Policy: <a href="https://inside.fei.org/fei/about-fei/governance/rules-revision">inside.fei.org/fei/about-fei/governance/rules-revision</a></p>',
    'published',
    '2026-03-01T15:09:08Z'::timestamptz,
    '2026-03-01T15:09:08Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/how-to-apply-the-fei-judging-guidelines-on-tension-submission-acceptance-of-the-contact-and-harmony/ (wp post id 3309)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'how-to-apply-the-fei-judging-guidelines-on-tension-submission-acceptance-of-the-contact-and-harmony',
    'How to apply the FEI judging guidelines on tension, submission, acceptance of the contact, and harmony',
    'by Hans Christian Matthiesen',
    '<p>In our current climate, <em>how</em> we apply the FEI judging guidelines on <strong>tension, submission, acceptance of the contact, and harmony</strong> is more than technical accuracy—it’s the sport’s credibility. The FEI Dressage Judging Manual is explicit: quality of gaits and technical execution must be evaluated <strong>together with</strong> the overall picture of relaxation, confidence, and willingness. When <strong>stress and conflict signals</strong> are visible, they are not “stylistic choices”; they are <strong>relevant judging information</strong> that should influence our marks accordingly.</p>
<h3><strong>Stress &amp; conflict signs we already have in our framework</strong></h3>
<p>The Manual (and the wider FEI framework) expects us to penalise what undermines the stated training scale outcomes—especially <strong>tension</strong> and loss of <strong>self-carriage</strong> and <strong>acceptance</strong>. That means consistently recognizing observable indicators such as:</p>
<ul>
<li>persistent <strong>mouth opening</strong>, tongue issues, or unstable contact</li>
<li>repeated <strong>tail swishing</strong> not explained by environment</li>
<li><strong>ears pinned</strong>, anxious facial expression, rigid poll/neck, bracing through topline</li>
<li>repeated <strong>resistance patterns</strong> (e.g., backing off the hand, escaping through (head and) neck position, repeated head movements)</li>
<li>marked tension that compromises rhythm, suppleness, and straightness</li>
</ul>
<p>A strong evidence base supports the point that many “conflict behaviours” correlate with discomfort/pain and/or significant stress—i.e., behaviours are <em>signals</em>, not noise. The <strong>Ridden Horse Pain Ethogram (RHpE)</strong> literature is relevant here, because it operationalises ridden pain-related behaviours into a practical observation framework and demonstrates strong discrimination between uncomfortable (lame, uneven)/comfortable.</p>
<p>There is also competition-focused research showing that conflict behaviours are measurable in dressage contexts—and importantly, that some behaviours may be <em>under-weighted</em> in scoring depending on what judges attend to.<br>
And very recent work analysing stress-related behaviours across levels reinforces that these signs can be quantified from video and are present within the competitive population.</p>
<h3><strong><br>
The hard part: bias is real—even for experienced judges</strong></h3>
<p>We all like to believe we “just judge what we see.” But robust analyses in elite dressage show systematic influences on scoring consistent with <strong>nationality-related bias</strong>, <strong>home advantage</strong>, <strong>reputation / prior ranking effects</strong>, and <strong>starting order effects</strong>.<br>
These effects are not accusations of bad faith—they’re reminders that <strong>human perception is context-sensitive</strong>, especially under time pressure.</p>
<p><strong>So, what helps in practice?</strong></p>
<p>A few practical habits that (in my experience) make a difference—and are supported by what we know about bias:</p>
<ol>
<li><strong>Anchor to observable markers first</strong><br>
Before “overall impression” kicks in, make a quick internal check: <em>rhythm, relaxation, contact, straightness, collection—what do I actually see right now?</em></li>
<li><strong>Use a micro-checklist for stress/conflict</strong><br>
Pick 3–5 “non-negotiable” signs you will always register (e.g., persistent open mouth, loss of suppleness and selfcarriage, obvious tension, repeated resistance). If present, ensure the mark reflects it—even if the movement is otherwise “spectacular.”</li>
<li><strong>Actively resist halo effects</strong><br>
Famous combination, big trot, great music—none of that should drown out tension. Bias studies suggest that prior ranking/reputation can leak into marks unless we deliberately compartmentalise.</li>
<li><strong>Recalibrate during the test</strong><br>
If you catch yourself thinking “this is a top combination,” pause and re-set to the training scale and the directives.</li>
<li><strong>Promote consistency, not perfection</strong><br>
We won’t eliminate bias entirely. But we can reduce it by being consciously, repeatedly focused on the FEI definitions and the horse’s way of going.</li>
</ol>
<h3><strong><br>
Why this matters</strong></h3>
<p>If we do not reliably apply the guidance on <strong>tension/conflict</strong>, we risk rewarding pictures that conflict with the FEI’s own stated ideals. The science is not telling us to become veterinarians from the box—but it <em>is</em> telling us that the behaviours we already describe in our guidelines are meaningful and should be treated as such.</p>
<p><strong>References</strong></p>
<ul>
<li>Fédération Equestre Internationale (FEI). (2025). <em>FEI Dressage Judging Manual</em> (effective 1 January 2025). FEI.</li>
<li>Dyson, S. (2021). The Ridden Horse Pain Ethogram. <em>Equine Veterinary Education, 34</em>(1), 372–380. https://doi.org/10.1111/eve.13468</li>
<li>Dyson, S., &amp; Pollard, D. (2021). Application of the Ridden Horse Pain Ethogram to elite dressage horses competing in World Cup Grand Prix competitions. <em>Animals, 11</em>(5), 1187. https://doi.org/10.3390/ani11051187</li>
<li>Hamilton, K. L., Lancaster, B. E., &amp; Hall, C. (2022). Conflict behaviors displayed by horses during dressage tests and their relationship to performance evaluation. <em>Journal of Veterinary Behavior, 55–56</em>, 48–57. https://doi.org/10.1016/j.jveb.2022.07.011</li>
<li>Fialová, S., Kuřitková, D., &amp; Sobotková, E. (2026). Stress responses in dressage horses: Insights from FEI noseband measurements across national competition levels. <em>Animals, 16</em>(3), 518. https://doi.org/10.3390/ani16030518</li>
<li>Wolframm, I. (2023). Let them be the judge of that: Bias cascade in elite dressage judging. <em>Animals, 13</em>(17), 2718. https://doi.org/10.3390/ani13172718</li>
<li>Hawson, L. A., McLean, A. N., McGreevy, P. D. (2010). Variability of scores in the 2008 Olympic dressage competition and implications for horse training and welfare. <em>Journal of Veterinary Behavior, 5</em>(4), 170–176.</li>
<li>Kienapfel, K., Preuschoft, H., &amp; Wulf, M. (2014). Prevalence of different head–neck positions in horses shown at dressage competitions and their relation to conflict behaviour and performance marks. <em>PLOS ONE, 9</em>(10), e103140. https://doi.org/10.1371/journal.pone.0103140</li>
<li>Williams, L. R., &amp; Warren-Smith, A. K. (2010). Conflict responses exhibited by dressage horses during competition. <em>Journal of Veterinary Behavior, 5</em>(4), 216–222. https://doi.org/10.1016/j.jveb.2009.11.002</li>
<li>Ladewig, J., McLean, A. N., Wilkins, C. L., Fenner, K., Christensen, J. W., &amp; McGreevy, P. D. (2022). A review of the Ridden Horse Pain Ethogram and its potential to improve ridden horse welfare. <em>Journal of Veterinary Behavior, 54</em>, 54–61. https://doi.org/10.1016/j.jveb.2022.07.003</li>
<li>Fédération Equestre Internationale (FEI). (2025). <em>FEI General and Discipline-Specific Protocols for Assessing the Tightness of Nosebands</em> (protocol document). FEI.</li>
</ul>',
    'published',
    '2026-03-06T14:52:33Z'::timestamptz,
    '2026-03-06T14:52:33Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/in-memoriam-stephen-clarke/ (wp post id 3353)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'in-memoriam-stephen-clarke',
    'In Memoriam — Stephen Clarke 1952-2026',
    'A tribute from the International Dressage Officials Club It is with profound sadness, and yet with an equally profound sense of gratitude, that we share the news of the passing',
    '<p>A tribute from the International Dressage Officials Club</p>
<p>It is with profound sadness, and yet with an equally profound sense of gratitude, that we share the news of the passing of our dear friend, colleague and former IDOC President, Stephen Clarke.</p>
<p>Stephen was, quite simply, one of the greatest gifts the sport of dressage has ever received. His passing leaves a stillness in our world that will take a long time to fill — and yet, if we listen carefully, we can still hear his voice: warm, measured, often wonderfully witty, and always pointing us toward what is right and good in this sport we all love.</p>
<p>A life shaped by horses</p>
<p>Stephen’s journey with horses began as a boy growing up in a small Welsh village, where a neighbouring farmer’s ponies captured his imagination and never truly let go. He started judging in his early 20s, having become, as he put it, “fed up with everyone moaning about the judging” — a characteristically Stephen solution to a problem: rather than complain, step forward and be part of the answer.</p>
<p>He trained two winters with Ernst Bachinger at the Spanish Riding School, and with guidance from Jennie Loriston-Clarke and Ferdi Eilberg, his horse Becket went on to earn him selection as reserve combination for the British Dressage Team at the 1988 Seoul Olympic Games. As a rider, he won five National Championship titles and represented Great Britain in international competition throughout the 1980s. Even then, it was always, as he admitted himself, about the dressage.</p>
<p>A judging career of the very highest order</p>
<p>Stephen Clarke was one of the most highly respected dressage judges in the world. As a 5* FEI judge, he officiated at countless international championships — including as President of the Ground Jury at the London 2012 Olympic Games and on the judging panel at the Rio Games in 2016, as well as numerous World Cup Finals, European Championships and World Equestrian Games. Athens 2004 was his first Olympic assignment, London 2012 his finest hour — presiding over a ground jury at the Games in his homeland, an honour he described as one of the proudest moments of his life.</p>
<p>To be on the judging panel when Totilas and Valegro broke the world records was, in his own words, “beyond exciting.” The privilege of awarding 10s for movements where you just cannot imagine how it could be better — that was the joy Stephen brought to his work every single time he sat behind the judging board.</p>
<p>He never shied from the difficult calls either. At the World Equestrian Games in Kentucky, he made one of the toughest calls in a world championship — the disqualification of Adelinde Cornelissen when her horse bled from the mouth. It was correct, it was courageous, and it was entirely Stephen. He understood that integrity in judging is not a convenience — it is the foundation upon which the sport rests.</p>
<p>The Judge General — shaping the future of judging</p>
<p>In 2013, Stephen was unanimously elected FEI Dressage Judge General, succeeding Ghislain Fouarge. The FEI’s own words at the time describe him perfectly: “a first-class judge and a natural communicator.” He also sat on the FEI Dressage Committee for several years and was instrumental in putting together the FEI Judge’s Book — now considered the bible of modern judging. His efforts earned tremendous respect for dressage judges worldwide and contributed greatly to the reputation and profile of the sport. His goal, as he always said, was to ensure young judges have the opportunity to develop their education and skills. And he meant it — not as a statement of policy, but as a personal mission. He took time with every young official who crossed his path. He remembered names. He remembered horses. He remembered what it felt like to be new to this world, and he made sure no one felt alone in it.</p>
<p>His years at IDOC</p>
<p>As President of IDOC, Stephen brought the same qualities to our organisation that he brought to everything: clarity of thought, generosity of spirit, and an unwavering commitment to doing things properly. He worked alongside colleagues including Maribel Alonso, Katrina Wüst and Hans-Christian Matthiesen in the Education Working Group, and his influence on the way we train and support officials across the globe cannot be overstated. IDOC is a better, stronger, more purposeful organisation because Stephen Clarke led it.</p>
<p>The man behind the judge</p>
<p>Those of us lucky enough to know Stephen beyond the formal settings of competition and seminar know a different, equally wonderful dimension of the man. He ran a working pupils scheme at his Cotton Equestrian Centre near Holmes Chapel, Cheshire, and many of those young trainers have gone on to build outstanding careers of their own — a fact Stephen spoke about with immense, quiet pride. He was quick to laugh, quicker still to listen. In any discussion — whether about a single movement in a test, the future direction of FEI judging policy, or the state of the sport over a glass of wine after a long competition day — Stephen brought the same qualities: a clear mind, an open heart and exactly the right words at exactly the right moment. Many of us will carry specific things he said to us, privately, at just the right time, for the rest of our lives.</p>
<p>In closing</p>
<p>In his final years, illness slowed him physically — but never in spirit. He remained in close contact with many in his circle, generous with his time, his warmth, and his thoughts, right to the end. That, too, was entirely Stephen.</p>
<p>We will miss him at the arena. We will miss him in the seminar rooms. We will miss him at the table after a long day, when the best conversations always seemed to happen. We will miss his laughter, his precision, and his extraordinary ability to make everyone around him feel both valued and challenged to be better.</p>
<p>The sport of dressage is immeasurably richer for everything Stephen Clarke gave it over so many decades. We are immeasurably richer for having known him.</p>
<p>Our thoughts go to Julian Sebire, Stephen’s partner for more than 40 years.</p>
<p>Stephen — thank you. It was a privilege and an honour.</p>
<p>On behalf of the International Dressage Officials Club</p>
<p>Mariette Whittages Former President, IDOC</p>
<p>Hans-Christian Matthiesen President, IDOC</p>',
    'published',
    '2026-06-14T15:35:14Z'::timestamptz,
    '2026-06-14T15:35:14Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/in-memoriam-jacques-van-daele-1953-2026/ (wp post id 3358)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'in-memoriam-jacques-van-daele-1953-2026',
    'In Memoriam — Jacques Van Daele 1953-2026',
    'A tribute from the International Dressage Officials Club It is with deep sadness that we share the news of the passing of our dear colleague, Jacques van Daele, who left',
    '<p>A tribute from the International Dressage Officials Club</p>
<p>It is with deep sadness that we share the news of the passing of our dear colleague, Jacques van Daele, who left us this weekend after a period of illness, and longtime struggle with cancer.</p>
<p>Jacques was a man of many roles in the equestrian world — international dressage judge, international chief steward, and a longstanding member of the IDOC board — but it was perhaps in the arena of steward education that his mark was felt most profoundly. He dedicated a big part of his professional life to training and mentoring stewards within the FEI framework, approaching that responsibility with the same rigour and dedication that characterised everything he did.<br>
His commitment to the sport took him to some of the greatest stages equestrian sport has to offer. Among them, his many years of service at CHIO Aachen stand as a testament to the trust and respect he earned from the highest levels of our community. As a judge, he judged many Championships throughout the years.<br>
Those who worked alongside Jacques will remember a man who was, in many ways, a study in contrasts. Private by nature, he kept much of himself close — yet in the company of colleagues and athletes, he was unfailingly warm, quick with a remark that cut through the tension of a long competition day, and remarkable in his ability to read a situation and respond to it with exactly the right measure of “correctness” and humour.</p>
<p>He understood that stewarding, done properly, is more than procedure. It is the quiet architecture that holds a competition together. He believed in that deeply, and he gave it his very best for many years.</p>
<p>On behalf of the International Dressage Officials Club and the wider community of officials who had the privilege of working with him, we extend our heartfelt condolences to his family, his close friends that stood by him during the illness, and all those who knew and loved him beyond the arena.</p>
<p>Jacques — it was an honour to share this sport with you. You will be greatly missed.</p>
<p>The Board and Members of IDOC International Dressage Officials Club</p>
<p>Hans Christian Matthiesen,<br>
President</p>',
    'published',
    '2026-07-05T16:57:17Z'::timestamptz,
    '2026-07-05T16:57:17Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;


-- President's Blog (legacy category: president-blog) (7 rows) -----------------------------------------------------------
-- source: https://idoc.club/the-perception-of-dressage-judging-happy-easter/ (wp post id 1606)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'the-perception-of-dressage-judging-happy-easter',
    'The Perception of Dressage judging – Happy Easter',
    'So between the Sports Forum meeting in Lausanne, work near Copenhagen and a CDI in Austria near Vienna and the annual trainers meeting, IDTC in Billund back in Denmark –',
    '<p>So between the Sports Forum meeting in Lausanne, work near Copenhagen and a CDI in Austria near Vienna and the annual trainers meeting, IDTC in Billund back in Denmark – its time to reflect, look back and try to look into the future !<br>
The Sports Forum meeting in Lausanne went well – in the way, that the Judges Working group decided not to present a new Judging system (like proposed at the stakeholder meeting in Amsterdam). They did however state that the future of dressage will bring ”change” and lets hope that it will be based on concensus and compliance. Before the meeting there had been a lot of speculation and lobbying, but only because we didnt have the feeling that our (IDOC’s) opinion were taken serious in Amsterdam.<br>
<br>
I felt it was important to state that dressage officials/judges are ”open and positive” to change if it is based on evidence and will benefit the sport. The last years, all the judges have been open to changes in the judging system. Over the years, we have gained a lot of experience and good results with the current system. Never the less, we have been open to changes like: Freestyle, the new DoD system, 7 judges in championships, JSP, 5% rules and others because they were based on trials’s and statistic evidense. We have tried out many other judging systems, but even though some of them were interesting, we decided to keep the current system, because that made more sense. The judging is more transperant than ever – all marks and results are published on the internet, live and after. Everybody can analyse, comment and critisize – and the judges are used to that. We of all know the frustration behind differences in judging. No one like the judges, try so hard to get around this – and we have meetings and discussions to become better and more clear in our judging.</p>
<p>Was does it mean ?<br>
The figure (David Stickland, Global Dressage Analytics) shows me/us that we are very good, when we are giving marks around 5 to 8, below 5 the standard deviation for each mark gets bigger, the same for marks higher than 8. Most of the time, our marks ranges from 5-8 – and in that area, we are more or less comfortable. Most of the marks, on most levels are in that range – that means that we deviate less here.<br>
But we have to improve and be more on the same page, when it comes to marks lower than 5 and higher than 8. We all know the situation, when we have differences, when something unexpected happens. Mistakes or disobediences. After the class/ride we discuss: ”What did you give for the ”none existing change” in the corner after the collection ? Sometimes we dont see it, we can miss it – but if we all see it, we must come to an agreement. We still have too many situations, where we differ from 4 (”I saw it, but didnt want to punish it soo hard, because the horse was tense throughout the test”) to 1 or even 0 (”I didnt see any change at all”). We need to be more consistant in our judging and stick to guidelines. We all know of these situations. The same goes for the higher marks – higher than 8. Sometimes its a question about experience, because lets face it – we dont have that many rides beyond 80%. I personally thought it was difficult in the beginning – and I didnt feel so comfortable giving all the high marks – I lost track. I did spend a lot of time on ClipMyHorse – judging all the good ones, over and over again (And I was aware of the risk of being prejustice, but I needed the experience and to expand my comfort zone)<br>
Here the guidelines (or some Code of points) are very important – they will help us, being more accurate and consistant when mistakes happen.<br>
•       Interestingly as mentioned, we seem to differ more for movements in the low range of marks and for movements in the high range of marks.<br>
•       2/3 of the times, our marks for the entire test are within +/- 1.6% of the average of our colleagues and in only 5% of the cases, do we differ by more than 3.2 %<br>
•       When you look at individual movements, we differ by 1 point or less in more than 80% of the cases and by 2 points or less in more than 95% of the cases.<br>
•       More embarrassingly, we seem to differ the most in movements that carry more weight in the total result (e.g. pirouettes in PSG)<br>
So we have to discuss when we have differences. We have to:<br>
•       Improve agreement on low scores (I think the guidelines will go a long way in that direction)<br>
•       Improve agreement on high scores (I am sure the second part of the guidelines/Code of points and/or video Handbook  will address this)<br>
•       Focus judges training on the movements that carry most weight in the test(s). That makes complete sense and reinforces our point that education is key.</p>
<p>I know that EDUCATION is not ”sexy” – but never the less – that is the most important factor here. Dressage judges are also humans – believe me – and we can make mistakes, but no matter what system we have and agree on, there will be a ”human error factor”.<br>
Globalisation of the sport – has given the possibility to people all over the world to participate – also judges. We all join the force with different background and experience. Thats why education and in-lignment is so important. We have already worked on Guidelines and Code of points that will give us clear advice when it comes to the more difficult parts in judging. In January the group of 5* judges have aggreed on a set of guidelines that will work as a start. We know, that we will have to revise our handbook, there is already a group of people ready to start that – ideally together with a video handbook.<br>
We have to work together with the other Clubs – but we will not be ”run over” by something that will just cause confusion and leave us in an even more difficult and frustrating situation.<br>
#NoToDrexit<br>
Happy Easter<br>
HC Matthiesen</p>',
    'published',
    '2017-04-16T18:38:44Z'::timestamptz,
    '2017-04-16T18:38:44Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/new-year-message-from-idoc-president/ (wp post id 593)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'new-year-message-from-idoc-president',
    'New year message from IDOC President',
    'Dear Friends and Colleagues, First of all: Happy New Year, I hope you all had time to enjoy the holidays. In December we were so lucky to have our General',
    '<p>Dear Friends and Colleagues,<br>
First of all: Happy New Year, I hope you all had time to enjoy the holidays.</p>
<p>In December we were so lucky to have our General Assembly and Refresher Seminars for both judges and steward in Frankfurt, hosted by the Linsenhof/Rath family at Stud Schafhof. Thank you so much to Ann-Kathrin, Klaus-Martin and Mathias for their incredible support and thank you to everybody who made their way and invested their time in this year’s meeting and seminar in Frankfurt. It was truly great.<br>
</p>
<p>Close to 120 officials from all around the world (more than 31 different federations and nationalities) attended the General Assembly. The discussions were lively and brought up many topics. The FEI Headquarters were represented by Bettina de Rahm and Anna Milne as well as Michael Rentsch and Aine Power from the legal department. We really appreciate and thank them for taking the time to participate to our annual assembly.</p>
<p>2018 turned out to be another interesting year for dressage. Most officials have been very busy, not only on the international scene, but also nationally, both in competitions and outside.</p>
<p>IDOC has organized and participated in many activities in 2017 and 2018.</p>
<p>In July, during the CHIO in Aachen, we participated in an interesting stakeholder meeting. Katrina Wüst and I represented the Officials. Our main topic was better communication between judges, riders and trainers – and cognitive processes in the sport.  Many people attended and the organizers decided to arrange another meeting next year in Aachen again.</p>
<p>Katrina and I explained some of the challenges of judging, and we strongly advocated for a more straight forward and honest communication between the different parties in dressage, especially between riders and judges. Bias is not only relatable for judges – everybody is biased and have more or less fixed opinions on training and judging etc. A part of being a judge is dealing with bias (cognitive processes) and avoid bias to have an influence on your judging. That’s not always the case for riders and trainers.. While riders and trainers are by essence biased (they do favor a particular training method).<br>
At the meeting, it was also stated that some bias is accepted in our rules – e.g. ”starting order according to ranking lists” etc.<br>
In 2018, the FEI held its General assembly in Bahrain. IDOC would like to congratulate the new dressage committee member, our colleague Irina Maknami, 5* dressage judge from RUS, on her appointment. We wish her and the other committee members good luck, and we look forward to a fruitful cooperation with them. IDOC has always valued the communication and cooperation with the officials who are members of the committee – Andrew and Irina –, as well as the cooperation with the FEI Headquarters. It is crucial for our work in IDOC that we have the feeling that we are listened to, and that our proposals are brought forward in the committee for further consideration.</p>
<p>In Bahrain, the report from the DJWG was presented to the General Assembly delegates, including the FEI board members. I hope you have all read the report by now (full text can be found here). It contains many important recommendations, and most of them relate to the current judging system. At this point, I would like to thank the members of the working group for their dedication and hard work. Many interesting and important points are being brought forward in the report, and IDOC looks forward to giving positive and constructive feedback. Many of the recommendations have already been tried out in one form or another, or we have experience with closely related systems. The working group has done an amazing job and looked into many aspects of judging and on how to improve the perception and understanding of our sport.</p>
<p>Probably one of most interesting and positive new recommendation was to try-out and implement the e-Judging system: no more paper test sheets; the scribe enters the marks and the comments directly into the computer system. With this system, made possible by modern technology, we have made a huge leap forward, and “transparency” was taken to another level. Announcing the results will be quicker, and it will be easier to understand why judges give different marks. At the same time, it also stimulates us to strictly adhere to the guidelines and always give clear and precise remarks to justify our scores. It is still up to the FEI to decide how much details should go to whom (riders, trainers, judges, press etc.) and when. Overall, the judges were very positive about this new system.</p>
<p>The Code of Points is another essential recommendation in the report. A dedicated working group has been set up to work on codifying the Grand Prix movements, with clearer descriptions of the levels, and with focus points and guidelines on how to assess each movement. When finalized and validated in real life situation, this should lead to a better understanding of judging. The Code of points will also work as an important tool in the education system.</p>
<p>The possibility to go into all these details and being open, honest and transparent will result in a better mutual understanding and thereby significantly reduce distrust and criticism.</p>
<p>For me, the most positive aspect is the possibility for self-reflection and evaluation. We now have tools at our disposal (the Dashboard), based on statistics, that tells us how we perform in comparison with our colleagues, how well we work together as a panel, and how often we happen to have larger differences with our colleagues. It’s my belief that the majority of us is more than open to evaluation. Statistics as a tool, together with more education (exams) and guidance (Judges’ Advisor Pannel etc) will prepare the judges in a much better way in the future. A new education plan has been proposed to the Dressage committee, which includes examination and evaluation at all levels. In the future we will be able to identify very specifically problem areas, and take action right away to correct them.</p>
<p>At the end of the day Code of points, e-judging and regular evaluations will eliminate the need for ”band-aids” incl proposals such as Hi/Lo in the judging system.</p>
<p>In the future it is important that IDOC be represented in all working groups set up by the FEI, and that the working groups regularly consult the stakeholders groups at every stage of their work. Representatives, as the name imply, should represent the ideas and positions of the Clubs, and, in our case, the Officials. The cooperation is essential.</p>
<p>I believe that the Officials are open to new ideas and to change. It is important to stay loyal to core values of our sport, but that doesn’t mean that we can’t change things and systems for the better. Our support to e-Judging, new education plans, competency-based evaluation is a testimony of our willingness to embrace change. We want the best for our sport, but we need to work together.</p>
<p>The Officials group arguably has more experience than any other group with the competition system. That is why it is so critical that we are part of all working groups – after all any change has a huge impact on our role as official, judge or steward. Of course, we accept to be constantly scrutinized, but most officials work as volunteers in their spare/free time, and they need to feel safe, respected and supported by the system, and not constantly criticized.</p>
<p>Many people are focused on the ”bad” judging, but maybe it is time to focus on the ”good” judging – and statistically, there is way more ”good” than ”bad” judging. It’s only our own perception that tells us otherwise. All officials wants to bring the sport to new exciting levels without forgetting that protection of  the horses and riders is of paramount importance.</p>
<p>Another important challenge for the future is the development of the Competency based evaluation system, which in time should replace the age-rule. It is essential that we come up in due time with good ideas and proposals on how to implement it. I firmly believe that all officials will benefit from this system. We are now ready to use some of the tools that statistics and results have given us. We are looking for a good system that will help and evaluate all judges, monitor the judging system and see to it that all officials stick to guidelines and rules. I believe this will take us another huge step forward. Establishing a system like that is a huge job and will take some time, nevertheless I expect the FEI will have something ready in 2019 already.</p>
<p>In the end, I would like to thank my colleagues board members, for all their hard work. It is very inspiriting to work with so dedicated people, doing it for free and in their spare-time. It means the world to me.</p>
<p>Thank you to all you – members – without you, there would be no IDOC. Spread the word about IDOC, and please let us know, if and how we can make a difference.</p>
<p>In 2019 we have quite a lot of activities scheduled including seminars. Please stay tuned and look out for more information on Facebook and our website.</p>
<p>We will start sending out a quarterly newsletter, in order to stay more in touch with all members.</p>
<p>We need to stand together and make our voices heard. We will earn our respect for all the work we do for the sport, as volunteers…as officials.</p>
<p>Thank you.<br>
Hans-Christian Matthiesen<br>
President</p>',
    'published',
    '2019-01-19T13:20:39Z'::timestamptz,
    '2019-01-19T13:20:39Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/hans-christian-matthiesen-the-president-of-the-idoc-about-on-line-judging/ (wp post id 944)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'hans-christian-matthiesen-the-president-of-the-idoc-about-on-line-judging',
    'Hans-Christian Matthiesen, the president of the IDOC, about on-line judging',
    'Dear Colleagues! We live in a world full of rules and sanctions due to Covid19, but everywhere we see new initiatives on the internet. Some of them who might employ',
    '<p>Dear Colleagues! </p>



<p>We live in a world full of rules and sanctions due to Covid19, but everywhere we see new initiatives on the internet. Some of them who might employ us during this time or keep up the competing spirit amongst riders, trainers and officials. Nobody knows how long this will take and when and what kind of “normal” we will return to. Only one thing is certain, it will change again, maybe not back to what we came from, but we will see a new reality rising. The consequences for our sport and the competition format that we know, might (has already changed) change now on short term. Spectators, sponsors and everything in between will in the future have even more different background and patterns, depending on the impact of the Covid19 situation.</p>



<p>That is why we must keep up with the present rules. Nothing has changed yet, and before we know more (FEI has set up Taskforce groups) we must abide by the rules:</p>



<p>The position of the FEI Board is that FEI judges are not permitted to judge in national or international online competitions. This type of competitions falls under the category of “unsanctioned events”, and they don’t guarantee some of the fundamental FEI principles:<br>– it is impossible to control horse welfare issues; in each equestrian discipline, the welfare of the horse must be the paramount consideration at all times. It must never, in any circumstances, be subordinated to competitive or commercial considerations.<br>– athletes must compete against each other under fair and equal conditions; the organizer must provide similar benefits and conditions to all participating horses and athletes;<br>– it is not possible to control and ensure the uniform application of all the necessary rules and regulations and to hold event organizers and participants accountable for conducting themselves in a manner that protects the safety and integrity of the sport.</p>



<p><strong><em>Please note that FEI Judges that officiate in Unsanctioned Events may be subject to disciplinary proceedings by the FEI which can include the imposition of a period of suspension.</em></strong></p>



<p>Equestrian sport depends, for its credibility, on public acceptance derived from the integrity of its competitions. Behind this precept lies the premise that the best athletes should win fairly and squarely, having competed under even and equitable conditions and under Rules that are themselves fair, realistic, and applied with scrupulous competence and even-handedness. No result can be meaningful or valid if it has not been achieved on a level playing-field. Please remember that at the core of our mission is to protect and promote those principles!</p>



<p>We would like to draw your attention to the following Articles in <strong>General Regulations</strong>:</p>



<p><strong>1) Article 113 – Registration and Eligibility of Athletes and Horses. Points 4-9</strong><br><em>4. An Athlete and/or Horse, even if registered with the FEI, is not eligible to participate in an International Event or National Event (and so may not be invited by an OC to such Event or entered by an NF in such Event) if that Athlete and/or Horse has participated, in the six (6) months prior to the first day of the International Event or National Event in question, in an Unsanctioned Event.</em><br><em>5. For purposes of Article 113.4, an ‘Unsanctioned Event’ is an event and/or a competition that is neither published in the official Calendar nor authorised by an NF and/or a National Event authorised or organised by a NF that is suspended by the FEI. Please also refer to the Appendix J for the rationale for the Unsanctioned Event Provisions.</em></p>



<p><strong>2) Article 155 – Status and Liability of Officials. Points 7-12.</strong><br><em>7. An Official is not eligible to participate in an International Event or National Event (and so may not be invited or nominated to participate in such event) if he/she has participated, in the six (6) months prior to the first day of the International Event or National Event in question, in an Unsanctioned Event.</em><br><em>8. For purposes of Article 155.7, an ‘Unsanctioned Event’ is an event and/or a competition that is neither published in the official Calendar nor authorised by an NF and/or a National Event authorised or organised by a NF that is suspended by the FEI. Please also refer to the Appendix J for the rationale for the Unsanctioned Event Provisions.</em></p>



<p><strong>3) APPENDIX J – Rationale for the Unsanctioned Events Provisions</strong></p>



<p>Nevertheless, if judging a test online is done purely for training and educational purposes and it is not a “competition” (<strong><em>riders don’t compete against each other, no result list, no placings, no ranking and no prizes.</em></strong> .) – this is allowed.</p>



<p><strong>Please also keep in mind that the conflict of interest rules apply at all times, as described in Annex 9, Codex for FEI Dressage Judges and in the FEI General Regulations</strong>.</p>



<p>Please note as well that all intellectual property rights in the FEI Dressage Tests are held by the FEI and reproduction of the FEI Dressage Tests (especially when they are made available or linked to for a fee) is not permitted without a formal license agreement from the FEI.</p>



<p>Though we still have to keep in mind that judging on video may be different from judging in real life. The video takes away the peaks: top quality looks less and mistakes and not so good quality might look better.If you judge videos from riders, trainers – require quality of recording, video quality and camera angle (from specific letter).</p>



<p>Once in a while you will be asked to judge a ride from an already over (finished) competition – my common sense must prevail and say NO to this. It almost always brings you or a colleague in a difficult situation. Always ask the submitting part about circumstances and background. Is this a training-ride ? Have other judges seen it/given feedback already ?</p>



<p>If you set up a professional online platform, be ready to be questioned about your independence and impartiality. Even though we almost must act as “professionals” we are volunteer amateurs on most levels and in big parts of the world.</p>



<p>Stay safe and healthy.</p>',
    'published',
    '2020-04-15T18:04:09Z'::timestamptz,
    '2020-04-15T18:04:09Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/idoc-end-of-year-2022/ (wp post id 1354)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'idoc-end-of-year-2022',
    'IDOC End Of Year 2022',
    'Dear members, ​​​​​​Dear friends, Another year has come to an end, and the feeling that we still are in a post-Covid difficult situation is still dominant. Fortunately, many countries now',
    '<p>Dear members, ​​​​​​<br>Dear friends, </p>



<p>Another year has come to an end, and the feeling that we still are in a post-Covid difficult situation is still dominant. Fortunately, many countries now have the situation under control and the restrictions have been lifted; however, we know that this is not the case to all countries, so we hope that soon we all, without exceptions, can put Covid behind us.</p>



<p>Unfortunately, 2022 brought another very difficult challenge – the Ukraine war –, which has had a very strong impact to many of us. Our wish and hope for 2023 is that this long period of instability and insecurity can come to an end.</p>



<p> Despite this situation, we continue to bring out the possible from the impossible. We see many competitions everywhere, the number of starters is increasing week by week and happily, many officials are again busy and traveling across national borders. </p>



<p>Nevertheless, unity is more important than ever. We started now to see a greater proximity and more joining efforts with the other stakeholder clubs aiming to achieve the best results in the sport. Not only in relation to each other but also in relation to the FEI. Many other interested partners like the EEF have announced their arrival in the “arena”. We look forward to a higher development of cooperation with the new Chair (Sissy Max-Theurer), and the other officials of the EEF dressage working group. </p>



<p>This year there has been a lot of debate about rule changes and especially changes in officials’ status (from Stars to Levels). At the FEI General Assembly in South Africa it ended with a compromise, in order to harmonize FEIs systems, and still acknowledging the dressage officials status. It was a great joint venture by all the stakeholder clubs, but it should not be necessary to join forces as a united block against the FEI. FEI must be more of a unifying organism, and more service-oriented towards its stakeholders. We (IDOC/and the other Clubs) have the same goals as the FEI and work under the same Code of Conduct and rules, therefore it´s important that our feedback is valued and supported on a daily basis. </p>



<p>IDOC now has a new MOU (Memorandum of Understanding) with FEI, with improvement and acknowledgements in the direction of a higher level of cooperation, which we hope and believe that this will be the key ingredient to success in 2023.</p>



<p>Throughout the year IDOC has been very active and has organized several seminars and educational opportunities for the Officials worldwide. Once again, I would like to take the chance to thank all the people that have made it possible. It is a lot of work, but so important. I would also like to thank the FEI Education Department, Course Directors and BlackHorseOne for their commitment and continuous support of our ideas. BlackHorseOne has been far-sighted and has developed solutions for improving Dressage branding and the results software. </p>



<p>In our regions we have had a lot of activity, many officials are deeply involved in their national federations and spend a lot of time helping and trying to develop new ideas and competitions. One thing has not changed, and that is some of the outer world’s view and some criticism of the sport. There are many critical voices, and these should not be discarded and overlooked.</p>



<p>We must not end up in a situation where we do not find the courage to defend our traditions and sport. Unfortunately, the situation is often polarized, and many are unwilling to participate in a conflicting discussion or other more radical “reprimands” by internet trolls. This is not only in dressage, but a more generalized tendency in todays world (read: the internet). We tend to isolate in smaller groups without having to deal with the outside world. But we should not be afraid, we have nothing to hide. In dressage we strive for perfection or “excellency” – but most horse-people also know, that “excellent” only strikes occasionally…. or at the best once in a lifetime (at least very seldom !) But we keep training and try to improve all the time. The welfare of the horse must always be paramount, and we must all act like guardians in that respect. We can certainly improve in some areas, and we must always seek to reward good harmony between horse and rider. But the concept of welfare, however must not end up as a dead-end and act as a stumbling block in discussions in relation to sport progress.</p>



<p>Sometimes one must look back/forward/across the room to find new ways and solutions. We must stay open. Our sport is always described as being conservative: that can be good in a way that we care about our proud traditions and all the knowledge it brings with it, but it can also be conservative in a more negative way: not willing to change or see new possibilities. </p>



<p>The role of IDOC is also taking the lead and help in creating new alliances and understandings that together will ensure an even better future for the sport. Officials must at any time be educated and supported by the FEI in order to be respected player´s in the sport. IDOCs goal is to become the most important stakeholder club in the FEI dressage family. Our ambition is to be broadly represented, at all levels, with as many members as possible. We will continue our efforts in the education and intend to involve more and new Officials candidates. </p>



<p>To close, I have one more important thing to say: Thank you for joining the club. Thank you to our board members. Congratulations to the new elected board – the coming year will be exciting. </p>



<p>Thank you to the outgoing members; You have done a fantastic job; all IDOC members are truly grateful and I wish you the best of luck for the future. Finally, and not least, thank you Olivier (Smeets) for many years of hard work as our Secretary. You have been a rock and great support not only for me but for all members. I am sure many of our members have been helped and correctly guided by you, as a true gentleman, good friend and colleague.</p>



<p>Thank You. I wish you all a peaceful, happy and prosperous New Year 2023. </p>



<p>Copenhagen, Dec 2022</p>



<p>Hans Christian Matthiesen</p>



<p>President, IDOC</p>',
    'published',
    '2022-12-30T20:45:00Z'::timestamptz,
    '2022-12-30T20:45:00Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/integrity-beyond-compliance/ (wp post id 3305)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'integrity-beyond-compliance',
    'Integrity Beyond Compliance',
    'by Hans Christian Matthiesen',
    '<h2><strong>Code of Conduct and Conflict of Interest in FEI Dressage Judging</strong></h2>
<p><em>For FEI International Dressage Officials</em></p>
<p><strong>Introduction</strong></p>
<p>As FEI International Dressage Official, we operate within one of the most technically demanding and publicly scrutinised disciplines in equestrian sport. Our legitimacy depends not only on technical competence, but on the <strong>trust</strong> placed in us by athletes, trainers, owners, organisers, sponsors, and the wider public.</p>
<p>The FEI regulatory framework—particularly the <strong>FEI Code of Conduct for the Welfare of the Horse</strong>, the <strong>FEI General Regulations</strong>, and discipline-specific rules—provides clear guidance on conflicts of interest and ethical behaviour. However, strict compliance with the letter of the rules does not automatically eliminate the <em>perception</em> of a conflict.</p>
<p>In today’s environment, perception can influence credibility as strongly as fact. For the integrity of our sport, we must therefore think beyond what is merely permissible and consider how our roles are interpreted by others.</p>
<h3><strong>1.  The FEI Code of Conduct and Ethical Framework</strong></h3>
<p>The <strong>FEI Code of Conduct for the Welfare of the Horse</strong> establishes that the welfare of the horse must be paramount and must never be subordinated to competitive or commercial interests. This principle underpins all officiating activity.</p>
<p>The <strong>FEI General Regulations (GRs)</strong> contain explicit provisions regarding:</p>
<ul>
<li><strong>Conflict of Interest (Art. 158 GRs)</strong></li>
<li><strong>Officials’ impartiality and independence</strong></li>
<li><strong>Duty of disclosure</strong></li>
<li><strong>Standards of behaviour expected of FEI Officials</strong></li>
</ul>
<p>The regulations clearly outline situations in which an official must decline an appointment or recuse themselves, including:</p>
<ul>
<li>Close personal or family relationships with athletes</li>
<li>Financial interest in horses competing</li>
<li>Coaching relationships within specified timeframes</li>
<li>Business partnerships connected to participants</li>
</ul>
<p>These rules are robust, structured, and fair. They create an operational boundary for acceptable conduct.</p>
<p>But compliance is only the starting point.</p>
<h3><strong>2.  Code of Conduct vs. Conflict of Interest</strong></h3>
<p>There is an important distinction between:</p>
<ul>
<li><strong>Formal conflict of interest (as defined in regulations)</strong></li>
<li><strong>Perceived conflict of interest (as experienced by stakeholders)</strong></li>
</ul>
<p>A formal conflict is objective and rule-based.<br>
A perceived conflict is subjective—but no less powerful.</p>
<p>An official may technically comply with all FEI rules and still face questions such as:</p>
<ul>
<li>“Is this judge also commercially active in the same market?”</li>
<li>“Does this judge train riders at the same level?”</li>
<li>“Is there a business interest in horse sales?”</li>
<li>“Does the judge have close family involvement in the sport at elite level?”</li>
<li>“Is the judge closely involved with the organiser of this event?”</li>
</ul>
<p>Even when these activities fall within regulatory allowances, they may create <strong>perceived alignment of interests</strong>.</p>
<p>And perception shapes confidence.</p>
<h3><strong>3. Areas of Particular Sensitivity in Dressage</strong></h3>
<p>Dressage, more than many disciplines, operates within a close professional network. Many judges have extensive backgrounds as trainers, breeders, riders, or organisers. This expertise strengthens the sport—but it also creates potential overlap.</p>
<p>Sensitive areas may include:</p>
<ol>
<li><strong> Training Activities<br>
</strong>Judges who actively train riders—especially at international level—must ensure clear separation between judging duties and coaching roles. Even when time restrictions are respected, others may question neutrality if professional proximity is visible.</li>
</ol>
<ol>
<li><strong> Buying and Selling Horses<br>
</strong>Involvement in horse trade, breeding operations, or consultancy services can create perceived financial alignment with specific athletes or owners.</li>
</ol>
<ol>
<li><strong> Event Organisation<br>
</strong>Judges who are also organisers or closely linked to organising committees may appear institutionally aligned.</li>
</ol>
<ol>
<li><strong> Family Relationships<br>
</strong>Family members competing at high levels—even when not at the same event—can raise questions about broader network influence.</li>
</ol>
<p>None of these are inherently unethical. Many are explicitly regulated and permitted within limits. The issue arises when stakeholders perceive blurred boundaries between regulatory authority and commercial or competitive interest.</p>
<h3><strong>4.  The Risk of Erosion of Trust</strong></h3>
<p>Modern sport operates in an environment of transparency and scrutiny. Social media, livestreaming, public score analysis, and investigative reporting mean that officiating decisions are examined more intensely than ever.</p>
<p>Research in sports governance consistently shows that:</p>
<ul>
<li><strong>Perceived bias can damage institutional legitimacy—even in the absence of proven misconduct.</strong></li>
<li>Public trust depends on visible independence as much as actual independence.</li>
<li>Governance bodies are judged not only on fairness, but on the appearance of fairness.</li>
</ul>
<p>For dressage—already under increased welfare scrutiny—this is particularly significant.</p>
<p>If stakeholders believe that officials are too closely intertwined with commercial, training, or competitive networks, the credibility of judging decisions may suffer, regardless of their technical accuracy.</p>
<h3><strong>5.  The Principle of “Distance”</strong></h3>
<p>One of the strongest tools available to us is <strong>professional distance</strong>.</p>
<p>This does not mean disengagement from the sport. It means conscious boundary-setting:</p>
<ul>
<li>Being conservative in interpreting eligibility boundaries.</li>
<li>Declining appointments where there is even moderate potential for perceived partiality.</li>
<li>Avoiding dual roles that may blur authority and commercial interest.</li>
<li>Proactively declaring relationships—even when not strictly required.</li>
<li>Asking: <em>“How would this look from the outside?”</em></li>
</ul>
<p>The most effective safeguard is self-awareness.</p>
<h3><strong>6.  Integrity as a Collective Responsibility</strong></h3>
<p>Integrity is not a personal defence mechanism—it is a collective asset.</p>
<p>When one official’s neutrality is questioned, the reputation of the entire officiating community is affected.</p>
<p>Respect for officials is not guaranteed by title; it is earned through:</p>
<ul>
<li>Consistent impartiality</li>
<li>Transparent conduct</li>
<li>Conservative ethical judgment</li>
<li>Willingness to step back when necessary</li>
</ul>
<p>The FEI regulatory system provides a fair and structured framework. But the spirit of the rules requires something more: <strong>ethical maturity and situational awareness</strong>.</p>
<h3><strong>7.  Seeing Through Others’ Eyes</strong></h3>
<p>Perhaps the most important exercise for any official is perspective-taking.</p>
<p>We may feel confident that:</p>
<ul>
<li>We are fair.</li>
<li>We are unbiased.</li>
<li>We comply with regulations.</li>
</ul>
<p>But riders, trainers, owners, and the public may interpret overlapping roles differently.</p>
<p>Their perspective is shaped by:</p>
<ul>
<li>Financial investment in the sport.</li>
<li>Emotional investment in performance outcomes.</li>
<li>Broader societal expectations of governance transparency.</li>
<li>Heightened sensitivity to welfare issues.</li>
</ul>
<p>Understanding their viewpoint does not imply wrongdoing—it demonstrates leadership.</p>
<h3><strong>Conclusion</strong></h3>
<p>The FEI rules on Conflict of Interest and the Code of Conduct are clear, structured, and fair. They define minimum standards for participation as an official.</p>
<p>However, the sustainability of dressage depends not only on rule compliance but on <strong>visible independence and ethical distance</strong>.</p>
<p>We must continually ask ourselves:</p>
<ul>
<li>Am I within the rules?</li>
<li>Am I within the spirit of the rules?</li>
<li>How might this be perceived by others?</li>
<li>Does this strengthen or weaken trust in our profession?</li>
</ul>
<p>Sometimes the most responsible decision is not the one that is technically allowed—but the one that reinforces confidence in our integrity.</p>
<p>For the credibility of our sport and the respect afforded to the officiating community, we must hold ourselves not only to regulatory standards—but to the higher standard of trust.</p>
<p>Integrity is not only about being right.<br>
It is about being seen to be right.</p>',
    'published',
    '2026-03-06T14:26:09Z'::timestamptz,
    '2026-03-06T14:26:09Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/new-research-on-stress-in-dressage-horses/ (wp post id 3319)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'new-research-on-stress-in-dressage-horses',
    'New Research on Stress in Dressage Horses',
    'by Hans Christian Matthiesen',
    '<p>A recent study published in <em>Animals</em> investigated stress-related behaviours in <strong>238 dressage horse-rider combinations</strong> competing at national levels, using objective measures and video analysis to quantify conflict behaviours such as mouth opening, tail swishing, and head-neck changes.</p>
<h3><strong>Key Findings</strong></h3>
<ul>
<li><strong>Noseband tightness was measured using the FEI Noseband Measuring Device</strong><br>
Almost all horses complied with current FEI rules — indicating good general adherence to equipment standards.</li>
<li><strong>Competition difficulty influences stress behaviour:<br>
</strong>At lower levels, horses showed a <em>wider variety</em> of stress behaviours at relatively <em>lower frequency</em>. At higher levels (e.g., Medium to Grand Prix), horses showed <em>fewer types of behaviours but more often</em>, with <strong>mouth behaviour becoming predominant</strong>.</li>
<li><strong>Bridle type matters:</strong><br>
Horses ridden in a <strong>double bridle</strong> exhibited higher proportions of conflict behaviours than those ridden in a snaffle, suggesting that equipment choice interacts with how stress is expressed.</li>
<li><strong>Judging scores may not reflect stress behaviour levels:</strong><br>
At higher levels of competition, the study found <strong>no strong relationship between the amount of observable stress behaviour and performance scores</strong> — meaning excellent technical execution can mask underlying stress. The judges included in the study were not FEI (international) trained, but national judges.</li>
</ul>
<h3><strong>What This Means for FEI Dressage Judges</strong></h3>
<p><strong>Judging doesn’t end with performance quality:</strong><br>
This research highlights that horses at higher levels may limit the <em>type</em> of stress behaviours they show but exhibit them <em>more intensely</em>, especially mouth-related behaviours — often <strong>without influencing scores</strong>.</p>
<h3><strong><br>
Factors to consider beyond technical execution:</strong></h3>
<ul>
<li>Awareness that a “clean” performance may still involve internal stress</li>
<li>Considering how equipment (e.g., double bridles) might influence behaviour</li>
<li>Understanding that stress indicators might not align with technical marks — especially at Medium and above</li>
</ul>
<h3><strong>Horse welfare and scoring:</strong></h3>
<p>The findings suggest an opportunity to integrate welfare-sensitive measures into judging philosophy — without compromising FEI rules — acknowledging that some stress behaviours are not currently penalised under existing scoring structures.</p>
<p>Lower levels versus Higher levels dressage: Higher levels tests and movements contains often significantly more elements than lower levels movements. Judges may take many of these elements into consideration.</p>
<h3><strong>In Practice</strong></h3>
<p>✔ Use observational skills to note subtle conflict behaviours (e.g., repeated mouth opening)<br>
✔ Recognise that equipment compliance (with the FEI Noseband Measuring Device) is usually good, but behavioural stress can still occur at higher difficulty levels<br>
✔ Promote discussions about how dressage scoring and welfare indicators can be better aligned on the international stage</p>
<h3><em><br>
Reference:</em></h3>
<p>Simona Fialová et al., <em>Stress Responses in Dressage Horses: Insights from FEI Noseband Measurements Across National Competition Levels</em>, <em>Animals</em> 2026, 16(3), 518.</p>',
    'published',
    '2026-03-06T16:53:47Z'::timestamptz,
    '2026-03-06T16:53:47Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen/ (wp post id 3332)
WITH ins AS (
  INSERT INTO idoc.news_articles (slug, title, subtitle, content_html, status, publication_date, published_at, created_by_user_id, updated_by_user_id)
  VALUES (
    'modern-dressage-judging-perception-data-and-the-evolving-role-of-welfareby-hans-christian-matthiesen',
    'Modern Dressage Judging: Perception, Data, and the Evolving Role of Welfare: by Hans Christian Matthiesen',
    'Recent public discussions have raised questions regarding judging standards and score distribution in international dressage. This article integrates professional reflection with quantitative data analysis provided by Daniel Göhlen (BlackHorseOne) to examine whether perceived changes in scoring r...',
    '<p><strong>Abstract</strong></p>
<p>Recent public discussions have raised questions regarding judging standards and score distribution in international dressage. This article integrates professional reflection with quantitative data analysis provided by Daniel Göhlen (BlackHorseOne) to examine whether perceived changes in scoring reflect actual trends. The findings indicate that scoring levels have remained relatively stable over time, with only minor regional differences between Europe and North America. However, a clear shift is observed in judging emphasis, with increasing attention to welfare-related indicators such as contact quality, tension, and conflict behaviour. The article argues that modern dressage judging reflects an evolution toward welfare-oriented and training-based evaluation rather than inconsistency or undue strictness. It further highlights the shared responsibility among judges, riders, and trainers in shaping the future of the sport.</p>
<p><strong>Introduction</strong></p>
<p>In recent days, public discussion has emerged following posts on Social Media regarding judging standards and score distribution. The level of engagement reflects a strong collective commitment to the sport, which is both encouraging and necessary.</p>
<p>At the same time, it is essential that such discussions are grounded not only in perception, but also in <strong>data, professional context, and an understanding of broader developments</strong> affecting equestrian sport globally. Dressage, particularly at the international level, can at times operate within a relatively closed environment. It is therefore important to remain aware of external expectations, especially concerning <strong>animal welfare and transparency</strong>.</p>
<p>This article is written for dressage officials and reflects my analyses and opinions, with the aim of making the discussion more fact-based. It is not intended as evidence, but rather as an indication of the direction in which the sport is evolving.</p>
<p><strong>Professional Responsibility and Communication</strong></p>
<p>From the perspective of an FEI judge and IDOC member, it is important to emphasise that while open dialogue is fundamental, <strong>the context and manner of communication are equally critical</strong>.</p>
<p>Public commentary that may be perceived as endorsing criticism of specific judging panels risks undermining confidence in the officiating system. Judges operate within a framework that requires:</p>
<ul>
<li>Independence</li>
<li>Consistency</li>
<li>Accountability</li>
<li>Collective professional responsibility</li>
</ul>
<p>Maintaining trust in this system is essential for riders, owners, organisers, and the long-term credibility of the sport.</p>
<p><strong>Scoring Trends: Evidence vs. Perception</strong></p>
<p>Analysis of FEI results over time (Figure 1) demonstrates:</p>
<ul>
<li><strong>Stable scoring levels across Grand Prix and Freestyle</strong></li>
<li>No clear evidence of systematic <strong>score inflation</strong></li>
<li>Minor fluctuations corresponding to performance variation rather than judging trends</li>
</ul>
<p>This challenges the perception that judges are consistently marking lower or that standards have tightened arbitrarily.</p>
<p>Rather, the data suggests <strong>greater consistency and calibration in judging.</strong></p>
<p>Analysis of FEI results shows relatively stable scoring without clear in- or deflation trends (Figure 1).</p>
<p><strong> </strong></p>
<p>Figure 1. Average FEI results over time.</p>
<p><strong>Regional Comparison</strong></p>
<p>A frequent claim is that scoring differs significantly between Europe and North America. However, the data (Figure 2) indicates:</p>
<ul>
<li>Differences are <strong>relatively small</strong></li>
<li>Trends are <strong>parallel across regions</strong></li>
<li>Judging appears <strong>well harmonised at FEI level</strong></li>
</ul>
<p>Figure 2. Comparison of Europe vs North America.</p>
<p>Perceived discrepancies are therefore more likely linked to <strong>individual competitions, panels, or expectations</strong>, rather than systemic regional bias. If scores are correlated with the amount of Top10/20 riders in the region, the results are changing towards relatively higher overall scores in North America.</p>
<p><strong>Shift Toward Welfare &amp; Harmony-Oriented Evaluation</strong></p>
<p>The most significant development is not found in score levels, but in <strong>what judges are increasingly prioritising</strong>.</p>
<p>Analysis of comment trends (Figures 3 and 4) shows a clear increase in:</p>
<ul>
<li>Mouth/contact-related issues</li>
<li>Tension and rigidity</li>
<li>Indicators linked to head and neck position</li>
<li>General harmony</li>
</ul>
<p>These findings align with:</p>
<ul>
<li>The <strong>Scale of Training (FEI Art. 401)</strong></li>
<li>Increased scientific understanding of equine biomechanics</li>
<li>Growing societal expectations regarding animal welfare</li>
</ul>
<p>Modern judging is therefore increasingly reflecting <strong>quality of training and welfare indicators</strong>, rather than solely technical execution.</p>
<p>There is a clear increase in welfare-related comments such as mouth/contact and tension (Figure 3).</p>
<p>Figure 4. Most common comment/remark categories.</p>
<p><strong>Implications for Judging Practice</strong></p>
<p>Judging today involves a <strong>multidimensional assessment</strong>, including (not prioritized):</p>
<ul>
<li>Technical correctness</li>
<li>Quality of movement</li>
<li>Harmony and relaxation</li>
<li>Evidence of correct training</li>
<li>Absence of conflict behaviour</li>
</ul>
<p>This represents a <strong>refinement of evaluation criteria</strong>, not a restriction of scoring.</p>
<p>It is also important to emphasise that:</p>
<p><strong>Scores must always be earned.</strong></p>
<p>Using higher marks as a motivational tool risks undermining:</p>
<ul>
<li>Credibility</li>
<li>Transparency</li>
<li>Fair competition</li>
</ul>
<p><strong>Shared Responsibility in Sport Development</strong></p>
<p>While communication from judges must improve, responsibility does not lie with judges alone.</p>
<p>Riders and trainers must also:</p>
<ul>
<li>Adapt training principles to the <strong>individual horse and situation (competition)</strong></li>
<li>Align goals with the <strong>combination’s level of development</strong></li>
<li>Prioritise <strong>long-term training over short-term results</strong></li>
</ul>
<p>The development of the sport happens primarily <strong>in daily training environments</strong>, not only in competition.</p>
<p><strong>Discussion</strong></p>
<p>The findings suggest that dressage is currently undergoing a <strong>structural and cultural transition</strong>.</p>
<p>Three key dynamics are shaping this evolution:</p>
<ol>
<li><strong> Welfare Integration into Judging</strong></li>
</ol>
<p>Judging is increasingly aligned with welfare considerations, integrating behavioural and biomechanical indicators into scoring.</p>
<ol>
<li><strong> Alignment with Societal Expectations</strong></li>
</ol>
<p>Public scrutiny of equestrian sport is increasing, particularly regarding:</p>
<ul>
<li>Ethical use of horses</li>
<li>Transparency in judging</li>
<li>Training practices</li>
</ul>
<ol>
<li><strong> Internal Tension Between Tradition and Adaptation</strong></li>
</ol>
<p>Dressage remains a tradition-based sport, which can slow adaptation. However, long-term sustainability requires <strong>responsiveness to change</strong>.</p>
<p><strong>Limitations</strong></p>
<p>This analysis should be interpreted within certain limitations:</p>
<ul>
<li>The dataset is limited to <strong>available FEI competition data</strong> and may not capture all regional nuances</li>
<li>Comment analysis reflects <strong>recorded judging language</strong>, which may vary between judges and competitions</li>
<li>Quantitative data does not fully capture <strong>contextual judging decisions</strong>, including panel dynamics and competition-specific factors</li>
<li>Perception among riders and trainers is influenced by <strong>expectations and experience</strong>, which are not directly measurable</li>
</ul>
<p>Despite these limitations, the consistency of trends across datasets supports the overall conclusions.</p>
<p><strong>Conclusion</strong></p>
<p>The available data does not support the notion of inconsistent or regionally biased judging. Instead, it indicates:</p>
<ul>
<li><strong>Stable scoring levels</strong></li>
<li><strong>High degree of international harmonisation</strong></li>
<li>A clear shift toward <strong>welfare-oriented and training-based evaluation</strong></li>
</ul>
<p>Dressage is evolving, and this evolution requires:</p>
<ul>
<li>Open dialogue</li>
<li>Professional responsibility</li>
<li>Willingness to adapt</li>
</ul>
<p>Public comments that can be interpreted as endorsing criticism of fellow judges may unintentionally undermine confidence in the officiating system as a whole. Our role requires not only independence and integrity in our judging, but also a sense of collective responsibility toward the credibility and unity of our profession.</p>
<p>Constructive discussions about standards, trends, and interpretations are absolutely necessary. These conversations should continue to happen—ideally within professional and educational environments where context, nuance, and mutual respect are fully preserved.</p>
<p>Ultimately, the future of the sport depends on a <strong>shared commitment</strong> from judges, riders, trainers, and governing bodies.</p>
<p><strong>References</strong></p>
<ul>
<li>Göhlen, D. (BlackHorseOne). <em>FEI Dressage Data Analysis (2016–2026)</em></li>
<li>FEI Dressage Rules (latest edition)</li>
<li>FEI Guidelines for Judging Dressage</li>
</ul>',
    'published',
    '2026-04-07T17:55:38Z'::timestamptz,
    '2026-04-07T17:55:38Z'::timestamptz,
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  )
  ON CONFLICT (slug) DO NOTHING
  RETURNING id, slug, title, status
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.news_article.created', 'news_article', ins.id::text,
  jsonb_build_object('slug', ins.slug, 'status', ins.status, 'title', ins.title)
FROM ins;


-- Seminars (legacy category: seminars) (4 rows) ----------------------------------
-- source: https://idoc.club/para-dressage-transfer-up-course-for-l2-judges/ (wp post id 3242)
WITH ins AS (
  INSERT INTO idoc.seminars (title, description, seminar_date, start_time, end_time, timezone, location, capacity, price_cents, registration_deadline, status, payment_method_canonical_id, created_by_user_id, updated_by_user_id)
  SELECT
    'Para Dressage Transfer Up Course for L2 Judges',
    'Source: https://idoc.club/para-dressage-transfer-up-course-for-l2-judges/

Hartpury, Great Britain

June 27th-28th, 2026

Levels:  All levels

Language English

Nb participants 5 to 20

Organising NF:  Great Britain

COURSE DIRECTOR(S): Marco ORSINI (GER) – Anne PRAIN (FRA)

PARTICIPANT(S) PROFILE(S):

Open to all Level 1 Judges or National Judges from NFs with Equivalency wishing to become a Level 2 Para Dressage Judges.

All Candidates must be entered into the FEI Online Course Calendar by their NF. The Course is limited to min. 5 / (max. 10 participants.)

By registering the Candidate, the NF is endorsing the candidate and confirms that they have fulfilled the entry requirements to attend the Course according to the Education System for Para Dressage Judges.

COURSE VENUE INFORMATION

Combined Transfer-up Course with Level 3 Para Dressage Judges.

Hartpury University and College, Hartpury, Gloucestershire, GL19 3BE Nearest airport: Bristol (1h20) Please note that the transfer from the aiport will NOT be arranged for the participants.

Meeting Room amenities: Free WIFI connection, extensions cables, notepads and pens.

Catering: Bottled water, coffee breaks (coffee, tea and snacks) and lunches will be served at the venue on all course days.

Course will be held over 2 full days therefore participants are invited to arrive on site the night before.

 

APPLICATION DEADLINE:  May 15th, 2026

APPLICATION

All Applications must be entered directly by NFs via the FEI Database Course Calendar. If you have any questions regarding registration, please contact Thya.moritz@fei.org & natashapearce@britishdressage.co.uk

COURSE FEE

150.00 GBP

PAYMENT INFORMATION

Participants will be required to make the payement using the below horse monkey link once registrations are confirmed. https://horsemonkey.com/equestrian_event/77633/4597++FEI+Para+Judge+Level+23+Transfer-up+Course

ACCOMMODATION INFORMATION

Premier Inn, Gloucester (Barnwood), Centre Seven, Gloucester, GL4 3HR Room prices : £80-£120 per night for double room Booking via premier inn website:

https://www.premierinn. com/gb/en/hotels/england/gloucestershire/gloucester/gloucester-barnwood.html? cid=BMF_GLOWHE',
    '2026-06-27'::date,
    '09:00'::time,
    '17:00'::time,
    'Europe/London',
    'Hartpury University and College, Hartpury, Gloucestershire, GL19 3BE, Great Britain',
    10,
    15000,
    '2026-05-15T23:59:00Z'::timestamptz,
    'draft',
    'online_stripe',
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  WHERE NOT EXISTS (
    SELECT 1 FROM idoc.seminars s
    WHERE s.title = 'Para Dressage Transfer Up Course for L2 Judges' AND s.seminar_date = '2026-06-27'::date
  )
  RETURNING id, title, status, capacity, payment_method_canonical_id
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.seminar.created', 'seminar', ins.id::text,
  jsonb_build_object('capacity', ins.capacity, 'paymentMethodId', ins.payment_method_canonical_id,
    'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/para-dressage-transfer-up-course-for-l3-judges/ (wp post id 3244)
WITH ins AS (
  INSERT INTO idoc.seminars (title, description, seminar_date, start_time, end_time, timezone, location, capacity, price_cents, registration_deadline, status, payment_method_canonical_id, created_by_user_id, updated_by_user_id)
  SELECT
    'Para Dressage Transfer Up Course for L3 Judges',
    'Source: https://idoc.club/para-dressage-transfer-up-course-for-l3-judges/

Hartpury, Great Britain

June 27th-28th, 2026

Levels: Level 3

Language English

Nb participants 5 to 20

Organising NF: Great Britain

COURSE DIRECTOR(S): Marco ORSINI (GER) – Anne PRAIN (FRA)

PARTICIPANT(S) PROFILE(S):

Marco ORSINI (GER) – Anne PRAIN (FRA) PARTICIPANT(S) PROFILE(S) Open to all Level 2 Judges from all NFs wishing to become a Level 3 Para Dressage Judges.

All Candidates must be entered into the FEI Online Course Calendar by their NF. The Course is limited to min. 5 / (max. 20 participants.)

By registering the Candidate, the NF is endorsing the candidate and confirms that they have fulfilled the entry requirements to attend the Course according to the Education System for Para Dressage Judges.

COURSE VENUE INFORMATION

Combined Transfer-up Course with Level 2 Para Dressage Judges.

Hartpury University and College, Hartpury, Gloucestershire, GL19 3BE Nearest airport: Bristol (1h20) Please note that the transfer from the aiport will NOT be arranged for the participants.

Meeting Room amenities: Free WIFI connection, extensions cables, notepads and pens.

Catering: Bottled water, coffee breaks (coffee, tea and snacks) and lunches will be served at the venue on all course days.

Course will be held over 2 full days therefore participants are invited to arrive on site the night before.

APPLICATION DEADLINE: May 15th, 2026

APPLICATION

All Applications must be entered directly by NFs via the FEI Database Course Calendar. If you have any questions regarding registration, please contact Thya.moritz@fei.org & natashapearce@britishdressage.co.uk

COURSE FEE

150.00 GBP

PAYMENT INFORMATION

Participants will be required to make the payement using the below horse monkey link once registrations are confirmed. https://horsemonkey.com/equestrian_event/77633/4597++FEI+Para+Judge+Level+23+Transfer-up+Course

ACCOMMODATION INFORMATION

Premier Inn, Gloucester (Barnwood), Centre Seven, Gloucester, GL4 3HR Room prices : £80-£120 per night for double room Booking via premier inn website:

https://www.premierinn. com/gb/en/hotels/england/gloucestershire/gloucester/gloucester-barnwood.html? cid=BMF_GLOWHE',
    '2026-06-27'::date,
    '09:00'::time,
    '17:00'::time,
    'Europe/London',
    'Hartpury University and College, Hartpury, Gloucestershire, GL19 3BE, Great Britain',
    20,
    15000,
    '2026-05-15T23:59:00Z'::timestamptz,
    'draft',
    'online_stripe',
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  WHERE NOT EXISTS (
    SELECT 1 FROM idoc.seminars s
    WHERE s.title = 'Para Dressage Transfer Up Course for L3 Judges' AND s.seminar_date = '2026-06-27'::date
  )
  RETURNING id, title, status, capacity, payment_method_canonical_id
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.seminar.created', 'seminar', ins.id::text,
  jsonb_build_object('capacity', ins.capacity, 'paymentMethodId', ins.payment_method_canonical_id,
    'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/dress-judge-maintenance-course-falstervbo/ (wp post id 3346)
WITH ins AS (
  INSERT INTO idoc.seminars (title, description, seminar_date, start_time, end_time, timezone, location, capacity, price_cents, registration_deadline, status, payment_method_canonical_id, created_by_user_id, updated_by_user_id)
  SELECT
    'Dressage Judge Maintenance Course',
    'Source: https://idoc.club/dress-judge-maintenance-course-falstervbo/

Falsterbo, Sweden

July 10th, 2026

Levels:  1/2/3

Language English

Nb participants 8 to 20

Organising NF:  Sweden

COURSE DIRECTOR(S): Susanne BAARUP (DEN)

PARTICIPANT(S) PROFILE(S):

All FEI Level 1, 2 and 3 Dressage Judges (separate assessment for L1 and L2/3 Judges).

L4 Judges needing a maintenance course in 2026 are welcome to participate.

Limited to max. 20 participants on a first come first served basis.

If the course is oversubscribed, quotas per NF may be applied.

All Participants must be entered by their NF.

Please do not make any travel arrangements until the course and your participation have been confirmed.

COURSE VENUE INFORMATION

Falsterbo Horse Show Arena Clemensagervägen

23942 Falsterbo, Sweden

APPLICATION DEADLINE:  June 2nd, 2026

APPLICATION

All Applications must be entered directly by NFs via the FEI Database Course Calendar. If you have any questions regarding registration, please contact anna.milne@fei.org & secretary@idoc.club

Alexandre Lacerda Leão – secretary@idoc.club

COURSE FEE

300.00 EUR

PAYMENT INFORMATION

PAY ONLINE

Cash upon arrival

Bank Transfer:

Beneficiary: IDOC

Bank name: KBC, 58 Nieuwstraat,2910 Essen (Belgium) BIC/SWIFT: KREDBEBB

IBAN: BE67 4163 2131 2187

ACCOMMODATION INFORMATION

TBD

Nearest airports: Malmö SWE (50km) or Copenhagen DEN (48 km)',
    '2026-07-10'::date,
    '09:00'::time,
    '17:00'::time,
    'Europe/Stockholm',
    'Falsterbo Horse Show Arena, Clemensagervagen, 23942 Falsterbo, Sweden',
    20,
    30000,
    '2026-06-02T23:59:00Z'::timestamptz,
    'published',
    'bank_transfer',
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  WHERE NOT EXISTS (
    SELECT 1 FROM idoc.seminars s
    WHERE s.title = 'Dressage Judge Maintenance Course' AND s.seminar_date = '2026-07-10'::date
  )
  RETURNING id, title, status, capacity, payment_method_canonical_id
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.seminar.created', 'seminar', ins.id::text,
  jsonb_build_object('capacity', ins.capacity, 'paymentMethodId', ins.payment_method_canonical_id,
    'status', ins.status, 'title', ins.title)
FROM ins;

-- source: https://idoc.club/young-horse-seminar-verden-2026-save-the-date/ (wp post id 3299)
WITH ins AS (
  INSERT INTO idoc.seminars (title, description, seminar_date, start_time, end_time, timezone, location, capacity, price_cents, registration_deadline, status, payment_method_canonical_id, created_by_user_id, updated_by_user_id)
  SELECT
    'Young Horse Seminar, Verden 2026 – Save the Date!',
    'Source: https://idoc.club/young-horse-seminar-verden-2026-save-the-date/

Verden, Germany

August 6-8, 2026

Levels:  Open to all levels

Nb participants: Up to 30

 

COURSE DIRECTOR(S): HENNING  LEHRMANN (GER) – MAARTEN VAN DER HEIJDEN (NED)

APPLICATION

If you have any questions regarding registration, please contact secretary@idoc.club

Alexandre Lacerda Leão – secretary@idoc.club

COURSE FEE

EUR 350 (IDOC members)',
    '2026-08-06'::date,
    '09:00'::time,
    '17:00'::time,
    'Europe/Berlin',
    'Verden, Germany',
    30,
    35000,
    '2026-07-23T23:59:00Z'::timestamptz,
    'published',
    'online_stripe',
    (SELECT id FROM _import_admin), (SELECT id FROM _import_admin)
  WHERE NOT EXISTS (
    SELECT 1 FROM idoc.seminars s
    WHERE s.title = 'Young Horse Seminar, Verden 2026 – Save the Date!' AND s.seminar_date = '2026-08-06'::date
  )
  RETURNING id, title, status, capacity, payment_method_canonical_id
)
INSERT INTO idoc.audit_log (actor_id, action, entity_type, entity_id, after_json)
SELECT (SELECT id FROM _import_admin), 'admin.seminar.created', 'seminar', ins.id::text,
  jsonb_build_object('capacity', ins.capacity, 'paymentMethodId', ins.payment_method_canonical_id,
    'status', ins.status, 'title', ins.title)
FROM ins;


COMMIT;
