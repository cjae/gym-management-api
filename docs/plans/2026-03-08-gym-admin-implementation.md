# Gym Admin Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Next.js admin dashboard for the gym management platform that consumes the NestJS API.

**Architecture:** Next.js 15 App Router with shadcn/ui components. Custom auth context stores JWT tokens in localStorage. Axios instance with interceptors handles API communication. TanStack Query manages server state. Branding config file enables white-labeling.

**Tech Stack:** Next.js 15, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query, TanStack Table, axios, next-themes, jwt-decode

---

### Task 1: Project Scaffolding

**Files:**
- Create: `~/Documents/js/gym-admin/` (entire project)

**Step 1: Create Next.js project**

```bash
cd ~/Documents/js
npx create-next-app@latest gym-admin --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-yarn
```

Accept defaults. This creates the project with App Router, TypeScript, Tailwind CSS, ESLint, and `src/` directory.

**Step 2: Install dependencies**

```bash
cd ~/Documents/js/gym-admin
yarn add axios @tanstack/react-query @tanstack/react-table jwt-decode next-themes
yarn add -D @tanstack/eslint-plugin-query
```

**Step 3: Initialize shadcn/ui**

```bash
cd ~/Documents/js/gym-admin
npx shadcn@latest init
```

When prompted:
- Style: Default
- Base color: Neutral
- CSS variables: Yes

**Step 4: Add shadcn/ui components needed for the dashboard**

```bash
cd ~/Documents/js/gym-admin
npx shadcn@latest add button card input label table badge dialog dropdown-menu sheet separator avatar skeleton tabs form select textarea toast sonner switch command popover calendar
```

**Step 5: Verify the project runs**

```bash
cd ~/Documents/js/gym-admin
yarn dev
```

Expected: Dev server starts on port 3000 (or 3001 if 3000 is taken).

**Step 6: Configure port to 3001**

Edit `~/Documents/js/gym-admin/package.json` — change the `dev` script:
```json
"dev": "next dev -p 3001"
```

**Step 7: Create .env.local**

Create `~/Documents/js/gym-admin/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1
NEXT_PUBLIC_BASIC_AUTH_USER=admin
NEXT_PUBLIC_BASIC_AUTH_PASSWORD=admin
```

**Step 8: Initialize git and commit**

```bash
cd ~/Documents/js/gym-admin
git init
git add .
git commit -m "chore: scaffold Next.js 15 project with shadcn/ui, TanStack Query, and axios"
```

---

### Task 2: Branding Config + Theme Setup

**Files:**
- Create: `src/config/branding.ts`
- Create: `src/lib/utils.ts` (if not already created by shadcn init)
- Modify: `src/app/layout.tsx`

**Step 1: Create branding config**

Create `~/Documents/js/gym-admin/src/config/branding.ts`:
```typescript
export const branding = {
  gymName: 'FitHub',
  tagline: 'Your Fitness Journey Starts Here',
  logo: '/logo.svg',
  favicon: '/favicon.ico',
  currency: 'KES',
  accentColor: {
    light: '142.1 76.2% 36.3%',  // HSL values for CSS variables
    dark: '142.1 70.6% 45.3%',
  },
  supportEmail: 'support@fithub.co.ke',
};
```

**Step 2: Update root layout with theme provider**

Modify `~/Documents/js/gym-admin/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { branding } from '@/config/branding';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: `${branding.gymName} Admin`,
  description: `${branding.gymName} - ${branding.tagline}`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Step 3: Create ThemeProvider component**

Create `~/Documents/js/gym-admin/src/components/theme-provider.tsx`:
```tsx
'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
```

**Step 4: Update globals.css to use branding accent color**

Modify `~/Documents/js/gym-admin/src/app/globals.css` — update the `--primary` CSS variable in both `:root` and `.dark` blocks to use the branding accent color. The exact lines depend on what shadcn/ui generated, but replace the `--primary` value with the accent color from branding config.

**Step 5: Add placeholder logo**

Place a simple SVG at `~/Documents/js/gym-admin/public/logo.svg` (a dumbbell icon or text placeholder).

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add branding config and dark mode theme provider"
```

---

### Task 3: TypeScript Types

**Files:**
- Create: `src/types/index.ts`

**Step 1: Create types file**

