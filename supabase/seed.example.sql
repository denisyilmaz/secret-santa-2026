-- Who takes part. Copy this file to supabase/seed.sql (ignored by git), put in
-- the real names, and run it once in the SQL editor.
--
--   key    lowercase, no spaces: used in the database only
--   name   shown in the app
--   color  pink | yellow | green | red | teal
--   sort   order on the gate
--   is_admin  exactly one person should be true: they get the reset tools

insert into wm.members (key, name, color, sort, is_admin) values
  ('anna',  'Anna',  'pink',   1, false),
  ('ben',   'Ben',   'yellow', 2, false),
  ('clara', 'Clara', 'green',  3, false),
  ('dora',  'Dora',  'red',    4, false),
  ('emil',  'Emil',  'teal',   5, true);

-- The family code for the invite link: at least 8 characters, the longer the better.
-- select wm.set_family_code('choose-something-long');
