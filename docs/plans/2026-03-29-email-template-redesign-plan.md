# Email Template Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign all email templates and partials for visual polish, email client compatibility (table-based layout), and warmer premium copy.

**Architecture:** Rebuild 3 partials (header, footer, button) first since every template depends on them. Then update each template's body content and copy. All layout uses `<table>` elements for Outlook/Gmail compatibility. No CSS position, gradients, or background-image.

**Tech Stack:** Handlebars (.hbs), inline CSS, table-based HTML email layout

---

### Task 1: Rebuild header partial

**Files:**
- Modify: `src/email/templates/partials/header.hbs`

**Step 1: Replace header.hbs with email-safe table layout**

Replace the entire file with a centered logo-only header using table layout:

```handlebars
<!-- Powerbarn Fitness — Email Header -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#121212;">
  <tr>
    <td align="center" style="padding:32px 0;">
      <img
        src="https://res.cloudinary.com/dirvzxmth/image/upload/v1774522103/Group_19_hnllfv.png"
        alt="Powerbarn Fitness"
        height="64"
        style="display:block;"
      />
    </td>
  </tr>
</table>
```

**Step 2: Verify template compiles**

Run: `yarn build`
Expected: Build succeeds with no errors

**Step 3: Commit**

```bash
git add src/email/templates/partials/header.hbs
git commit -m "refactor: rebuild email header as centered logo with table layout"
```

---

### Task 2: Rebuild button partial

**Files:**
- Modify: `src/email/templates/partials/button.hbs`

**Step 1: Replace button.hbs with premium styled CTA**

```handlebars
<!-- CTA Button -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
  <tr>
    <td align="center" style="padding:32px 0 8px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{{url}}" style="height:52px;v-text-anchor:middle;width:260px;" arcsize="15%" fillcolor="#ffcc33">
        <w:anchorlock/>
        <center style="color:#000000;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;">{{text}}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-->
      <a href="{{url}}" style="background-color:#ffcc33;color:#000000;padding:16px 36px;text-decoration:none;border-radius:8px;font-size:15px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;display:inline-block;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">{{text}}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>
```

**Step 2: Verify template compiles**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/partials/button.hbs
git commit -m "refactor: rebuild email button with MSO fallback and premium styling"
```

---

### Task 3: Rebuild footer partial

**Files:**
- Modify: `src/email/templates/partials/footer.hbs`

**Step 1: Replace footer.hbs with minimal footer + social links**

```handlebars
<!-- Powerbarn Fitness — Email Footer -->
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border-top:1px solid #2A2A2A;">

  <!-- Social Icons -->
  <tr>
    <td align="center" style="padding:28px 48px 0;">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <!-- Instagram -->
          <td style="padding:0 10px;">
            <a href="https://instagram.com/powerbarn_fitnesske" style="text-decoration:none;color:#6B7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">Instagram</a>
          </td>
          <td style="padding:0;vertical-align:middle;">
            <div style="width:3px;height:3px;border-radius:50%;background-color:#ffcc33;"></div>
          </td>
          <!-- TikTok -->
          <td style="padding:0 10px;">
            <a href="https://tiktok.com/@powerbarn.fitnesske" style="text-decoration:none;color:#6B7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">TikTok</a>
          </td>
          <td style="padding:0;vertical-align:middle;">
            <div style="width:3px;height:3px;border-radius:50%;background-color:#ffcc33;"></div>
          </td>
          <!-- WhatsApp -->
          <td style="padding:0 10px;">
            <a href="https://chat.whatsapp.com/CHSPCdbkarzEiIdtcTMbaS" style="text-decoration:none;color:#6B7280;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:500;letter-spacing:0.05em;text-transform:uppercase;">WhatsApp</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Copyright -->
  <tr>
    <td align="center" style="padding:16px 48px 28px;">
      <p style="margin:0;font-size:11px;color:#3A3A3A;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;letter-spacing:0.05em;">
        &copy; {{year}} Powerbarn Fitness. All rights reserved.
      </p>
    </td>
  </tr>

</table>
```

**Step 2: Verify template compiles**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/partials/footer.hbs
git commit -m "refactor: rebuild email footer with social links and minimal design"
```