Create `~/Documents/js/gym-admin/src/types/index.ts`:
```typescript
// Enums
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'TRAINER' | 'MEMBER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type SubscriptionStatus = 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';
export type SalaryStatus = 'PENDING' | 'PAID';

// Auth
export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}

// User
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserRequest {
  firstName?: string;
  lastName?: string;
  phone?: string;
  status?: UserStatus;
}

// Subscription Plan
export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  description?: string;
  maxMembers: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanRequest {
  name: string;
  price: number;
  durationDays: number;
  description?: string;
  maxMembers?: number;
}

export interface UpdatePlanRequest extends Partial<CreatePlanRequest> {
  isActive?: boolean;
}

// Subscription
export interface MemberSubscription {
  id: string;
  primaryMemberId: string;
  primaryMember?: User;
  plan?: SubscriptionPlan;
  planId: string;
  startDate: string;
  endDate: string;
  status: SubscriptionStatus;
  paymentStatus: PaymentStatus;
  paystackReference?: string;
  members?: SubscriptionMember[];
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionMember {
  id: string;
  subscriptionId: string;
  memberId: string;
  member?: User;
}

// Payment
export interface Payment {
  id: string;
  memberId: string;
  subscriptionId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  paystackReference: string;
  paymentMethod?: string;
  createdAt: string;
}

// Attendance
export interface Attendance {
  id: string;
  memberId: string;
  member?: User;
  checkInDate: string;
  checkInTime: string;
  createdAt: string;
}

export interface Streak {
  id: string;
  memberId: string;
  currentStreak: number;
  longestStreak: number;
  lastCheckInDate: string;
}

export interface LeaderboardEntry {
  memberId: string;
  memberName: string;
  currentStreak: number;
  longestStreak: number;
}

// Trainer
export interface TrainerProfile {
  id: string;
  userId: string;
  user?: User;
  specialization?: string;
  bio?: string;
  availability?: Record<string, unknown>;
  schedules?: TrainerSchedule[];
  assignments?: TrainerAssignment[];
  createdAt: string;
}

export interface TrainerSchedule {
  id: string;
  trainerId: string;
  title: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  maxCapacity?: number;
}

export interface TrainerAssignment {
  id: string;
  trainerId: string;
  memberId: string;
  member?: User;
  startDate: string;
  endDate?: string;
  notes?: string;
}

export interface CreateTrainerProfileRequest {
  userId: string;
  specialization?: string;
  bio?: string;
  availability?: Record<string, unknown>;
}

export interface CreateScheduleRequest {
  title: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  maxCapacity?: number;
}

export interface AssignMemberRequest {
  trainerId: string;
  memberId: string;
  startDate: string;
  endDate?: string;
  notes?: string;
}

// Legal
export interface LegalDocument {
  id: string;
  title: string;
  content: string;
  version: number;
  isRequired: boolean;
  createdAt: string;
}

export interface DocumentSignature {
  id: string;
  memberId: string;
  member?: User;
  documentId: string;
  signatureData: string;
  signedAt: string;
  ipAddress?: string;
}

export interface CreateDocumentRequest {
  title: string;
  content: string;
  isRequired?: boolean;
}

// QR
export interface GymQrCode {
  id: string;
  code: string;
  isActive: boolean;
  createdAt: string;
}

// Salary
export interface StaffSalaryRecord {
  id: string;
  staffId: string;
  staff?: User;
  month: number;
  year: number;
  amount: number;
  currency: string;
  status: SalaryStatus;
  paidAt?: string;
  notes?: string;
  createdAt: string;
}

export interface CreateSalaryRecordRequest {
  staffId: string;
  month: number;
  year: number;
  amount: number;
  notes?: string;
}

// Analytics
export interface DashboardStats {
  members: { total: number; active: number; new: number };
  subscriptions: { active: number; expiringSoon: number };
  attendance: { today: number; avgDaily: number };
  revenue?: { monthly: number; total: number };
  recentActivity: Array<{
    type: string;
    description: string;
    timestamp: string;
  }>;
}

// Pagination
export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}
```

**Step 2: Commit**

```bash
git add .
git commit -m "feat: add TypeScript types matching API response shapes"
```

---

### Task 4: API Client + Auth Context

**Files:**
- Create: `src/lib/api-client.ts`
- Create: `src/lib/auth-context.tsx`
- Create: `src/lib/query-provider.tsx`
- Modify: `src/app/layout.tsx`

**Step 1: Create axios API client**

Create `~/Documents/js/gym-admin/src/lib/api-client.ts`:
```typescript
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api/v1';
const BASIC_AUTH_USER = process.env.NEXT_PUBLIC_BASIC_AUTH_USER || '';
const BASIC_AUTH_PASSWORD = process.env.NEXT_PUBLIC_BASIC_AUTH_PASSWORD || '';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor — attach JWT Bearer token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 with token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }

      try {
        // Attempt token refresh — this endpoint uses JWT auth with the refresh token
        const { data } = await axios.post(
          `${API_URL}/auth/refresh`,
          {},
          { headers: { Authorization: `Bearer ${refreshToken}` } },
        );

        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return apiClient(originalRequest);
      } catch {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

function clearTokens() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
}

// Helper for login — uses Basic Auth instead of Bearer
export async function loginRequest(email: string, password: string) {
  const basicAuth = btoa(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`);
  const { data } = await axios.post(
    `${API_URL}/auth/login`,
    { email, password },
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
    },
  );
  return data;
}
```

**Step 2: Create auth context**

Create `~/Documents/js/gym-admin/src/lib/auth-context.tsx`:
```tsx
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { jwtDecode } from 'jwt-decode';
import { loginRequest } from './api-client';
import type { JwtPayload, Role } from '@/types';

interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const decodeToken = useCallback((token: string): AuthUser | null => {
    try {
      const decoded = jwtDecode<JwtPayload>(token);
      if (decoded.exp * 1000 < Date.now()) return null;
      if (decoded.role !== 'ADMIN' && decoded.role !== 'SUPER_ADMIN') return null;
      return { id: decoded.sub, email: decoded.email, role: decoded.role };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      const decoded = decodeToken(token);
      setUser(decoded);
    }
    setIsLoading(false);
  }, [decodeToken]);

  const login = async (email: string, password: string) => {
    const data = await loginRequest(email, password);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);

    const decoded = decodeToken(data.accessToken);
    if (!decoded) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      throw new Error('Access denied. Admin or Super Admin role required.');
    }
    setUser(decoded);
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
```

**Step 3: Create TanStack Query provider**

Create `~/Documents/js/gym-admin/src/lib/query-provider.tsx`:
```tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000, // 30 seconds
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
```

**Step 4: Update root layout with providers**

Modify `~/Documents/js/gym-admin/src/app/layout.tsx` — wrap children with `QueryProvider` and `AuthProvider`:
```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { QueryProvider } from '@/lib/query-provider';
import { AuthProvider } from '@/lib/auth-context';
import { Toaster } from '@/components/ui/sonner';
import { branding } from '@/config/branding';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: `${branding.gymName} Admin`,
  description: `${branding.gymName} - ${branding.tagline}`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider>
              {children}
              <Toaster />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
