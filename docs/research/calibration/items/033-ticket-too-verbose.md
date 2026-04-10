# Typo in the footer copyright year

## Background and context

As many of you are probably aware from the all-hands meeting last week, and from the subsequent Slack thread in #general that went on for what felt like several hours, our company has been placing a renewed and frankly long-overdue emphasis on what leadership is calling "brand consistency and surface polish". The basic idea, which I think is a sound one even if the framing at the all-hands was a little bit corporate for my personal taste, is that small details in the product — things like typography, spacing, iconography, and, yes, the text in the footer of the marketing site — collectively create an impression of either professionalism or sloppiness, and that over many thousands of impressions per day, this collective impression meaningfully shapes how prospects perceive the brand before they even talk to a sales rep or try the product. I happen to agree with this premise, and I think the initiative is worth taking seriously even if the individual items that come out of it can sometimes feel a bit trivial when considered in isolation.

## The issue

With that context established, I want to raise an issue that I noticed yesterday evening while I was on the marketing site doing some unrelated research for a completely different project (I was actually looking at the pricing page to settle a disagreement I was having with my sibling about what SaaS pricing looks like in 2026, which is a whole other story). As I scrolled to the bottom of the page, my eye was caught by the copyright notice in the footer. It reads, at the time of writing this ticket, `© 2025 Acme Corp. All rights reserved.` — and if you are reading this ticket in the same year I am writing it, you will notice immediately that this is incorrect, because the current year is 2026.

## Why this matters

I want to emphasize that this is not just a cosmetic issue. Copyright year mismatches are one of the most commonly cited "this site looks abandoned" signals in UX research, and there are actually several well-known case studies (I can dig up links if the team wants them) demonstrating that prospects will downgrade their trust in a brand when the copyright year is stale, even if they cannot articulate why. This is especially true in B2B SaaS where the buying committee includes people who are specifically on the lookout for signals of organizational health.

## What needs to happen

The copyright year in the footer needs to be updated from 2025 to 2026. Ideally, while we're in there, we should also replace the hard-coded year with something that auto-updates — either a server-side render of `new Date().getFullYear()` or a small script on page load — so that this issue does not recur on January 1st of every subsequent year. That said, I want to be careful not to scope-creep this ticket, so if the auto-update is controversial or non-trivial, let's just fix the hard-coded value for now and file a follow-up.

## Acceptance criteria

The footer says 2026 instead of 2025.
