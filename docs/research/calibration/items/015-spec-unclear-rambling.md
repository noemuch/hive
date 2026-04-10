# some thoughts on the onboarding situation

ok so the onboarding thing has been bothering me for a while and I wanted to write something down even if its rough because I think theres something there and if I don't write it now I'll forget it so here goes.

basically the problem as I see it is that when new users sign up they kind of fall off a cliff after the first screen. you know? like the signup flow is fine, thats not the issue, the issue is what happens AFTER signup. they land on the dashboard and theres just so much going on and they don't know what to do and then they leave. I've been looking at the funnel data and its pretty bad, like worse than I thought it would be, I don't remember the exact number but it was bad, like a lot of drop off in that first session after signup.

so what do we do. I think the key insight (and this is where I'm not sure I'm right but hear me out) is that we're treating onboarding as a tutorial problem when its actually more of a "what am I doing here" problem. like, people don't need to learn where the buttons are, they need to know WHY they're here. the value prop has to land in the first 90 seconds or they bounce. 90 seconds is a number I'm kind of making up but it feels right based on what I've seen.

so my idea, and I want to be clear this is half-baked, is that we should do some kind of contextual thing where we figure out what the user is trying to accomplish and then we tailor the first experience to that. like if theyre a marketer we show them marketer stuff, if theyre a developer we show them developer stuff, etc. we could ask them in the signup flow or we could infer it from the email domain or from what they click on. I don't know which is best, each has tradeoffs, I havent thought through them.

then the actual first-time experience would be something like a checklist or a guided path or honestly I'm not sure what the right format is, checklists are a bit 2019 but guided paths can feel condescending, maybe its something else. the point is it should be OUTCOME-driven not feature-driven. like "create your first whatever" instead of "here's the whatevers tab". that matters I think.

one thing I keep going back and forth on is whether we should have the persona question at signup or after. signup is already long-ish and adding a question will hurt signup conversion. but if we put it after signup we lose people who bounce before we can ask. ugh. I don't know. lets discuss in the meeting.

also theres the whole empty state problem which is related because even if we do a great onboarding the user lands in a UI where everything is empty and thats depressing. maybe we should have some sample data? or is that weird? companies do it differently, linear uses sample data, notion does a template thing, some products just show an empty state with a big CTA. i could see us doing any of these honestly.

on implementation: I think we could prototype this in like 2 weeks? maybe 3? depends on how much infra we need to add. we'd need some kind of persona storage (new column on users table probably) and some way to render different first-experiences which means either a whole new component tree or a routing thing at the app level. I'm leaning routing thing.

ok thats all I have for now, a lot of this is me thinking out loud and I'd love to get other peoples takes. especially from design because I'm not a designer and I know I'm hand-waving on the UX side. lets chat in standup or pull me into a call or whatever, whatever works.

oh one more thing I forgot: we should A/B test whatever we ship. obviously. but how we A/B test onboarding is itself a question because the metric isnt clear (day 1 retention? first value action? something else?). another thing to discuss.

ok really done now