```

**Step 5: Create Next.js middleware for route protection**

Create `~/Documents/js/gym-admin/src/middleware.ts`:
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Middleware runs on the server — can't access localStorage
  // Route protection is handled client-side by auth context
  // This middleware just ensures /login is accessible
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.svg).*)'],
};
```

Note: Since JWT tokens are in localStorage (not cookies), route protection is handled client-side in the dashboard layout. The middleware is a placeholder for future cookie-based auth if needed.

**Step 6: Verify the project compiles**

```bash
cd ~/Documents/js/gym-admin
yarn build
```

Expected: Build succeeds with no errors.

**Step 7: Commit**

```bash
git add .
git commit -m "feat: add API client with JWT interceptor, auth context, and query provider"
```

---

### Task 5: Dashboard Layout (Sidebar + Header)

**Files:**
- Create: `src/components/sidebar.tsx`
- Create: `src/components/header.tsx`
- Create: `src/components/theme-toggle.tsx`
- Create: `src/app/(dashboard)/layout.tsx`
- Modify: `src/app/page.tsx` → redirect to dashboard

**Step 1: Create theme toggle component**

Create `~/Documents/js/gym-admin/src/components/theme-toggle.tsx`:
```tsx
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ThemeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>Light</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>Dark</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>System</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**Step 2: Create sidebar component**

Create `~/Documents/js/gym-admin/src/components/sidebar.tsx`:
```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  CalendarCheck,
  Dumbbell,
  FileText,
  QrCode,
  Wallet,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { branding } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { useState } from 'react';

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/members', label: 'Members', icon: Users, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/subscriptions', label: 'Subscriptions', icon: CreditCard, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/attendance', label: 'Attendance', icon: CalendarCheck, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/trainers', label: 'Trainers', icon: Dumbbell, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/legal', label: 'Legal Docs', icon: FileText, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/qr', label: 'QR Code', icon: QrCode, roles: ['ADMIN', 'SUPER_ADMIN'] },
  { href: '/payroll', label: 'Payroll', icon: Wallet, roles: ['SUPER_ADMIN'] },
  { href: '/settings', label: 'Settings', icon: Settings, roles: ['SUPER_ADMIN'] },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const filteredItems = navItems.filter(
    (item) => user && item.roles.includes(user.role),
  );

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="flex h-16 items-center justify-between border-b px-4">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2">
            <img src={branding.logo} alt={branding.gymName} className="h-8 w-8" />
            <span className="font-bold text-lg">{branding.gymName}</span>
          </Link>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(collapsed && 'mx-auto')}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {filteredItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                collapsed && 'justify-center px-2',
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

**Step 3: Create header component**

Create `~/Documents/js/gym-admin/src/components/header.tsx`:
```tsx
'use client';

import { LogOut, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

export function Header() {
  const { user, logout } = useAuth();

  const initials = user
    ? user.email.substring(0, 2).toUpperCase()
    : '??';

  return (
    <header className="flex h-16 items-center justify-end gap-4 border-b bg-card px-6">
      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <span className="text-sm">{user?.email}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>
            <User className="mr-2 h-4 w-4" />
            {user?.role}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" />
            Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
```

**Step 4: Create dashboard layout**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/layout.tsx`:
```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Sidebar } from '@/components/sidebar';
import { Header } from '@/components/header';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [user, isLoading, router]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Skeleton className="h-12 w-12 rounded-full" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

**Step 5: Update root page to redirect**

Replace `~/Documents/js/gym-admin/src/app/page.tsx` — this file will be superseded by the `(dashboard)/page.tsx`. Delete the default Next.js welcome page and replace with a redirect:
```tsx
import { redirect } from 'next/navigation';

export default function RootPage() {
  redirect('/');
}
```

Actually, since `(dashboard)/page.tsx` maps to `/`, the root `app/page.tsx` should be removed and the dashboard page placed at `app/(dashboard)/page.tsx` instead. Remove `app/page.tsx`.

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add dashboard layout with collapsible sidebar, header, and route protection"
```

---

### Task 6: Login Page

**Files:**
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/layout.tsx`

**Step 1: Create auth layout (centered, no sidebar)**

Create `~/Documents/js/gym-admin/src/app/(auth)/layout.tsx`:
```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      {children}
    </div>
  );
}
```

**Step 2: Create login page**

Create `~/Documents/js/gym-admin/src/app/(auth)/login/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { branding } from '@/config/branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await login(email, password);
      router.push('/');
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Invalid credentials. Please try again.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <img src={branding.logo} alt={branding.gymName} className="mx-auto h-12 w-12 mb-2" />
        <CardTitle className="text-2xl">{branding.gymName}</CardTitle>
        <CardDescription>Sign in to the admin dashboard</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="admin@gym.co.ke"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

**Step 3: Verify login page renders**

```bash
cd ~/Documents/js/gym-admin
yarn dev
```

Navigate to `http://localhost:3001/login` — should see a centered login card with the gym logo, email, and password fields.

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add login page with branding and error handling"
```

---

### Task 7: Dashboard Home Page (Stats Overview)

**Files:**
- Create: `src/app/(dashboard)/page.tsx`
- Create: `src/lib/api/analytics.ts`

**Step 1: Create analytics API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/analytics.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { DashboardStats } from '@/types';

export function useDashboard() {
  return useQuery({
    queryKey: ['analytics', 'dashboard'],
    queryFn: async () => {
      const { data } = await apiClient.get<DashboardStats>('/analytics/dashboard');
      return data;
    },
  });
}
```

**Step 2: Create dashboard page**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/page.tsx`:
```tsx
'use client';

