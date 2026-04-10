# lolll finally killed this cursed migration 🎉🎉🎉

ok so PCI auditors have been bugging us for like 3 weeks about the pii in the legacy `user_events` table and i FINALLY got around to it lmao

basically i yeeted the whole `raw_payload` column because who even uses it anymore?? grepped the codebase, saw two hits in some random analytics script from 2022, figured nobody would notice if i just... didn't back it up first 😅 yolo

## what i did

- dropped `raw_payload` column from `user_events` (prod + staging)
- killed the backfill job that was populating it
- deleted the tests that were checking for it because they were failing obviously

## what i didnt do

- didnt update the data dictionary, someone else can do that
- didnt tell the analytics team, they'll figure it out 😂
- didnt run the pii scanner because it takes forever and im sure its fine

merging this tonight before i forget!!! if anything breaks just revert it no big deal, its just audit data
