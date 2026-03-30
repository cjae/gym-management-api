# Frontend Exports Module — Implementation Guide

> **Target repo:** `~/Documents/js/gym-admin` (Next.js 16 + TanStack Query + Tailwind)
>
> **API repo:** `~/Documents/js/gym-management` (NestJS — already deployed)

This document provides everything needed to implement the data exports UI in the gym-admin frontend. The API is complete — the frontend needs to call three GET endpoints that return file downloads.

---

## 1. API Contract

**Base URL:** `${NEXT_PUBLIC_API_URL}/v1` (default `http://localhost:3000/api/v1`)

**Auth:** Bearer JWT (already handled by `apiClient` interceptors in `src/lib/api-client.ts`)

**Role requirement:** ADMIN or SUPER_ADMIN (existing users in the admin app qualify)

**Feature gate:** `exports` must be enabled in the gym's license (API returns 403 if not)

### Endpoints

All three endpoints are **GET** requests that return a **binary file download** (not JSON).

| Endpoint | Query Params |
|---|---|
| `GET /exports/members` | `format`, `status`, `role`, `startDate`, `endDate` |
| `GET /exports/payments` | `format`, `status`, `paymentMethod`, `startDate`, `endDate` |
| `GET /exports/subscriptions` | `format`, `status`, `planId`, `startDate`, `endDate` |

### Shared Params

| Param | Type | Values | Default |
|---|---|---|---|
| `format` | enum | `csv`, `xlsx`, `pdf` | `csv` |
| `startDate` | string | ISO date `YYYY-MM-DD` | — |
| `endDate` | string | ISO date `YYYY-MM-DD` | — |

### Resource-Specific Params

**Members:**
| Param | Type | Values |
|---|---|---|
| `status` | UserStatus | `ACTIVE`, `INACTIVE`, `SUSPENDED` |
| `role` | Role | `MEMBER`, `TRAINER`, `ADMIN`, `SUPER_ADMIN` |

**Payments:**
| Param | Type | Values |
|---|---|---|
| `status` | PaymentStatus | `PENDING`, `PAID`, `FAILED` |
| `paymentMethod` | PaymentMethod | `CARD`, `MOBILE_MONEY`, `OFFLINE`, `BANK_TRANSFER`, `COMPLIMENTARY` |

**Subscriptions:**
| Param | Type | Values |
|---|---|---|
| `status` | SubscriptionStatus | `ACTIVE`, `PENDING`, `FROZEN`, `EXPIRED`, `CANCELLED` |
| `planId` | string (UUID) | Any valid plan ID |

### Response

The API returns a file buffer with these headers:

```
Content-Type: text/csv | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet | application/pdf
Content-Disposition: attachment; filename="members-export-2026-03-29.csv"
Cache-Control: no-store, private, max-age=0
```

**Important:** These are NOT JSON responses. You must use `responseType: 'blob'` in axios.

### Error Responses (JSON)

| Status | Meaning |
|---|---|
| 400 | Invalid query params (bad enum value, invalid date) |
| 401 | Missing/expired JWT |
| 403 | Insufficient role or `exports` feature not licensed |
| 429 | Rate limited (30 req/min global) |

### Data Limits

- Max 10,000 records per export (server-enforced, no pagination needed)
- Date filtering is inclusive on both ends

---

## 2. Exported Columns (for UI reference)

These are the columns the API includes in each export. Useful for documenting what the user will get.

**Members:** First Name, Last Name, Email, Phone, Gender, Birthday, Status, Join Date, Current Plan, Subscription Status, Subscription End Date, Payment Method

**Payments:** Member Name, Member Email, Plan Name, Amount (KES), Payment Status, Payment Method, Reference, Date

**Subscriptions:** Primary Member, Primary Email, Duo Member, Duo Email, Plan, Price (KES), Billing Interval, Status, Start Date, End Date, Auto-Renew, Payment Method, Frozen

---

## 3. What to Build

### 3a. API Hook — `src/lib/api/exports.ts`

Create a single file with a helper function for downloading exports. This is NOT a React Query hook — it's an imperative download action triggered by a button click, not a data-fetching query.

```typescript
import { apiClient } from '../api-client';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export type ExportResource = 'members' | 'payments' | 'subscriptions';

export interface ExportParams {
  format?: ExportFormat;
  status?: string;
  role?: string;
  paymentMethod?: string;
  planId?: string;
  startDate?: string;
  endDate?: string;
}

export async function downloadExport(
  resource: ExportResource,
  params: ExportParams = {},
): Promise<void> {
  // Strip undefined params
  const query = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== ''),
  );

  const response = await apiClient.get(`/exports/${resource}`, {
    params: query,
    responseType: 'blob',
  });

  // Extract filename from Content-Disposition header
  const disposition = response.headers['content-disposition'] || '';
  const match = disposition.match(/filename="(.+?)"/);
  const filename = match?.[1] || `${resource}-export.${params.format || 'csv'}`;

  // Trigger browser download
  const url = window.URL.createObjectURL(new Blob([response.data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
```

### 3b. Export Dialog Component — `src/components/export-dialog.tsx`

A reusable dialog that:
1. Lets the user pick a format (CSV, Excel, PDF) via radio buttons or segmented control
2. Shows resource-specific filter options (status dropdown, date range)
3. Has an "Export" button that calls `downloadExport()` and shows a loading state
4. Shows a toast on success/error