import { Users, CreditCard, CalendarCheck, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useDashboard } from '@/lib/api/analytics';
import { branding } from '@/config/branding';

export default function DashboardPage() {
  const { data, isLoading } = useDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    {
      title: 'Total Members',
      value: data?.members.total ?? 0,
      description: `${data?.members.active ?? 0} active`,
      icon: Users,
    },
    {
      title: 'Active Subscriptions',
      value: data?.subscriptions.active ?? 0,
      description: `${data?.subscriptions.expiringSoon ?? 0} expiring soon`,
      icon: CreditCard,
    },
    {
      title: "Today's Check-ins",
      value: data?.attendance.today ?? 0,
      description: `${data?.attendance.avgDaily ?? 0} daily avg`,
      icon: CalendarCheck,
    },
    {
      title: 'Monthly Revenue',
      value: data?.revenue
        ? `${branding.currency} ${data.revenue.monthly.toLocaleString()}`
        : 'N/A',
      description: data?.revenue
        ? `${branding.currency} ${data.revenue.total.toLocaleString()} total`
        : 'Admin view',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {data?.recentActivity && data.recentActivity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.recentActivity.map((activity, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{activity.description}</span>
                  <span className="text-muted-foreground">
                    {new Date(activity.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add dashboard home page with stats cards and recent activity"
```

---

### Task 8: Reusable Data Table Component

**Files:**
- Create: `src/components/data-table.tsx`
- Create: `src/components/data-table-pagination.tsx`

**Step 1: Create data table component**

Create `~/Documents/js/gym-admin/src/components/data-table.tsx`:
```tsx
'use client';

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  SortingState,
  getFilteredRowModel,
  ColumnFiltersState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { DataTablePagination } from './data-table-pagination';
import { useState } from 'react';

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  pageCount?: number;
  page?: number;
  onPageChange?: (page: number) => void;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = 'Search...',
  pageCount,
  page,
  onPageChange,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    state: { sorting, columnFilters },
  });

  return (
    <div className="space-y-4">
      {searchKey && (
        <Input
          placeholder={searchPlaceholder}
          value={(table.getColumn(searchKey)?.getFilterValue() as string) ?? ''}
          onChange={(e) =>
            table.getColumn(searchKey)?.setFilterValue(e.target.value)
          }
          className="max-w-sm"
        />
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount && onPageChange && page !== undefined && (
        <DataTablePagination
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
        />
      )}
    </div>
  );
}
```

**Step 2: Create pagination component**

Create `~/Documents/js/gym-admin/src/components/data-table-pagination.tsx`:
```tsx
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface DataTablePaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

export function DataTablePagination({
  page,
  pageCount,
  onPageChange,
}: DataTablePaginationProps) {
  return (
    <div className="flex items-center justify-end space-x-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft className="h-4 w-4" />
        Previous
      </Button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
      >
        Next
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add reusable data table with sorting, filtering, and pagination"
```

---

### Task 9: Members Page

**Files:**
- Create: `src/lib/api/users.ts`
- Create: `src/app/(dashboard)/members/page.tsx`
- Create: `src/app/(dashboard)/members/columns.tsx`
- Create: `src/app/(dashboard)/members/edit-member-dialog.tsx`

**Step 1: Create users API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/users.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { User, UpdateUserRequest, PaginatedResponse } from '@/types';

export function useUsers(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['users', page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<User>>('/users', {
        params: { page, limit },
      });
      return data;
    },
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: async () => {
      const { data } = await apiClient.get<User>(`/users/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: UpdateUserRequest }) => {
      const { data } = await apiClient.patch<User>(`/users/${id}`, dto);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
```

**Step 2: Create columns definition**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/members/columns.tsx`:
```tsx
'use client';

import { ColumnDef } from '@tanstack/react-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { User } from '@/types';

interface ColumnsProps {
  onEdit: (user: User) => void;
  onDelete: (user: User) => void;
}

export function getColumns({ onEdit, onDelete }: ColumnsProps): ColumnDef<User>[] {
  return [
    {
      accessorKey: 'firstName',
      header: 'Name',
      cell: ({ row }) => `${row.original.firstName} ${row.original.lastName}`,
    },
    { accessorKey: 'email', header: 'Email' },
    { accessorKey: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone || '—' },
    {
      accessorKey: 'role',
      header: 'Role',
      cell: ({ row }) => <Badge variant="outline">{row.original.role}</Badge>,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status;
        const variant = status === 'ACTIVE' ? 'default' : 'secondary';
        return <Badge variant={variant}>{status}</Badge>;
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Joined',
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(row.original)}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(row.original)} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
}
```

**Step 3: Create edit member dialog**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/members/edit-member-dialog.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useUpdateUser } from '@/lib/api/users';
import { toast } from 'sonner';
import type { User, UserStatus } from '@/types';

interface EditMemberDialogProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditMemberDialog({ user, open, onOpenChange }: EditMemberDialogProps) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [status, setStatus] = useState<UserStatus>('ACTIVE');
  const updateUser = useUpdateUser();

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName);
      setLastName(user.lastName);
      setPhone(user.phone || '');
      setStatus(user.status);
    }
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    try {
      await updateUser.mutateAsync({
        id: user.id,
        dto: { firstName, lastName, phone: phone || undefined, status },
      });
      toast.success('Member updated successfully');
      onOpenChange(false);
    } catch {
      toast.error('Failed to update member');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Member</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as UserStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={updateUser.isPending}>
              {updateUser.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Create members page**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/members/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { getColumns } from './columns';
import { EditMemberDialog } from './edit-member-dialog';
import { useUsers, useDeleteUser } from '@/lib/api/users';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import type { User } from '@/types';

export default function MembersPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useUsers(page);
  const deleteUser = useDeleteUser();
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  const handleEdit = (user: User) => {
    setEditUser(user);
    setEditOpen(true);
  };

  const handleDelete = async (user: User) => {
    if (!confirm(`Delete ${user.firstName} ${user.lastName}?`)) return;
    try {
      await deleteUser.mutateAsync(user.id);
      toast.success('Member deleted');
    } catch {
      toast.error('Failed to delete member');
    }
  };

  const columns = getColumns({ onEdit: handleEdit, onDelete: handleDelete });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Members</h1>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Members</h1>

      <DataTable
        columns={columns}
        data={data?.data ?? []}
        searchKey="email"
        searchPlaceholder="Search by email..."
        page={page}
        pageCount={data?.meta.totalPages ?? 1}
        onPageChange={setPage}
      />

      <EditMemberDialog user={editUser} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add members page with data table, edit dialog, and delete"
```

---

### Task 10: Subscriptions Page (Plans CRUD + Active Subscriptions)

**Files:**
- Create: `src/lib/api/subscription-plans.ts`
- Create: `src/lib/api/subscriptions.ts`
- Create: `src/app/(dashboard)/subscriptions/page.tsx`
- Create: `src/app/(dashboard)/subscriptions/plans-table.tsx`
- Create: `src/app/(dashboard)/subscriptions/plan-dialog.tsx`
- Create: `src/app/(dashboard)/subscriptions/subscriptions-table.tsx`

**Step 1: Create subscription plans API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/subscription-plans.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { SubscriptionPlan, CreatePlanRequest, UpdatePlanRequest, PaginatedResponse } from '@/types';

export function usePlans(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['plans', page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<SubscriptionPlan>>('/subscription-plans/all', {
        params: { page, limit },
      });
      return data;
    },
  });
}

export function useCreatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreatePlanRequest) => {
      const { data } = await apiClient.post<SubscriptionPlan>('/subscription-plans', dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });
}

export function useUpdatePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, dto }: { id: string; dto: UpdatePlanRequest }) => {
      const { data } = await apiClient.patch<SubscriptionPlan>(`/subscription-plans/${id}`, dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });
}

export function useDeletePlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/subscription-plans/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plans'] }),
  });
}
```

**Step 2: Create subscriptions API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/subscriptions.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { MemberSubscription } from '@/types';

export function useSubscriptions() {
  return useQuery({
    queryKey: ['subscriptions'],
    queryFn: async () => {
      const { data } = await apiClient.get<MemberSubscription[]>('/subscriptions');
      return data;
    },
  });
}
```

**Step 3: Create plan dialog (create/edit)**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/subscriptions/plan-dialog.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useCreatePlan, useUpdatePlan } from '@/lib/api/subscription-plans';
import { toast } from 'sonner';
import type { SubscriptionPlan } from '@/types';

interface PlanDialogProps {
  plan: SubscriptionPlan | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlanDialog({ plan, open, onOpenChange }: PlanDialogProps) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [durationDays, setDurationDays] = useState('');
  const [description, setDescription] = useState('');
  const [maxMembers, setMaxMembers] = useState('1');
  const [isActive, setIsActive] = useState(true);

  const createPlan = useCreatePlan();
  const updatePlan = useUpdatePlan();
  const isEditing = !!plan;

  useEffect(() => {
    if (plan) {
      setName(plan.name);
      setPrice(plan.price.toString());
      setDurationDays(plan.durationDays.toString());
      setDescription(plan.description || '');
      setMaxMembers(plan.maxMembers.toString());
      setIsActive(plan.isActive);
    } else {
      setName('');
      setPrice('');
      setDurationDays('');
      setDescription('');
      setMaxMembers('1');
      setIsActive(true);
    }
  }, [plan]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEditing) {
        await updatePlan.mutateAsync({
          id: plan.id,
          dto: {
            name,
            price: Number(price),
            durationDays: Number(durationDays),
            description: description || undefined,
            maxMembers: Number(maxMembers),
            isActive,
          },
        });
        toast.success('Plan updated');
      } else {
        await createPlan.mutateAsync({
          name,
          price: Number(price),
          durationDays: Number(durationDays),
          description: description || undefined,
          maxMembers: Number(maxMembers),
        });
        toast.success('Plan created');
      }
      onOpenChange(false);
    } catch {
      toast.error(isEditing ? 'Failed to update plan' : 'Failed to create plan');
    }
  };

  const isPending = createPlan.isPending || updatePlan.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Plan' : 'Create Plan'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price">Price (KES)</Label>
              <Input id="price" type="number" value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Duration (days)</Label>
              <Input id="duration" type="number" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="maxMembers">Max Members</Label>
            <Input id="maxMembers" type="number" min="1" max="2" value={maxMembers} onChange={(e) => setMaxMembers(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {isEditing && (
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Active</Label>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Create plans table**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/subscriptions/plans-table.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, Pencil, Trash2, Plus } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { usePlans, useDeletePlan } from '@/lib/api/subscription-plans';
import { PlanDialog } from './plan-dialog';
import { branding } from '@/config/branding';
import { toast } from 'sonner';
import type { SubscriptionPlan } from '@/types';

export function PlansTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePlans(page);
  const deletePlan = useDeletePlan();
  const [dialogPlan, setDialogPlan] = useState<SubscriptionPlan | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleDelete = async (plan: SubscriptionPlan) => {
    if (!confirm(`Delete "${plan.name}"?`)) return;
    try {
      await deletePlan.mutateAsync(plan.id);
      toast.success('Plan deleted');
    } catch {
      toast.error('Failed to delete plan');
    }
  };

  const columns: ColumnDef<SubscriptionPlan>[] = [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'price',
      header: 'Price',
      cell: ({ row }) => `${branding.currency} ${row.original.price.toLocaleString()}`,
    },
    { accessorKey: 'durationDays', header: 'Duration (days)' },
    { accessorKey: 'maxMembers', header: 'Max Members' },
    {
      accessorKey: 'isActive',
      header: 'Status',
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'default' : 'secondary'}>
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => { setDialogPlan(row.original); setDialogOpen(true); }}>
              <Pencil className="mr-2 h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDelete(row.original)} className="text-destructive">
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Subscription Plans</h2>
        <Button onClick={() => { setDialogPlan(null); setDialogOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> Add Plan
        </Button>
      </div>
      <DataTable
        columns={columns}
        data={data?.data ?? []}
        page={page}
        pageCount={data?.meta.totalPages ?? 1}
        onPageChange={setPage}
      />
      <PlanDialog plan={dialogPlan} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
```

**Step 5: Create subscriptions table**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/subscriptions/subscriptions-table.tsx`:
```tsx
'use client';

import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { useSubscriptions } from '@/lib/api/subscriptions';
import type { MemberSubscription } from '@/types';

const columns: ColumnDef<MemberSubscription>[] = [
  {
    accessorKey: 'primaryMember',
    header: 'Member',
    cell: ({ row }) => {
      const m = row.original.primaryMember;
      return m ? `${m.firstName} ${m.lastName}` : row.original.primaryMemberId;
    },
  },
  {
    accessorKey: 'plan',
    header: 'Plan',
    cell: ({ row }) => row.original.plan?.name ?? '—',
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const s = row.original.status;
      const variant = s === 'ACTIVE' ? 'default' : s === 'EXPIRED' ? 'secondary' : 'destructive';
      return <Badge variant={variant}>{s}</Badge>;
    },
  },
  {
    accessorKey: 'members',
    header: 'Duo',
    cell: ({ row }) => {
      const members = row.original.members;
      return members && members.length > 1 ? `${members.length} members` : 'Solo';
    },
  },
  {
    accessorKey: 'startDate',
    header: 'Start',
    cell: ({ row }) => new Date(row.original.startDate).toLocaleDateString(),
  },
  {
    accessorKey: 'endDate',
    header: 'End',
    cell: ({ row }) => new Date(row.original.endDate).toLocaleDateString(),
  },
];

export function SubscriptionsTable() {
  const { data } = useSubscriptions();

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Active Subscriptions</h2>
      <DataTable columns={columns} data={data ?? []} searchKey="primaryMember" searchPlaceholder="Search by member..." />
    </div>
  );
}
```

**Step 6: Create subscriptions page**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/subscriptions/page.tsx`:
```tsx
import { PlansTable } from './plans-table';
import { SubscriptionsTable } from './subscriptions-table';

export default function SubscriptionsPage() {
  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Subscriptions</h1>
      <PlansTable />
      <SubscriptionsTable />
    </div>
  );
}
```

**Step 7: Commit**

```bash
git add .
git commit -m "feat: add subscriptions page with plans CRUD and active subscriptions table"
```

---

### Task 11: Attendance Page

**Files:**
- Create: `src/lib/api/attendance.ts`
- Create: `src/app/(dashboard)/attendance/page.tsx`

**Step 1: Create attendance API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/attendance.ts`:
```typescript
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { Attendance, LeaderboardEntry } from '@/types';

export function useTodayAttendance() {
  return useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: async () => {
      const { data } = await apiClient.get<Attendance[]>('/attendance/today');
      return data;
    },
  });
}

export function useLeaderboard() {
  return useQuery({
    queryKey: ['attendance', 'leaderboard'],
    queryFn: async () => {
      const { data } = await apiClient.get<LeaderboardEntry[]>('/attendance/leaderboard');
      return data;
    },
  });
}
```

**Step 2: Create attendance page**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/attendance/page.tsx`:
```tsx
'use client';

import { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useTodayAttendance, useLeaderboard } from '@/lib/api/attendance';
import { Skeleton } from '@/components/ui/skeleton';
import type { Attendance, LeaderboardEntry } from '@/types';

const attendanceColumns: ColumnDef<Attendance>[] = [
  {
    accessorKey: 'member',
    header: 'Member',
    cell: ({ row }) => {
      const m = row.original.member;
      return m ? `${m.firstName} ${m.lastName}` : row.original.memberId;
    },
  },
  {
    accessorKey: 'member.email',
    header: 'Email',
    cell: ({ row }) => row.original.member?.email ?? '—',
  },
  {
    accessorKey: 'checkInTime',
    header: 'Check-in Time',
    cell: ({ row }) => new Date(row.original.checkInTime).toLocaleTimeString(),
  },
];

const leaderboardColumns: ColumnDef<LeaderboardEntry>[] = [
  {
    id: 'rank',
    header: '#',
    cell: ({ row }) => row.index + 1,
  },
  { accessorKey: 'memberName', header: 'Member' },
  {
    accessorKey: 'currentStreak',
    header: 'Current Streak',
    cell: ({ row }) => (
      <Badge variant="default">{row.original.currentStreak} days</Badge>
    ),
  },
  {
    accessorKey: 'longestStreak',
    header: 'Longest Streak',
    cell: ({ row }) => `${row.original.longestStreak} days`,
  },
];

export default function AttendancePage() {
  const { data: todayData, isLoading: todayLoading } = useTodayAttendance();
  const { data: leaderboardData, isLoading: leaderboardLoading } = useLeaderboard();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Attendance</h1>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">
          Today&apos;s Check-ins ({todayData?.length ?? 0})
        </h2>
        {todayLoading ? (
          <Skeleton className="h-48" />
        ) : (
          <DataTable columns={attendanceColumns} data={todayData ?? []} searchKey="member" searchPlaceholder="Search by member..." />
        )}
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Streak Leaderboard</h2>
        {leaderboardLoading ? (
          <Skeleton className="h-48" />
        ) : (
          <DataTable columns={leaderboardColumns} data={leaderboardData ?? []} />
        )}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add attendance page with today's check-ins and streak leaderboard"
```

---

### Task 12: Trainers Page

**Files:**
- Create: `src/lib/api/trainers.ts`
- Create: `src/app/(dashboard)/trainers/page.tsx`
- Create: `src/app/(dashboard)/trainers/create-trainer-dialog.tsx`
- Create: `src/app/(dashboard)/trainers/schedule-dialog.tsx`
- Create: `src/app/(dashboard)/trainers/assign-dialog.tsx`

**Step 1: Create trainers API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/trainers.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type {
  TrainerProfile,
  TrainerSchedule,
  CreateTrainerProfileRequest,
  CreateScheduleRequest,
  AssignMemberRequest,
  PaginatedResponse,
} from '@/types';

export function useTrainers(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['trainers', page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<TrainerProfile>>('/trainers', {
        params: { page, limit },
      });
      return data;
    },
  });
}

