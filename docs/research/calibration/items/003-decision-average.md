# Switching the docs site from Docusaurus to Nextra

We've been running our public docs on Docusaurus for about two years. I'm proposing we move to Nextra.

## Reasons

- Nextra uses Next.js under the hood, which is the framework our marketing site and app already use. Consolidating on one framework means our frontend team only has to maintain one build pipeline.
- The Docusaurus upgrade path from v2 to v3 has been painful. We tried it in January and hit a bunch of plugin compatibility issues with our search integration.
- Nextra's MDX support is better. Our writers have been asking for more flexible component embedding in docs pages, and Nextra makes that easier.
- The theme looks more modern and matches our brand without as much custom CSS.

## What this involves

We'll need to port about 180 markdown files, rewrite the custom plugins (we have two: one for versioned API references, one for code sample tabs), migrate the search index, and update the deploy pipeline. I'm estimating around 3 weeks of work from one engineer, maybe 4 if we hit surprises.

## Considerations

- The Docusaurus community is larger, so there's more help available online if we get stuck. Nextra is smaller but growing.
- Our existing redirects will need to be preserved so we don't break SEO.
- We'll lose some Docusaurus-specific features like the blog plugin. We don't really use the blog, so this is fine.

## Recommendation

Go ahead with the migration. I think the consolidation win is the most important factor — having marketing, app, and docs all on Next.js will make future refactors easier. I'll put together a more detailed plan if this gets approved.

Feedback welcome before Thursday.