**Props interface:**

```typescript
interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource: 'members' | 'payments' | 'subscriptions';
  title: string; // e.g. "Export Members"
}
```

**Filter fields by resource:**

| Resource | Filters to show |
|---|---|
| `members` | Status (ACTIVE/INACTIVE/SUSPENDED), Date range |
| `payments` | Status (PENDING/PAID/FAILED), Payment Method dropdown, Date range |
| `subscriptions` | Status (ACTIVE/PENDING/FROZEN/EXPIRED/CANCELLED), Plan dropdown (fetch from `/subscription-plans`), Date range |

**UI pattern:** Follow the existing dialog pattern from `add-member-dialog.tsx`:
- Use `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle` from `@/components/ui/dialog`
- Use `Select` from `@/components/ui/select` for dropdowns
- Use `<input type="date">` for date pickers (consistent with existing date inputs)
- Use `Button` with loading state (`disabled` + spinner during download)
- Use `toast.success()` / `toast.error()` from sonner

**Format selector:** Three radio-style buttons or a select dropdown:
- CSV — spreadsheet-compatible, smallest file
- Excel (.xlsx) — formatted with bold headers
- PDF — printable report with title and date

### 3c. Export Buttons on Existing Pages

Add an "Export" button to each of these existing pages. Place it in the top action bar next to the existing "Add" button.

| Page | File | Button Label |
|---|---|---|
| Members | `src/app/(dashboard)/members/page.tsx` | "Export" |
| Subscriptions | `src/app/(dashboard)/subscriptions/page.tsx` | "Export" |

Payments don't have a dedicated page currently, so the payments export can live on one of these pages (e.g. subscriptions) or on a new `/exports` page.

**Button pattern:**

```tsx
import { Download } from 'lucide-react';

<Button variant="outline" onClick={() => setExportOpen(true)}>
  <Download className="mr-2 h-4 w-4" /> Export
</Button>
```

### 3d. (Optional) Dedicated Exports Page — `src/app/(dashboard)/exports/page.tsx`

If you prefer a single page for all exports instead of buttons on each page:

- Route: `/exports`
- Three cards or tabs: Members, Payments, Subscriptions
- Each card has its own filter controls and export button
- Add to sidebar navigation in `src/components/sidebar.tsx`
- Add `"exports"` to the `Module` type in `src/config/branding.ts`

This is optional — the button-on-each-page approach is simpler and may be preferred.

---

## 4. Existing Code to Reference

These files show the patterns to follow:

| Pattern | Reference File |
|---|---|
| API hook structure | `src/lib/api/users.ts` |
| API client + auth | `src/lib/api-client.ts` |
| Dialog with form | `src/app/(dashboard)/members/add-member-dialog.tsx` |
| Select dropdowns | `src/components/ui/select.tsx` |
| Page with table + actions | `src/app/(dashboard)/members/page.tsx` |
| Toast notifications | Any dialog — uses `toast` from `sonner` |
| Button variants | `src/components/ui/button.tsx` |
| Sidebar nav items | `src/components/sidebar.tsx` |
| Module feature flags | `src/config/branding.ts` |
| TypeScript types | `src/types/index.ts` |

---

## 5. Types to Add to `src/types/index.ts`

```typescript
// Export
export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
```

The `PaymentMethod`, `UserStatus`, `SubscriptionStatus`, and `PaymentStatus` types already exist.

---

## 6. Example Request Flow

```
1. User clicks "Export" button on Members page
2. ExportDialog opens with format selector + filters
3. User picks "Excel", sets status = "ACTIVE", date range Jan–Mar 2026
4. User clicks "Export" button in dialog
5. Frontend calls: GET /exports/members?format=xlsx&status=ACTIVE&startDate=2026-01-01&endDate=2026-03-31
   - Uses responseType: 'blob'
   - Auth header attached automatically by apiClient interceptor
6. API returns .xlsx binary with Content-Disposition header
7. Frontend creates object URL from blob, triggers download
8. Browser saves "members-export-2026-03-29.xlsx"
9. Toast: "Export downloaded successfully"
10. Dialog closes
```

---

## 7. Error Handling

```typescript
try {
  await downloadExport(resource, params);
  toast.success('Export downloaded successfully');
  onOpenChange(false);
} catch (error) {
  // The blob responseType means error responses need special handling
  if (error instanceof AxiosError && error.response?.data instanceof Blob) {
    const text = await error.response.data.text();
    const json = JSON.parse(text);
    toast.error(json.message || 'Export failed');
  } else {
    toast.error(getErrorMessage(error, 'Export failed'));
  }
}
```

**Important:** When `responseType: 'blob'` is set, axios returns error responses as Blobs too. You need to read the blob as text, then parse JSON to get the error message. The helper above handles this.

---

## 8. Checklist

- [ ] Create `src/lib/api/exports.ts` with `downloadExport()` helper
- [ ] Create `src/components/export-dialog.tsx` reusable dialog
- [ ] Add `ExportFormat` type to `src/types/index.ts`
- [ ] Add "Export" button + dialog to Members page
- [ ] Add "Export" button + dialog to Subscriptions page (include payments export here or separately)
- [ ] Handle blob error responses in the download function
- [ ] Test with each format (CSV, XLSX, PDF) to verify browser download works
- [ ] Test error cases: no data, invalid date range, 403 (feature not licensed)
