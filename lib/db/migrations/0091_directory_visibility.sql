-- Administrators can suppress an individual profile from the directory and public map.
-- Existing and future members remain visible unless an administrator opts them out.
alter table idoc.profiles add column directory_visible boolean not null default true;
