# Gym Admin Dashboard — Design

## Overview

Next.js admin dashboard for the gym management platform. Consumes the NestJS API at `http://localhost:3000/api/v1`. Accessible to ADMIN and SUPER_ADMIN roles only.

## Tech Stack

- **Next.js 15** — App Router
- **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui** — UI components with dark mode via `next-themes`
- **TanStack Query** + **axios** — data fetching with caching, JWT interceptor
- **TanStack Table** — data tables via shadcn DataTable pattern

## Project Structure

```
gym-admin/
  src/
    app/
      (auth)/login/page.tsx
      (dashboard)/
        layout.tsx          # Sidebar + header + main content
        page.tsx            # Dashboard (stats overview)
        members/page.tsx
        subscriptions/page.tsx
        attendance/page.tsx
        trainers/page.tsx
        legal/page.tsx
        qr/page.tsx
        payroll/page.tsx    # SuperAdmin only
        settings/page.tsx   # SuperAdmin only
    components/
      ui/                   # shadcn/ui components
      sidebar.tsx
      header.tsx
      data-table.tsx
    lib/
      api-client.ts         # Axios instance with JWT interceptor
      auth-context.tsx      # React context: user, login, logout
      query-provider.tsx    # TanStack Query provider
    types/
      index.ts              # TypeScript types matching API responses
```

## Authentication

1. Login page at `/login` calls `POST /api/v1/auth/login` with Basic Auth header
2. Stores `accessToken` + `refreshToken` in localStorage
3. Axios request interceptor attaches `Authorization: Bearer <token>`
4. Axios response interceptor: on 401, attempts token refresh; if refresh fails, redirects to `/login`
5. Auth context provides `user` (decoded JWT payload: id, email, role), `login()`, `logout()`
6. Next.js middleware redirects unauthenticated users to `/login`
7. Role check: only ADMIN and SUPER_ADMIN roles allowed

## Pages

| Route | Purpose | Access |
|---|---|---|
| `/login` | Login form | Public |
| `/` | Dashboard — active members, revenue, today's attendance | Admin+ |
| `/members` | Members table with search, edit, status toggle | Admin+ |
| `/subscriptions` | Plans CRUD + active subscriptions + duo linkages | Admin+ |
| `/attendance` | Today's check-ins, search by member | Admin+ |
| `/trainers` | Trainer roster, schedules, member assignments | Admin+ |
| `/legal` | Document management, signing status | Admin+ |
| `/qr` | Generate/view entrance QR code | Admin+ |
| `/payroll` | Salary records | SuperAdmin |
| `/settings` | Gym settings | SuperAdmin |

## Layout

- **Sidebar** — collapsible, role-filtered nav items (payroll/settings hidden for Admin role)
- **Header** — dark mode toggle, user menu (profile, logout)
- **Main content area** — page content renders here

## API Client

- Axios instance with `baseURL: http://localhost:3000/api/v1`
- Request interceptor: attaches `Authorization: Bearer <accessToken>`
- Response interceptor: on 401, attempt refresh via stored refreshToken; if refresh fails, clear tokens and redirect to `/login`
- Basic Auth header added only for login/register requests (from env vars)

## API Endpoints Consumed

Refer to `docs/plans/HANDOVER.md` for the full endpoint list. Key endpoints:

- **Auth**: POST `/auth/login`, POST `/auth/register`
- **Users**: GET/PATCH/DELETE `/users`, GET `/users/:id`
- **Plans**: GET/POST/PATCH/DELETE `/subscription-plans`
- **Subscriptions**: GET `/subscriptions`
- **Payments**: GET `/payments/history`
- **Attendance**: GET `/attendance/today`, GET `/attendance/leaderboard`
- **QR**: POST `/qr/generate`, GET `/qr/active`
- **Trainers**: GET/POST `/trainers`, POST `/trainers/:id/schedules`, POST `/trainers/assign`
- **Legal**: GET/POST `/legal`, GET `/legal/:id/signatures`
- **Salary**: GET/POST/PATCH/DELETE `/salary`

## Dark Mode

- `next-themes` with system preference detection
- Toggle in header
- shadcn/ui components support dark mode natively
