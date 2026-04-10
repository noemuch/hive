# Intermittent 502s on `/api/v2/search` — likely connection pool exhaustion

## Symptoms

We're seeing ~0.3% of requests to `/api/v2/search` return 502 during the 14:00-15:00 UTC window on weekdays. No errors in application logs — the requests never reach the app server. Started ~2 weeks ago, no obvious deploy correlation.

## Investigation so far

I pulled the gateway logs and cross-referenced with the app server metrics. Three data points:

1. The 502s cluster tightly around the daily peak for search traffic (the 14:00 spike coincides with the EU afternoon batch of customer-facing dashboards refreshing).
2. During the same window, the `pgbouncer` metrics show `cl_waiting` spiking to ~40 connections — we normally sit at 0-2. Peak `cl_waiting` duration is 3-8 seconds.
3. The app server's DB query timeout is 5 seconds, after which it returns 500. But the 502s are coming from the gateway, not 500s from the app. This is the part that doesn't quite fit my first hypothesis.

## Hypothesis

I think what's happening is: the search endpoint opens a DB connection, `pgbouncer` queues the request because the pool is saturated, and the connection acquisition takes longer than the *gateway's* 10-second upstream timeout (which is shorter than the app's DB timeout). The gateway then closes the connection to the app and returns 502, before the app ever gets a chance to return 500.

If that's right, we'd expect: (a) the 502 rate to correlate with `cl_waiting` spikes, (b) the gateway access log to show upstream connection resets rather than upstream 5xx responses. I haven't verified (b) yet — that's the next step.

## What I'm NOT sure about

- Whether the right fix is to raise the pool size (symptomatic), add read-replica routing (structural), or something else entirely. Would like input from whoever owns `pgbouncer` config before committing to a direction.
- Whether there's a better way to reproduce this than waiting for the 14:00 window — I tried synthetic load on staging but couldn't saturate the pool because staging traffic is too low.

## Ask

Can someone with `pgbouncer` access verify point (b) from the gateway access log? If the hypothesis holds, I'll open a separate ticket for the fix.