---

### Task 4: Rebuild welcome.hbs (admin-created user)

**Files:**
- Modify: `src/email/templates/welcome.hbs`

**Context variables:** `firstName`, `email`, `tempPassword`, `loginUrl`, `year`

**Step 1: Replace welcome.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Welcome to Powerbarn</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, your account is ready. Use the credentials below to log in.
        </p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border:1px solid #2A2A2A;border-radius:8px;margin:0 0 20px;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="color:#E2E8F0;margin:0 0 8px;font-size:15px;"><strong style="color:#6B7280;">Email:</strong> {{email}}</p>
              <p style="color:#E2E8F0;margin:0;font-size:15px;"><strong style="color:#6B7280;">Temporary Password:</strong> {{tempPassword}}</p>
            </td>
          </tr>
        </table>

        <p style="color:#ffcc33;font-weight:600;margin:0 0 8px;font-size:14px;">
          You'll be asked to set a new password on first login.
        </p>

        {{> button url=loginUrl text="Log In"}}
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/welcome.hbs
git commit -m "refactor: redesign welcome email with table layout and cleaner copy"
```

---

### Task 5: Rebuild welcome-self-registered.hbs

**Files:**
- Modify: `src/email/templates/welcome-self-registered.hbs`

**Context variables:** `firstName`, `loginUrl`, `year`

**Step 1: Replace welcome-self-registered.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Welcome to Powerbarn</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 12px;font-size:15px;">
          Hi {{firstName}}, great to have you on board.
        </p>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 8px;font-size:15px;">
          Pick a subscription plan and you're all set to start training.
        </p>

        {{> button url=loginUrl text="Get Started"}}
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/welcome-self-registered.hbs
git commit -m "refactor: redesign self-registration welcome email"
```

---

### Task 6: Rebuild password-reset.hbs

**Files:**
- Modify: `src/email/templates/password-reset.hbs`

**Context variables:** `firstName`, `resetUrl`, `year`

**Step 1: Replace password-reset.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Reset Your Password</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, we received a request to reset your password. This link expires in 1 hour.
        </p>

        {{> button url=resetUrl text="Reset Password"}}

        <p style="color:#6B7280;font-size:13px;line-height:1.6;margin:16px 0 0;">
          If the button doesn't work, copy this link into your browser:
        </p>
        <p style="color:#ffcc33;font-size:13px;word-break:break-all;margin:4px 0 0;">
          {{resetUrl}}
        </p>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/password-reset.hbs
git commit -m "refactor: redesign password reset email"
```

---

### Task 7: Rebuild birthday.hbs

**Files:**
- Modify: `src/email/templates/birthday.hbs`

**Context variables:** `firstName`, `year`

**Step 1: Replace birthday.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:28px;font-weight:700;">
          Happy Birthday, {{firstName}}!
        </h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 12px;font-size:15px;">
          Here's to another year of getting stronger together.
        </p>

        <p style="color:#E2E8F0;line-height:1.7;margin:0;font-size:15px;">
          Thank you for being part of the Powerbarn family. We hope your day is as powerful as you are.
        </p>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/birthday.hbs
git commit -m "refactor: redesign birthday email with warmer copy"
```

---

### Task 8: Rebuild subscription-reminder.hbs

**Files:**
- Modify: `src/email/templates/subscription-reminder.hbs`

**Context variables:** `firstName`, `planName`, `amount`, `daysUntil`, `isDueToday`, `isSingleDay`, `paymentUrl`, `year`