export function useTrainer(id: string) {
  return useQuery({
    queryKey: ['trainers', id],
    queryFn: async () => {
      const { data } = await apiClient.get<TrainerProfile>(`/trainers/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useTrainerSchedules(trainerId: string) {
  return useQuery({
    queryKey: ['trainers', trainerId, 'schedules'],
    queryFn: async () => {
      const { data } = await apiClient.get<TrainerSchedule[]>(`/trainers/${trainerId}/schedules`);
      return data;
    },
    enabled: !!trainerId,
  });
}

export function useCreateTrainer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateTrainerProfileRequest) => {
      const { data } = await apiClient.post<TrainerProfile>('/trainers', dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainers'] }),
  });
}

export function useAddSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ trainerId, dto }: { trainerId: string; dto: CreateScheduleRequest }) => {
      const { data } = await apiClient.post<TrainerSchedule>(`/trainers/${trainerId}/schedules`, dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainers'] }),
  });
}

export function useAssignMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: AssignMemberRequest) => {
      const { data } = await apiClient.post('/trainers/assign', dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trainers'] }),
  });
}
```

**Step 2: Create trainer dialogs and page**

Create the three dialog components (`create-trainer-dialog.tsx`, `schedule-dialog.tsx`, `assign-dialog.tsx`) following the same pattern as the member edit dialog and plan dialog above — each with a form inside a `Dialog` component, using the corresponding mutation hook, with toast feedback.

Create `~/Documents/js/gym-admin/src/app/(dashboard)/trainers/page.tsx` — display a data table of trainers with name, specialization, and action buttons to add schedules and assign members. Include buttons to create new trainer profiles.

The implementation follows the same patterns established in Tasks 9-10 (data table + dialog pattern).

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add trainers page with roster, schedules, and member assignment"
```

---

### Task 13: Legal Docs Page

**Files:**
- Create: `src/lib/api/legal.ts`
- Create: `src/app/(dashboard)/legal/page.tsx`
- Create: `src/app/(dashboard)/legal/create-document-dialog.tsx`

**Step 1: Create legal API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/legal.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { LegalDocument, DocumentSignature, CreateDocumentRequest, PaginatedResponse } from '@/types';

export function useLegalDocuments(page = 1, limit = 20) {
  return useQuery({
    queryKey: ['legal', page, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PaginatedResponse<LegalDocument>>('/legal', {
        params: { page, limit },
      });
      return data;
    },
  });
}

export function useDocumentSignatures(documentId: string) {
  return useQuery({
    queryKey: ['legal', documentId, 'signatures'],
    queryFn: async () => {
      const { data } = await apiClient.get<DocumentSignature[]>(`/legal/${documentId}/signatures`);
      return data;
    },
    enabled: !!documentId,
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateDocumentRequest) => {
      const { data } = await apiClient.post<LegalDocument>('/legal', dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legal'] }),
  });
}
```

**Step 2: Create document dialog and page**

Follow the same dialog + data table pattern. The legal page shows a table of documents with title, version, isRequired badge, and created date. Action menu to view signing status (opens a sub-table or dialog with member signatures). Button to create new documents.

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add legal documents page with document management and signing status"
```

---

### Task 14: QR Code Page

**Files:**
- Create: `src/lib/api/qr.ts`
- Create: `src/app/(dashboard)/qr/page.tsx`

**Step 1: Create QR API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/qr.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { GymQrCode } from '@/types';

export function useActiveQr() {
  return useQuery({
    queryKey: ['qr', 'active'],
    queryFn: async () => {
      const { data } = await apiClient.get<GymQrCode>('/qr/active');
      return data;
    },
  });
}

export function useGenerateQr() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post<GymQrCode>('/qr/generate');
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['qr'] }),
  });
}
```

**Step 2: Create QR page**

Create `~/Documents/js/gym-admin/src/app/(dashboard)/qr/page.tsx`:
```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw } from 'lucide-react';
import { useActiveQr, useGenerateQr } from '@/lib/api/qr';
import { toast } from 'sonner';

export default function QrPage() {
  const { data: qr, isLoading } = useActiveQr();
  const generateQr = useGenerateQr();

  const handleGenerate = async () => {
    if (!confirm('Generate a new QR code? The current one will be deactivated.')) return;
    try {
      await generateQr.mutateAsync();
      toast.success('New QR code generated');
    } catch {
      toast.error('Failed to generate QR code');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">QR Code</h1>

      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Entrance QR Code</CardTitle>
          <CardDescription>
            Members scan this code at the gym entrance to check in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-64 w-64 mx-auto" />
          ) : qr ? (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 text-center">
                <p className="font-mono text-lg break-all">{qr.code}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  Generated: {new Date(qr.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-center">No active QR code.</p>
          )}

          <Button onClick={handleGenerate} disabled={generateQr.isPending} className="w-full">
            <RefreshCw className="mr-2 h-4 w-4" />
            {generateQr.isPending ? 'Generating...' : 'Generate New QR Code'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add .
git commit -m "feat: add QR code page with generate and view active code"
```

---

### Task 15: Payroll Page (SuperAdmin Only)

**Files:**
- Create: `src/lib/api/salary.ts`
- Create: `src/app/(dashboard)/payroll/page.tsx`
- Create: `src/app/(dashboard)/payroll/create-salary-dialog.tsx`

**Step 1: Create salary API hooks**

Create `~/Documents/js/gym-admin/src/lib/api/salary.ts`:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api-client';
import type { StaffSalaryRecord, CreateSalaryRecordRequest } from '@/types';

export function useSalaryRecords(filters?: { month?: number; year?: number }) {
  return useQuery({
    queryKey: ['salary', filters],
    queryFn: async () => {
      const { data } = await apiClient.get<StaffSalaryRecord[]>('/salary', { params: filters });
      return data;
    },
  });
}

export function useCreateSalaryRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dto: CreateSalaryRecordRequest) => {
      const { data } = await apiClient.post<StaffSalaryRecord>('/salary', dto);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['salary'] }),
  });
}

