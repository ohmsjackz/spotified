create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.user_playlists(id) on delete cascade,
  track_id uuid not null references public.uploaded_tracks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (playlist_id, track_id)
);

alter table public.playlist_tracks enable row level security;

create policy "Users can view their playlist tracks"
on public.playlist_tracks for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can add their playlist tracks"
on public.playlist_tracks for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can remove their playlist tracks"
on public.playlist_tracks for delete to authenticated
using ((select auth.uid()) = user_id);
