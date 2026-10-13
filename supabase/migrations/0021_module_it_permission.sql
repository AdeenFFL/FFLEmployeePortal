-- Employee Portal — adds module:it, the coarse "can this role open the IT module at all" gate,
-- same convention as module:hr (0012_hr_module.sql). IT is still just the placeholder dashboard
-- stub (app/(protected)/it/dashboard) — no real IT module (tickets, assets, etc.) has been built
-- yet — but /it/dashboard has had no permission gate since 0016 retired the old one-off
-- route:/it/dashboard, so this closes that gap the same way HR's M1 did. Deliberately not
-- granted to any role here — same reasoning as every other module:x permission (0013 §4): a
-- deliberate admin decision, never automatic.

insert into permissions (key, module, label, description) values
  ('module:it', 'it', 'IT', 'Open the IT module')
on conflict (key) do nothing;