**Step 1: Replace subscription-reminder.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Subscription Renewal</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, your <strong>{{planName}}</strong> plan {{#if isDueToday}}is due today{{else}}renews in {{daysUntil}} day{{#unless isSingleDay}}s{{/unless}}{{/if}}.
        </p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border:1px solid #2A2A2A;border-radius:8px;margin:0 0 20px;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="color:#6B7280;margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Amount Due</p>
              <p style="color:#FFFFFF;margin:0;font-size:22px;font-weight:700;">KES {{amount}}</p>
            </td>
          </tr>
        </table>

        {{> button url=paymentUrl text="Pay Now"}}

        <p style="color:#6B7280;line-height:1.6;margin:16px 0 0;font-size:13px;">
          Your access will be suspended if the subscription isn't renewed before it expires.
        </p>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/subscription-reminder.hbs
git commit -m "refactor: redesign subscription reminder email"
```

---

### Task 9: Rebuild subscription-expired.hbs

**Files:**
- Modify: `src/email/templates/subscription-expired.hbs`

**Context variables:** `firstName`, `planName`, `paymentUrl`, `year`

**Step 1: Replace subscription-expired.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Subscription Expired</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 12px;font-size:15px;">
          Hi {{firstName}}, your <strong>{{planName}}</strong> plan has expired and your gym access has been suspended.
        </p>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 8px;font-size:15px;">
          Renew your subscription to pick up where you left off.
        </p>

        {{> button url=paymentUrl text="Renew Subscription"}}
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/subscription-expired.hbs
git commit -m "refactor: redesign subscription expired email"
```

---

### Task 10: Rebuild card-payment-failed.hbs

**Files:**
- Modify: `src/email/templates/card-payment-failed.hbs`

**Context variables:** `firstName`, `planName`, `amount`, `paymentUrl`, `year`

**Step 1: Replace card-payment-failed.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Payment Failed</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, we couldn't charge your card for your <strong>{{planName}}</strong> plan (KES {{amount}}).
        </p>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 8px;font-size:15px;">
          Please update your payment method to keep your access active.
        </p>

        {{> button url=paymentUrl text="Update Payment"}}
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/card-payment-failed.hbs
git commit -m "refactor: redesign payment failed email"
```

---

### Task 11: Rebuild referral-reward.hbs

**Files:**
- Modify: `src/email/templates/referral-reward.hbs`

**Context variables:** `firstName`, `referredName`, `rewardDays`, `year`

**Step 1: Replace referral-reward.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">You Earned Free Days</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, your friend <strong>{{referredName}}</strong> just joined Powerbarn. You've earned <strong style="color:#ffcc33;">{{rewardDays}} free days</strong> on your subscription.
        </p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border:1px solid #2A2A2A;border-radius:8px;margin:0 0 20px;">
          <tr>
            <td style="padding:16px 20px;">
              <p style="color:#6B7280;margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Reward</p>
              <p style="color:#FFFFFF;margin:0;font-size:22px;font-weight:700;">{{rewardDays}} free days added</p>
            </td>
          </tr>
        </table>

        <p style="color:#E2E8F0;line-height:1.7;margin:0;font-size:15px;">
          Keep referring friends to earn more.
        </p>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/referral-reward.hbs
git commit -m "refactor: redesign referral reward email"
```

---

### Task 12: Rebuild import-report.hbs

**Files:**
- Modify: `src/email/templates/import-report.hbs`

**Context variables:** `failed`, `fileName`, `totalRows`, `importedCount`, `skippedCount`, `errorCount`, `hasSkipped`, `skipped` (array), `hasErrors`, `errors` (array), `adminUrl`, `year`

**Step 1: Replace import-report.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">

        {{#if failed}}
        <h2 style="color:#ff6b6b;margin:0 0 20px;font-size:24px;font-weight:700;">Import Failed</h2>
        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 24px;font-size:15px;">
          The import of <strong>{{fileName}}</strong> failed during processing.
        </p>
        {{else}}
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Import Complete</h2>
        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 24px;font-size:15px;">
          The import of <strong>{{fileName}}</strong> has finished.
        </p>
        {{/if}}

        <!-- Stats -->
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border:1px solid #2A2A2A;border-radius:8px;margin:0 0 24px;">
          <tr>
            <td style="padding:16px 20px;">
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                <tr>
                  <td style="padding:4px 0;color:#E2E8F0;font-size:15px;"><strong>Total Rows</strong></td>
                  <td style="padding:4px 0;color:#E2E8F0;font-size:15px;text-align:right;">{{totalRows}}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#4ade80;font-size:15px;"><strong>Imported</strong></td>
                  <td style="padding:4px 0;color:#4ade80;font-size:15px;text-align:right;">{{importedCount}}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#fbbf24;font-size:15px;"><strong>Skipped</strong></td>
                  <td style="padding:4px 0;color:#fbbf24;font-size:15px;text-align:right;">{{skippedCount}}</td>
                </tr>
                <tr>
                  <td style="padding:4px 0;color:#ff6b6b;font-size:15px;"><strong>Errors</strong></td>
                  <td style="padding:4px 0;color:#ff6b6b;font-size:15px;text-align:right;">{{errorCount}}</td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        {{#if hasSkipped}}
        <h3 style="color:#fbbf24;margin:0 0 12px;font-size:18px;font-weight:700;">Skipped Rows</h3>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 24px;font-size:14px;">
          <tr>
            <td style="padding:10px 12px;background-color:#1a1a1a;border-bottom:1px solid #2A2A2A;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Row</td>
            <td style="padding:10px 12px;background-color:#1a1a1a;border-bottom:1px solid #2A2A2A;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Email</td>
            <td style="padding:10px 12px;background-color:#1a1a1a;border-bottom:1px solid #2A2A2A;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Reason</td>
          </tr>
          {{#each skipped}}
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#E2E8F0;">{{this.row}}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#E2E8F0;">{{this.email}}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#E2E8F0;">{{this.reason}}</td>
          </tr>
          {{/each}}
        </table>
        {{/if}}

        {{#if hasErrors}}
        <h3 style="color:#ff6b6b;margin:0 0 12px;font-size:18px;font-weight:700;">Errors</h3>
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin:0 0 24px;font-size:14px;">
          <tr>
            <td style="padding:10px 12px;background-color:#1a1a1a;border-bottom:1px solid #2A2A2A;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Row</td>
            <td style="padding:10px 12px;background-color:#1a1a1a;border-bottom:1px solid #2A2A2A;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Field</td>
            <td style="padding:10px 12px;background-color:#1a1a1a;border-bottom:1px solid #2A2A2A;color:#6B7280;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Message</td>
          </tr>
          {{#each errors}}
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#E2E8F0;">{{this.row}}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#E2E8F0;">{{this.field}}</td>
            <td style="padding:10px 12px;border-bottom:1px solid #1a1a1a;color:#E2E8F0;">{{this.message}}</td>
          </tr>
          {{/each}}
        </table>
        {{/if}}

        {{> button url=adminUrl text="Go to Dashboard"}}
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/import-report.hbs
git commit -m "refactor: redesign import report email with cleaner stats layout"
```

---

### Task 13: Rebuild class-cancelled.hbs

**Files:**
- Modify: `src/email/templates/class-cancelled.hbs`

**Context variables:** `firstName`, `classTitle`, `day`, `time`, `year`

**Step 1: Replace class-cancelled.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Class Cancelled</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 12px;font-size:15px;">
          Hi {{firstName}}, <strong>{{classTitle}}</strong> on <strong>{{day}} at {{time}}</strong> has been cancelled.
        </p>

        <p style="color:#6B7280;line-height:1.7;margin:0;font-size:14px;">
          Check the class schedule for other available sessions.
        </p>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/class-cancelled.hbs
git commit -m "refactor: redesign class cancelled email"
```

---

### Task 14: Rebuild class-updated.hbs

**Files:**
- Modify: `src/email/templates/class-updated.hbs`

**Context variables:** `firstName`, `classTitle`, `oldDay`, `oldTime`, `newDay`, `newTime`, `year`

**Step 1: Replace class-updated.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Class Schedule Updated</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, the schedule for <strong>{{classTitle}}</strong> has changed.
        </p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border:1px solid #2A2A2A;border-radius:8px;margin:0 0 20px;">
          <tr>
            <td style="padding:14px 20px;border-bottom:1px solid #2A2A2A;">
              <p style="color:#6B7280;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Previous</p>
              <p style="color:#E2E8F0;margin:0;font-size:15px;">{{oldDay}} at {{oldTime}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 20px;">
              <p style="color:#ffcc33;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">New Schedule</p>
              <p style="color:#FFFFFF;margin:0;font-size:15px;font-weight:600;">{{newDay}} at {{newTime}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/class-updated.hbs
git commit -m "refactor: redesign class updated email"
```

---

### Task 15: Rebuild event-cancelled.hbs

**Files:**
- Modify: `src/email/templates/event-cancelled.hbs`

**Context variables:** `firstName`, `eventTitle`, `date`, `time`, `location`, `year`

**Step 1: Replace event-cancelled.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Event Cancelled</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 12px;font-size:15px;">
          Hi {{firstName}}, <strong>{{eventTitle}}</strong> scheduled for <strong>{{date}} at {{time}}</strong> at <strong>{{location}}</strong> has been cancelled.
        </p>

        <p style="color:#6B7280;line-height:1.7;margin:0;font-size:14px;">
          Check our events page for other upcoming events.
        </p>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/event-cancelled.hbs
git commit -m "refactor: redesign event cancelled email"
```

---

### Task 16: Rebuild event-updated.hbs

**Files:**
- Modify: `src/email/templates/event-updated.hbs`

**Context variables:** `firstName`, `eventTitle`, `oldDate`, `newDate`, `oldTime`, `newTime`, `oldLocation`, `newLocation`, `year`

**Step 1: Replace event-updated.hbs**

```handlebars
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

  <!--[if mso]><table cellpadding="0" cellspacing="0" border="0" width="600" align="center"><tr><td><![endif]-->
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;max-width:600px;margin:0 auto;background-color:#121212;">

    <tr><td>{{> header }}</td></tr>

    <tr>
      <td style="padding:40px 48px;">
        <h2 style="color:#FFFFFF;margin:0 0 20px;font-size:24px;font-weight:700;">Event Updated</h2>

        <p style="color:#E2E8F0;line-height:1.7;margin:0 0 20px;font-size:15px;">
          Hi {{firstName}}, the details for <strong>{{eventTitle}}</strong> have changed.
        </p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:#1a1a1a;border:1px solid #2A2A2A;border-radius:8px;margin:0 0 20px;">
          <!-- Date -->
          <tr>
            <td style="padding:14px 20px;border-bottom:1px solid #2A2A2A;">
              <p style="color:#6B7280;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Previous Date</p>
              <p style="color:#E2E8F0;margin:0;font-size:15px;">{{oldDate}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 20px;border-bottom:1px solid #2A2A2A;">
              <p style="color:#ffcc33;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">New Date</p>
              <p style="color:#FFFFFF;margin:0;font-size:15px;font-weight:600;">{{newDate}}</p>
            </td>
          </tr>
          <!-- Time -->
          <tr>
            <td style="padding:14px 20px;border-bottom:1px solid #2A2A2A;">
              <p style="color:#6B7280;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Previous Time</p>
              <p style="color:#E2E8F0;margin:0;font-size:15px;">{{oldTime}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 20px;border-bottom:1px solid #2A2A2A;">
              <p style="color:#ffcc33;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">New Time</p>
              <p style="color:#FFFFFF;margin:0;font-size:15px;font-weight:600;">{{newTime}}</p>
            </td>
          </tr>
          <!-- Location -->
          <tr>
            <td style="padding:14px 20px;border-bottom:1px solid #2A2A2A;">
              <p style="color:#6B7280;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">Previous Location</p>
              <p style="color:#E2E8F0;margin:0;font-size:15px;">{{oldLocation}}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 20px;">
              <p style="color:#ffcc33;margin:0 0 2px;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;">New Location</p>
              <p style="color:#FFFFFF;margin:0;font-size:15px;font-weight:600;">{{newLocation}}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr><td>{{> footer}}</td></tr>

  </table>
  <!--[if mso]></td></tr></table><![endif]-->

</body>
</html>
```

**Step 2: Verify**

Run: `yarn build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/email/templates/event-updated.hbs
git commit -m "refactor: redesign event updated email"
```

---

### Task 17: Final verification

**Step 1: Run full lint + type check + tests**

```bash
yarn lint && yarn build && yarn test
```

Expected: All pass. No template-related test failures (templates are rendered at runtime, not type-checked, but email service tests may exercise template compilation).

**Step 2: Final commit if any fixes needed**

If lint or tests required changes, commit those fixes.
