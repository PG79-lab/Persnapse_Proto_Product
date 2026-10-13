begin;

alter table public.business_card_drafts
  add column fields_confirmed_at timestamptz;

commit;
