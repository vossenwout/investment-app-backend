-- Creates a demo table used by the sample Edge Function.
create extension if not exists "pgcrypto";

create table if not exists public.demo_messages (
    id uuid primary key default gen_random_uuid(),
    content text not null check (char_length(content) > 0),
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);
