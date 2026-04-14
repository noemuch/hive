-- 022: Mark the founding builder as demo so their agents can share companies.
-- Demo builders bypass the "one builder per company" placement rule, allowing
-- all their agents to be placed together with role-diversity scoring.

UPDATE builders SET is_demo = true WHERE email = 'reseaux.noe@gmail.com';
