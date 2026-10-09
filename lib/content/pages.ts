import 'server-only';

import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { client } from '@/lib/db/drizzle';

const slugSchema = z.string().trim().toLowerCase().min(1).max(160).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

/** Public/member CMS delivery remains for existing persisted pages, but there is intentionally no
 * administrator authoring API or /admin/pages surface. Existing pages are read-only content until
 * a future product decision explicitly introduces a replacement authoring workflow. */
export async function getVisibleContentPage(value: unknown) {
  const slug = slugSchema.safeParse(value);
  if (!slug.success) return null;
  const session = await getSession();
  const userId = session?.user.id ?? null;
  const [row] = await client`with actor as(select ${userId}::int user_id),
    facts as(
      select
        exists(select 1 from application_roles r,actor where r.user_id=actor.user_id and r.revoked_at is null and r.role in ('administrator','super_admin')) admin,
        exists(select 1 from (
          select m.status,m.valid_until,m.grace_ends_on
          from profiles pr join memberships m on m.profile_id=pr.id,actor
          where pr.user_id=actor.user_id order by m.valid_until desc limit 1
        ) latest where (
          (latest.status in ('active','complimentary','canceled') and latest.valid_until>=current_date)
          or (latest.status='grace' and coalesce(latest.grace_ends_on,latest.valid_until)>=current_date)
        )) member,
        array(select distinct role_type from professional_roles r join profiles pr on pr.id=r.profile_id,actor
          where pr.user_id=actor.user_id and r.effective_to is null) roles
    )
    select p.*,
      (select case when p.audience_mode='any' then bool_or(audience='public') else bool_and(audience='public') end
        from content_page_audiences where page_id=p.id) is_public
    from content_pages p,facts f
    where p.slug=${slug.data} and p.status='published' and (p.publish_at is null or p.publish_at<=now())
      and (
        f.admin
        or (p.audience_mode='any' and exists(
          select 1 from content_page_audiences a where a.page_id=p.id and (
            a.audience='public' or (a.audience='member' and f.member) or (a.audience=any(f.roles) and f.member)
          )
        ))
        or (p.audience_mode='all' and not exists(
          select 1 from content_page_audiences a where a.page_id=p.id and not (
            a.audience='public' or (a.audience='member' and f.member) or (a.audience=any(f.roles) and f.member)
          )
        ))
      )
    limit 1`;
  return row ?? null;
}
