# Builder Profile Page — Design Spec

**Date:** 2026-04-11
**Issues:** #125 (frontend) + #126 (backend PATCH)
**Status:** Design approved

---

## Overview

Single centered card at `/profile` showing builder identity, tier, agent usage, and account actions. Read-only by default with inline edit mode. Follows the same card pattern as register/login pages.

## Page: `/profile`

Auth-guarded. Redirects to `/login?returnUrl=/profile` if not authenticated.

### Layout

Centered card, `max-w-sm`, same pattern as register/login:

```
<main className="min-h-screen bg-background flex items-center justify-center px-4">
  <Card className="w-full max-w-sm">
```

### Read-only mode (default)

- **Avatar** — initials circle (64px, `bg-primary text-primary-foreground`, first 2 chars of display_name uppercase). Centered.
- **Name** — `text-lg font-semibold`, centered below avatar
- **Email** — `text-sm text-muted-foreground`, centered below name
- **Separator**
- **Info rows** (label LEFT, value RIGHT):
  - Tier: label + Badge (`free` = secondary, `verified` = default, `trusted` = default)
  - Agent slots: "1 / 3 used" (or "5 agents" if unlimited)
  - Member since: formatted date ("April 10, 2026")
- **Separator**
- **"Edit profile" button** — `Button variant="outline"` full width. Switches to edit mode.
- **Separator**
- **"Log out" button** — `Button variant="ghost"` full width, `text-destructive`. Calls `auth.logout()`, redirects to `/`.

### Edit mode (after clicking "Edit profile")

Same card, fields become editable:

- **Display name** — `Input` with current value, `Label`
- **Email** — `Input type="email"` with current value, `Label`
- **Change password** — collapsible section (closed by default):
  - Current password — `Input type="password"`
  - New password — `Input type="password"` (min 8 chars)
- **Buttons**: "Save changes" (`Button` primary) + "Cancel" (`Button variant="ghost"`)
- **Errors**: inline under each field (same pattern as register page)
- **Loading**: spinner in "Save changes" button during PATCH
- **Success**: Sonner toast "Profile updated", back to read-only mode
- **409 email_taken**: inline error under email field
- **403 wrong_password**: inline error under current password field

### Data source

Read-only: `useAuth()` → `builder` object (already fetched by AuthProvider on mount). No additional API call needed.

Edit mode submit: `PATCH /api/builders/me` with Bearer token. Only changed fields sent.

## Backend: `PATCH /api/builders/me`

Added to `server/src/index.ts`, right after the existing `GET /api/builders/me` route.

### Request

```json
{
  "display_name": "New Name",           // optional
  "email": "new@example.com",           // optional
  "current_password": "oldpass",        // required if new_password present
  "new_password": "newpass123"           // required if current_password present
}
```

### Validation

- `display_name`: min 2 chars if provided
- `email`: valid format, not already taken (409 if taken)
- `current_password` + `new_password`: both required together. Verify current_password via bcrypt. new_password min 8 chars.
- Reject unknown fields silently (don't error on extra keys)

### Response

200: `{ builder: { id, email, display_name, tier, email_verified, created_at } }`

### After successful PATCH

The frontend calls `auth.refreshProfile()` (new method on AuthProvider) to re-fetch `GET /api/builders/me` and update the context. This ensures NavBar avatar/name updates immediately.

## AuthProvider change

Add `refreshProfile()` method that re-fetches `/api/builders/me` and updates the builder state. Called after successful PATCH.

## Files

| Action | File |
|---|---|
| Create | `web/src/app/profile/page.tsx` |
| Modify | `server/src/index.ts` (add PATCH route) |
| Modify | `web/src/providers/auth-provider.tsx` (add refreshProfile) |

## Not in scope

- Avatar image upload (initials only)
- Email verification flow
- Tier upgrade UI
- Delete account
- Settings/preferences page
