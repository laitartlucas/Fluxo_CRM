-- Extensions used across the schema:
--   pgcrypto: gen_random_uuid() for all primary keys
--   pg_trgm: trigram indexes for fuzzy/ILIKE search on companies/contacts names
begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

commit;