export function useMarkAsPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.patch<StaffSalaryRecord>(`/salary/${id}/pay`);
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['salary'] }),
  });
}

export function useDeleteSalaryRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/salary/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['salary'] }),
  });
}
```

**Step 2: Create salary dialog and payroll page**

Follow the same pattern — data table with staff name, month/year, amount, status (PENDING/PAID), with actions to mark as paid and delete. Create salary dialog with staff selection (from users list), month, year, amount, notes. Add month/year filter dropdowns at the top.

**Step 3: Add role guard to payroll page**

The payroll page component should check `user.role === 'SUPER_ADMIN'` and redirect to `/` if not. The sidebar already hides the nav item, but this is defense-in-depth.

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add payroll page with salary records, create/pay/delete actions (SuperAdmin only)"
```

---

### Task 16: Settings Page (SuperAdmin Only)

**Files:**
- Create: `src/app/(dashboard)/settings/page.tsx`

**Step 1: Create settings page**

Create a simple settings page for SuperAdmin. For MVP, this shows the branding config values (read-only), the API URL, and a placeholder for future settings. The page checks role === 'SUPER_ADMIN'.

```tsx
'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { branding } from '@/config/branding';
import { useAuth } from '@/lib/auth-context';
import { redirect } from 'next/navigation';

export default function SettingsPage() {
  const { user } = useAuth();
  if (user?.role !== 'SUPER_ADMIN') redirect('/');

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Gym Branding</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><strong>Gym Name:</strong> {branding.gymName}</div>
          <div><strong>Tagline:</strong> {branding.tagline}</div>
          <div><strong>Currency:</strong> {branding.currency}</div>
          <div><strong>Support Email:</strong> {branding.supportEmail}</div>
          <p className="text-muted-foreground mt-4">
            To change branding, edit <code>src/config/branding.ts</code> and redeploy.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add .
git commit -m "feat: add settings page showing branding config (SuperAdmin only)"
```

