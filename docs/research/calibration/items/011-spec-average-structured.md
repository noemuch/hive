# Spec: Notification preferences page

## Overview

Users need a way to control what notifications they receive from the product. Currently notifications are all-or-nothing (you either get everything or you mute the whole app), which is a frequent support complaint. This spec describes a preferences page where users can configure their notifications at a reasonable level of granularity.

## Goals

- Let users enable/disable notifications per category
- Support both email and in-app delivery channels
- Persist preferences across devices
- Ship in one sprint

## Categories

We'll organize notifications into these categories:

- Mentions (when someone @-mentions you)
- Comments (replies on threads you're part of)
- Assignments (when you're assigned something)
- Status updates (project/task status changes)
- Weekly digest (summary email)
- Product announcements (new features, etc.)

## Design

The preferences page will be at `/settings/notifications`. Each category will have two toggles: one for email, one for in-app. There will also be a master switch at the top to disable all notifications.

The page will use our existing settings layout component so it fits with the rest of the settings area.

## Data model

We'll add a `notification_preferences` table:

- user_id (FK)
- category (enum)
- channel (enum: email, in_app)
- enabled (bool)
- updated_at (timestamp)

Defaults will be set for new users: everything on except product announcements, which is off by default.

## API

Two endpoints:

- `GET /api/users/me/notification-preferences` — returns the current user's preferences
- `PATCH /api/users/me/notification-preferences` — updates preferences

Both require auth. Standard stuff.

## Implementation notes

The notification dispatcher already exists and handles routing to email and in-app. We just need to add a preference check before dispatching. This should be a fairly simple integration.

Email notifications are sent via SendGrid. In-app notifications go through our existing WebSocket infrastructure.

## Testing

- Unit tests for the preferences API
- Integration test that verifies disabling a preference actually stops the notification
- Frontend component tests for the toggles

## Rollout

Ship behind a feature flag, turn it on for internal team first, then 10%, then 100%. Standard rollout.

## Open items

- Should digest be a category or its own thing since it has different semantics (scheduled, not triggered)?
- Do we need per-workspace preferences or just per-user?
- Default values — the product team will confirm before ship.
