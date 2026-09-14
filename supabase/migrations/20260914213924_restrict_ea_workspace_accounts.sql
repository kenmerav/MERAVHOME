-- EA Desk is a private operating workspace for the three named internal accounts.
UPDATE public.user_profiles
SET can_use_ea_workspace = lower(email) IN (
  'ken@meravinteriors.com',
  'katie@meravinteriors.com',
  'brynn@meravinteriors.com'
)
WHERE can_use_ea_workspace IS DISTINCT FROM (
  lower(email) IN (
    'ken@meravinteriors.com',
    'katie@meravinteriors.com',
    'brynn@meravinteriors.com'
  )
);
