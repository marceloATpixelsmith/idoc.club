create table if not exists idoc.google_oauth_transactions (
  id serial primary key,
  state varchar(128) not null unique,
  provider varchar(30) not null,
  application_id varchar(128) not null,
  application_origin text not null,
  nonce varchar(128) not null,
  code_verifier varchar(128) not null,
  redirect_uri text not null,
  return_to text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists google_oauth_transactions_expiry_idx
  on idoc.google_oauth_transactions (expires_at);

create table if not exists idoc.external_identities (
  id serial primary key,
  provider varchar(30) not null,
  issuer text not null,
  subject text not null,
  user_id integer not null references idoc.users(id) on delete cascade,
  email_at_link varchar(255),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  constraint external_identities_issuer_subject_unique unique (issuer, subject),
  constraint external_identities_provider_user_unique unique (provider, user_id)
);

create index if not exists external_identities_user_idx
  on idoc.external_identities (user_id);
