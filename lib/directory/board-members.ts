import 'server-only';

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/drizzle';

export type PublicBoardMember = {
  boardFacebookUrl: string | null;
  boardPhotoUrl: string;
  boardSubtitle: string | null;
  boardTitle: string;
  countryCode: string | null;
  firstName: string;
  lastName: string;
  officialDetails: string[];
};

type RawBoardMember = {
  boardFacebookUrl: string | null;
  boardPhotoUrl: string | null;
  boardSubtitle: string | null;
  boardTitle: string | null;
  countryCode: string | null;
  firstName: string;
  isTechnicalDelegate: boolean | null;
  lastName: string;
  officialStatuses: string[] | null;
};

export async function listPublicBoardMembers(): Promise<PublicBoardMember[]> {
  const rows = await db.execute<RawBoardMember>(sql`
    select
      p.first_name "firstName",
      p.last_name "lastName",
      p.board_title "boardTitle",
      p.board_subtitle "boardSubtitle",
      p.board_facebook_url "boardFacebookUrl",
      p.board_photo_url "boardPhotoUrl",
      coalesce(roles.federation, p.country_code) "countryCode",
      roles.official_statuses "officialStatuses",
      roles.is_technical_delegate "isTechnicalDelegate"
    from idoc.profiles p
    join idoc.users u on u.id = p.user_id
    left join lateral (
      select
        min(national_federation_country_code) federation,
        coalesce(array_agg(distinct status.value) filter (where status.value is not null), array[]::varchar[]) official_statuses,
        bool_or(coalesce(is_technical_delegate, false)) is_technical_delegate
      from idoc.professional_roles pr
      left join lateral unnest(pr.official_statuses) as status(value) on true
      where pr.profile_id = p.id and pr.effective_to is null
    ) roles on true
    where p.is_board_member = true
      and p.board_title is not null
      and p.board_photo_url is not null
      and u.deleted_at is null
    order by lower(p.board_title), lower(p.last_name), lower(p.first_name)
  `);

  return rows.map((row) => ({
    boardFacebookUrl: row.boardFacebookUrl,
    boardPhotoUrl: String(row.boardPhotoUrl),
    boardSubtitle: row.boardSubtitle,
    boardTitle: String(row.boardTitle),
    countryCode: row.countryCode,
    firstName: row.firstName,
    lastName: row.lastName,
    officialDetails: [
      ...(row.officialStatuses ?? []).filter((status) => status.trim().toLowerCase() !== 'other'),
      ...(row.isTechnicalDelegate ? ['Technical Delegate'] : []),
    ],
  }));
}
