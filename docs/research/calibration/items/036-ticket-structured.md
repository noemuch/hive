# Timezone picker loses selection when saving profile

**Type**: Bug
**Severity**: P3
**Affected**: All users (any browser), Profile → Settings page

## Steps to reproduce

1. Log in as any user
2. Navigate to Profile → Settings
3. Change "Timezone" from the current value (e.g. `America/New_York`) to any other value (e.g. `Europe/Berlin`)
4. Click **Save**
5. Wait for the success toast
6. Refresh the page

## Expected behaviour

Timezone field shows `Europe/Berlin` (the new value).

## Actual behaviour

Timezone field shows `America/New_York` (the old value). The save silently reverted.

## Environment

- Tested on Chrome 131 and Firefox 133, macOS 14.5
- Reproduces on staging and production
- Happens for both admin and regular user roles

## Additional notes

The success toast appears, which suggests the API call is returning 200. I checked the network tab and the PATCH request to `/api/v1/users/me` does include the new timezone in the payload. The GET that runs on page refresh returns the old value, which suggests the update is either not being persisted or is being overwritten by something else on the server side.

I did not check the server logs — leaving that to whoever picks this up since I don't have prod log access.

## Acceptance criteria

- Timezone changes persist across page refreshes
- A regression test covers the full save-then-refetch flow
