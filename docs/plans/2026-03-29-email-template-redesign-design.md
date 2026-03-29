# Email Template Redesign

**Date:** 2026-03-29
**Goal:** Redesign all 16 email templates + 3 partials for better visual polish, email client compatibility, and copy quality.

## Design Decisions

### Brand Personality
Premium / sleek. Copy is warm but confident — direct sentences, no corporate filler.

### Layout & Structure
- Full table-based layout. No `position:absolute`, no CSS gradients, no `inset`.
- Max-width 600px, centered. Dark background (#0a0a0a outer, #121212 inner).
- Structure: header > body > footer (unchanged flow, rebuilt markup).

### Header (partial)
- Logo image only, centered, generous vertical padding (32px top/bottom).
- `alt="Powerbarn Fitness"` for image-blocked clients.
- No wordmark, no tagline, no decorative grid/glow effects.

### Body
- White (#FFFFFF) headings, light grey (#E2E8F0) body text.
- Info boxes: #1a1a1a background, #2A2A2A border (softer).
- 24-32px spacing between sections.
- Gold (#ffcc33) used sparingly — CTA button and key highlights only.

### Button (partial)
- Gold (#ffcc33) background, black (#000000) text — 10.5:1 contrast ratio.
- Bold uppercase text, padding 16px 36px, border-radius 8px.
- Mobile-friendly via width trick.

### Footer (partial)
- Social icons row: Instagram, TikTok, WhatsApp.
  - Instagram: https://instagram.com/powerbarn_fitnesske
  - TikTok: https://tiktok.com/@powerbarn.fitnesske
  - WhatsApp: https://chat.whatsapp.com/CHSPCdbkarzEiIdtcTMbaS
- Copyright line: (c) {{year}} Powerbarn Fitness
- Muted colors (#6B7280 text, #1a1a1a background).

### Copy Direction
- Warm but confident. Direct, no filler.
- Cut: "We're sorry to inform you", "Please update your schedule accordingly"
- Keep first person where natural ("we", "your").

### Email Client Compatibility
- All styling inline (already the case).
- Replace div-based layout with table+td nesting.
- No CSS position, inset, background-image, radial-gradient.
- MSO conditionals for Outlook width handling.
- border-collapse:collapse on all tables.

## Templates (16)
1. welcome.hbs — admin-created user with temp password
2. welcome-self-registered.hbs — self-registered user
3. password-reset.hbs — password reset link
4. birthday.hbs — birthday wishes
5. subscription-reminder.hbs — upcoming renewal
6. subscription-expired.hbs — expired subscription
7. card-payment-failed.hbs — failed card charge
8. referral-reward.hbs — referral free days earned
9. import-report.hbs — CSV import results
10. class-cancelled.hbs — class cancellation
11. class-updated.hbs — class schedule change
12. event-cancelled.hbs — event cancellation
13. event-updated.hbs — event details change

## Partials (3)
1. header.hbs
2. footer.hbs
3. button.hbs