---

### Task 17: Final Polish + README

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`
- Modify: Various files for final tweaks

**Step 1: Create README.md**

Create `~/Documents/js/gym-admin/README.md` with:
- Project name and description
- Tech stack
- Getting started (yarn install, .env.local setup, yarn dev)
- Available scripts
- Branding customization instructions
- Link to API repo

**Step 2: Create CLAUDE.md**

Create `~/Documents/js/gym-admin/CLAUDE.md` with project-specific instructions for Claude Code:
- Project description
- Commands (yarn dev, yarn build, yarn lint)
- Architecture (App Router, file structure)
- Key patterns (API hooks in src/lib/api/, data table + dialog pattern)
- Branding config location
- API dependency (gym-management on port 3000)

**Step 3: Verify full build**

```bash
cd ~/Documents/js/gym-admin
yarn build
```

Expected: Build succeeds with no errors.

**Step 4: Final commit**

```bash
git add .
git commit -m "docs: add README and CLAUDE.md with project setup and architecture guide"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Project scaffolding | Next.js + shadcn/ui + deps |
| 2 | Branding config + theme | `src/config/branding.ts`, theme provider |
| 3 | TypeScript types | `src/types/index.ts` |
| 4 | API client + auth context | `src/lib/api-client.ts`, `src/lib/auth-context.tsx` |
| 5 | Dashboard layout | Sidebar, header, route protection |
| 6 | Login page | `src/app/(auth)/login/page.tsx` |
| 7 | Dashboard home | Stats cards, recent activity |
| 8 | Reusable data table | `src/components/data-table.tsx` |
| 9 | Members page | Table, edit dialog, delete |
| 10 | Subscriptions page | Plans CRUD + subscriptions table |
| 11 | Attendance page | Today's check-ins + leaderboard |
| 12 | Trainers page | Roster, schedules, assignments |
| 13 | Legal docs page | Document management, signing status |
| 14 | QR code page | Generate/view QR code |
| 15 | Payroll page | Salary records (SuperAdmin) |
| 16 | Settings page | Branding info (SuperAdmin) |
| 17 | Final polish | README, CLAUDE.md, build verification |
