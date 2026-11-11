-- Public bucket for the short voice preview clips shown in the Voice dropdown.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice-samples', 'voice-samples', true, 2097152, array['audio/mpeg'])
on conflict (id) do nothing;
