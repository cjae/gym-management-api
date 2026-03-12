# Gym Mobile App — MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Expo React Native mobile app for gym members covering auth, legal signing, QR check-in, streaks, subscriptions, profile, and notifications.

**Architecture:** Expo Router for file-based navigation with auth/app route groups. TanStack Query for server state, Zustand for auth tokens. Axios client with interceptors for JWT refresh and Basic Auth. Backend notification module added to existing NestJS API.

**Tech Stack:** Expo SDK 52+, Expo Router, NativeWind v4, TanStack Query, Zustand, Axios, expo-camera, expo-secure-store, expo-notifications, react-native-webview, react-native-signature-canvas

**Design Doc:** `docs/plans/2026-03-12-gym-mobile-design.md`

**Repo:** `~/Documents/js/gym-mobile` (separate from API repo at `~/Documents/js/gym-management`)

---

## Phase 1: Project Scaffolding

### Task 1: Create Expo Project

**Files:**
- Create: `~/Documents/js/gym-mobile/` (entire project)

**Step 1: Scaffold the project**

```bash
cd ~/Documents/js
npx create-expo-app@latest gym-mobile --template tabs
cd gym-mobile
```

**Step 2: Install core dependencies**

```bash
npx expo install expo-camera expo-secure-store expo-notifications expo-device expo-constants react-native-webview react-native-signature-canvas
npm install @tanstack/react-query zustand axios
npm install nativewind react-native-reanimated react-native-safe-area-context
npm install --save-dev tailwindcss@^3.4.17 prettier-plugin-tailwindcss@^0.5.11
npm install @expo/vector-icons
```

**Step 3: Initialize Tailwind**

```bash
npx tailwindcss init
```

**Step 4: Configure `tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: '#2563EB',    // blue-600
        secondary: '#1E40AF',  // blue-800
        accent: '#F59E0B',     // amber-500
        danger: '#EF4444',     // red-500
        success: '#22C55E',    // green-500
      },
    },
  },
  plugins: [],
};
```

**Step 5: Create `global.css`**

Create `~/Documents/js/gym-mobile/global.css`:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**Step 6: Configure `babel.config.js`**

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
  };
};
```

**Step 7: Configure `metro.config.js`**

```javascript
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
```

**Step 8: Add NativeWind types**

Create `~/Documents/js/gym-mobile/nativewind-env.d.ts`:

```typescript
/// <reference types="nativewind/types" />
```

**Step 9: Clean up template files**

Remove all template files from `app/` that were created by `create-expo-app`. We will create our own route structure.

**Step 10: Initialize git and commit**

```bash
git init
git add .
git commit -m "chore: scaffold Expo project with NativeWind, TanStack Query, Zustand"
```

---

### Task 2: API Client & Auth Store

**Files:**
- Create: `src/lib/constants.ts`
- Create: `src/api/client.ts`
- Create: `src/stores/auth.ts`

**Step 1: Create constants**

Create `~/Documents/js/gym-mobile/src/lib/constants.ts`:

```typescript
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1';
export const BASIC_AUTH_USER = process.env.EXPO_PUBLIC_BASIC_AUTH_USER ?? '';
export const BASIC_AUTH_PASSWORD = process.env.EXPO_PUBLIC_BASIC_AUTH_PASSWORD ?? '';
export const DAYS_REQUIRED_PER_WEEK = 4;
```

**Step 2: Create auth store**

Create `~/Documents/js/gym-mobile/src/stores/auth.ts`:

```typescript
import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  phone?: string;
  gender?: string;
  displayPicture?: string;
  mustChangePassword: boolean;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: User | null;
  isLoading: boolean;
  setTokens: (access: string, refresh: string) => Promise<void>;
  setUser: (user: User) => void;
  logout: () => Promise<void>;
  loadTokens: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  isLoading: true,

  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync('accessToken', access);
    await SecureStore.setItemAsync('refreshToken', refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  setUser: (user) => set({ user }),

  logout: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    set({ accessToken: null, refreshToken: null, user: null });
  },

  loadTokens: async () => {
    const accessToken = await SecureStore.getItemAsync('accessToken');
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    set({ accessToken, refreshToken, isLoading: false });
  },
}));
```

**Step 3: Create Axios client with interceptors**

Create `~/Documents/js/gym-mobile/src/api/client.ts`:

```typescript
import axios from 'axios';
import { API_BASE_URL, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } from '../lib/constants';
import { useAuthStore } from '../stores/auth';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor: attach JWT
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor: handle 401 with token refresh
let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((prom) => {
    if (token) prom.resolve(token);
    else prom.reject(error);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject,
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const { refreshToken, setTokens, logout } = useAuthStore.getState();
      if (!refreshToken) {
        await logout();
        return Promise.reject(error);
      }

      const basicAuth = btoa(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`);
      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        {},
        {
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'X-Refresh-Token': refreshToken,
          },
        },
      );

      const { accessToken, refreshToken: newRefresh } = response.data;
      await setTokens(accessToken, newRefresh);

      processQueue(null, accessToken);
      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await useAuthStore.getState().logout();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

// Helper for Basic Auth endpoints (login, register, forgot-password)
export const basicAuthApi = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Basic ${btoa(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`)}`,
  },
});

export default api;
```

**Step 4: Create `.env` file**

Create `~/Documents/js/gym-mobile/.env`:

```
EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1
EXPO_PUBLIC_BASIC_AUTH_USER=admin
EXPO_PUBLIC_BASIC_AUTH_PASSWORD=password
```

**Step 5: Commit**

```bash
git add src/ .env
git commit -m "feat: add API client with JWT refresh and Zustand auth store"
```

---

### Task 3: Root Layout & Providers

**Files:**
- Create: `app/_layout.tsx`
- Create: `src/hooks/useNotifications.ts`

**Step 1: Create notification hook**

Create `~/Documents/js/gym-mobile/src/hooks/useNotifications.ts`:

```typescript
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import api from '../api/client';
import { useAuthStore } from '../stores/auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return null;
  }

  const projectId =
    Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
  if (!projectId) return null;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  return token;
}

export function useNotificationSetup() {
  const { accessToken } = useAuthStore();
  const registeredRef = useRef(false);

  // Register push token when authenticated
  useEffect(() => {
    if (!accessToken || registeredRef.current) return;

    registerForPushNotificationsAsync().then(async (token) => {
      if (token) {
        try {
          await api.post('/push-tokens', {
            token,
            platform: Platform.OS,
          });
          registeredRef.current = true;
        } catch {
          // Silent fail — will retry next app open
        }
      }
    });
  }, [accessToken]);

  // Handle notification taps → deep link
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string') {
        router.push(url as any);
      }
    });

    return () => subscription.remove();
  }, []);
}
```

**Step 2: Create root layout**

Create `~/Documents/js/gym-mobile/app/_layout.tsx`:

```typescript
import '../global.css';
import { useEffect } from 'react';
import { Slot } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../src/stores/auth';
import { useNotificationSetup } from '../src/hooks/useNotifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function RootLayoutInner() {
  const { loadTokens, isLoading } = useAuthStore();
  useNotificationSetup();

  useEffect(() => {
    loadTokens();
  }, []);

  if (isLoading) return null; // Splash screen handles this

  return <Slot />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <RootLayoutInner />
    </QueryClientProvider>
  );
}
```

**Step 3: Commit**

```bash
git add app/ src/hooks/
git commit -m "feat: add root layout with providers and push notification setup"
```

---

## Phase 2: Auth Screens

### Task 4: Auth API Hooks

**Files:**
- Create: `src/api/auth.ts`

**Step 1: Create auth API hooks**

Create `~/Documents/js/gym-mobile/src/api/auth.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { basicAuthApi } from './client';
import { useAuthStore } from '../stores/auth';

interface LoginInput {
  email: string;
  password: string;
}

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
}

interface UpdateProfileInput {
  firstName?: string;
  lastName?: string;
  phone?: string;
  gender?: string;
  displayPicture?: string;
}

export function useLogin() {
  const { setTokens, setUser } = useAuthStore();

  return useMutation({
    mutationFn: async (input: LoginInput) => {
      const { data } = await basicAuthApi.post('/auth/login', input);
      return data;
    },
    onSuccess: async (data) => {
      await setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
    },
  });
}

export function useRegister() {
  const { setTokens, setUser } = useAuthStore();

  return useMutation({
    mutationFn: async (input: RegisterInput) => {
      const { data } = await basicAuthApi.post('/auth/register', input);
      return data;
    },
    onSuccess: async (data) => {
      await setTokens(data.accessToken, data.refreshToken);
      setUser(data.user);
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { data } = await basicAuthApi.post('/auth/forgot-password', { email });
      return data;
    },
  });
}

export function useMe() {
  const { accessToken, setUser } = useAuthStore();

  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await api.get('/auth/me');
      setUser(data);
      return data;
    },
    enabled: !!accessToken,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateProfileInput) => {
      const { data } = await api.patch('/auth/me', input);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (input: { currentPassword: string; newPassword: string }) => {
      const { data } = await api.patch('/auth/change-password', input);
      return data;
    },
  });
}

export function useLogout() {
  const { logout } = useAuthStore();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      try {
        await api.post('/auth/logout');
      } catch {
        // Logout even if API call fails
      }
    },
    onSettled: async () => {
      await logout();
      queryClient.clear();
    },
  });
}
```

**Step 2: Commit**

```bash
git add src/api/auth.ts
git commit -m "feat: add auth API hooks (login, register, forgot-password, me, logout)"
```

---

### Task 5: Auth Screens (Login, Register, Forgot Password)

**Files:**
- Create: `app/(auth)/_layout.tsx`
- Create: `app/(auth)/login.tsx`
- Create: `app/(auth)/register.tsx`
- Create: `app/(auth)/forgot-password.tsx`
- Create: `src/components/Input.tsx`
- Create: `src/components/Button.tsx`

**Step 1: Create shared Input component**

Create `~/Documents/js/gym-mobile/src/components/Input.tsx`:

```typescript
import { TextInput, Text, View, TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Input({ label, error, ...props }: InputProps) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-medium text-gray-700 mb-1">{label}</Text>
      <TextInput
        className={`border rounded-lg px-4 py-3 text-base ${
          error ? 'border-danger' : 'border-gray-300'
        } bg-white`}
        placeholderTextColor="#9CA3AF"
        {...props}
      />
      {error && <Text className="text-danger text-sm mt-1">{error}</Text>}
    </View>
  );
}
```

**Step 2: Create shared Button component**

Create `~/Documents/js/gym-mobile/src/components/Button.tsx`:

```typescript
import { TouchableOpacity, Text, ActivityIndicator } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  disabled?: boolean;
}

export function Button({
  title,
  onPress,
  loading = false,
  variant = 'primary',
  disabled = false,
}: ButtonProps) {
  const baseClasses = 'rounded-lg py-3.5 px-6 items-center justify-center';
  const variantClasses = {
    primary: 'bg-primary',
    secondary: 'bg-secondary',
    danger: 'bg-danger',
    outline: 'border border-primary bg-transparent',
  };
  const textClasses = {
    primary: 'text-white',
    secondary: 'text-white',
    danger: 'text-white',
    outline: 'text-primary',
  };

  return (
    <TouchableOpacity
      className={`${baseClasses} ${variantClasses[variant]} ${disabled || loading ? 'opacity-50' : ''}`}
      onPress={onPress}
      disabled={disabled || loading}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? '#2563EB' : '#fff'} />
      ) : (
        <Text className={`text-base font-semibold ${textClasses[variant]}`}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}
```

**Step 3: Create auth layout**

Create `~/Documents/js/gym-mobile/app/(auth)/_layout.tsx`:

```typescript
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }} />
  );
}
```

**Step 4: Create login screen**

Create `~/Documents/js/gym-mobile/app/(auth)/login.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link, router } from 'expo-router';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { useLogin } from '../../src/api/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();

  const handleLogin = () => {
    login.mutate(
      { email: email.trim().toLowerCase(), password },
      {
        onSuccess: () => router.replace('/(app)/(tabs)'),
        onError: () => {}, // error shown via login.error
      },
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerClassName="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-center mb-2">Welcome Back</Text>
        <Text className="text-gray-500 text-center mb-8">Sign in to your account</Text>

        {login.error && (
          <Text className="text-danger text-center mb-4">
            Invalid email or password
          </Text>
        )}

        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input
          label="Password"
          placeholder="Enter your password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Button
          title="Sign In"
          onPress={handleLogin}
          loading={login.isPending}
          disabled={!email || !password}
        />

        <Link href="/(auth)/forgot-password" className="text-primary text-center mt-4">
          Forgot password?
        </Link>
        <Link href="/(auth)/register" className="text-primary text-center mt-2">
          Don't have an account? Sign up
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Step 5: Create register screen**

Create `~/Documents/js/gym-mobile/app/(auth)/register.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link, router } from 'expo-router';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { useRegister } from '../../src/api/auth';

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const register = useRegister();

  const handleRegister = () => {
    register.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
      },
      {
        onSuccess: () => router.replace('/(app)/(tabs)'),
      },
    );
  };

  const isValid = firstName && lastName && email && phone && password.length >= 8;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerClassName="justify-center px-6 py-12">
        <Text className="text-3xl font-bold text-center mb-2">Create Account</Text>
        <Text className="text-gray-500 text-center mb-8">Join the gym community</Text>

        {register.error && (
          <Text className="text-danger text-center mb-4">
            Registration failed. Please try again.
          </Text>
        )}

        <Input label="First Name" placeholder="John" value={firstName} onChangeText={setFirstName} />
        <Input label="Last Name" placeholder="Doe" value={lastName} onChangeText={setLastName} />
        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Input
          label="Phone"
          placeholder="+254 700 000 000"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
        />
        <Input
          label="Password"
          placeholder="Min 8 characters"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <Button
          title="Create Account"
          onPress={handleRegister}
          loading={register.isPending}
          disabled={!isValid}
        />

        <Link href="/(auth)/login" className="text-primary text-center mt-4">
          Already have an account? Sign in
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Step 6: Create forgot password screen**

Create `~/Documents/js/gym-mobile/app/(auth)/forgot-password.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { useForgotPassword } from '../../src/api/auth';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const forgotPassword = useForgotPassword();

  const handleSubmit = () => {
    forgotPassword.mutate(email.trim().toLowerCase(), {
      onSuccess: () => setSent(true),
    });
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView contentContainerClassName="flex-1 justify-center px-6">
        <Text className="text-3xl font-bold text-center mb-2">Reset Password</Text>
        <Text className="text-gray-500 text-center mb-8">
          {sent
            ? 'Check your email for a reset link'
            : "Enter your email and we'll send you a reset link"}
        </Text>

        {!sent && (
          <>
            <Input
              label="Email"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <Button
              title="Send Reset Link"
              onPress={handleSubmit}
              loading={forgotPassword.isPending}
              disabled={!email}
            />
          </>
        )}

        <Link href="/(auth)/login" className="text-primary text-center mt-4">
          Back to sign in
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

**Step 7: Verify screens render**

```bash
npx expo start
```

Navigate to login screen manually. Verify it renders without errors.

**Step 8: Commit**

```bash
git add app/ src/components/
git commit -m "feat: add auth screens (login, register, forgot-password) with shared components"
```

---

### Task 6: Auth Routing Guard

**Files:**
- Modify: `app/_layout.tsx`
- Create: `app/(app)/_layout.tsx`
- Create: `app/index.tsx`

**Step 1: Create root index that redirects based on auth**

Create `~/Documents/js/gym-mobile/app/index.tsx`:

```typescript
import { Redirect } from 'expo-router';
import { useAuthStore } from '../src/stores/auth';

export default function Index() {
  const { accessToken } = useAuthStore();

  if (accessToken) {
    return <Redirect href="/(app)/(tabs)" />;
  }

  return <Redirect href="/(auth)/login" />;
}
```

**Step 2: Create app layout (authenticated group)**

Create `~/Documents/js/gym-mobile/app/(app)/_layout.tsx`:

```typescript
import { Redirect, Stack } from 'expo-router';
import { useAuthStore } from '../../src/stores/auth';

export default function AppLayout() {
  const { accessToken } = useAuthStore();

  if (!accessToken) {
    return <Redirect href="/(auth)/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
```

**Step 3: Commit**

```bash
git add app/
git commit -m "feat: add auth routing guard with redirect logic"
```

---

## Phase 3: Legal Onboarding Gate

### Task 7: Legal API Hooks & Screens

**Files:**
- Create: `src/api/legal.ts`
- Create: `app/(app)/legal/index.tsx`
- Create: `app/(app)/legal/sign/[id].tsx`

**Step 1: Create legal API hooks**

Create `~/Documents/js/gym-mobile/src/api/legal.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface LegalDocument {
  id: string;
  title: string;
  content: string;
  version: number;
  isRequired: boolean;
}

export function useUnsignedDocs() {
  return useQuery({
    queryKey: ['legal', 'unsigned'],
    queryFn: async () => {
      const { data } = await api.get<LegalDocument[]>('/legal/unsigned');
      return data;
    },
  });
}

export function useSignDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, signatureData }: { documentId: string; signatureData: string }) => {
      const { data } = await api.post('/legal/sign', { documentId, signatureData });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal', 'unsigned'] });
    },
  });
}
```

**Step 2: Create legal docs list screen**

Create `~/Documents/js/gym-mobile/app/(app)/legal/index.tsx`:

```typescript
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useUnsignedDocs } from '../../../src/api/legal';

export default function LegalDocsScreen() {
  const { data: docs, isLoading } = useUnsignedDocs();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (!docs || docs.length === 0) {
    router.replace('/(app)/(tabs)');
    return null;
  }

  return (
    <View className="flex-1 bg-white px-6 pt-16">
      <Text className="text-2xl font-bold mb-2">Required Documents</Text>
      <Text className="text-gray-500 mb-6">
        Please review and sign the following documents to continue
      </Text>

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            className="border border-gray-200 rounded-lg p-4 mb-3"
            onPress={() => router.push(`/(app)/legal/sign/${item.id}`)}
          >
            <Text className="text-lg font-semibold">{item.title}</Text>
            <Text className="text-gray-500 text-sm mt-1">Tap to review and sign</Text>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

**Step 3: Create sign document screen**

Create `~/Documents/js/gym-mobile/app/(app)/legal/sign/[id].tsx`:

```typescript
import { useRef } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import SignatureScreen, { SignatureViewRef } from 'react-native-signature-canvas';
import { useQuery } from '@tanstack/react-query';
import api from '../../../../src/api/client';
import { useSignDocument } from '../../../../src/api/legal';
import { Button } from '../../../../src/components/Button';

export default function SignDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const signatureRef = useRef<SignatureViewRef>(null);
  const signDoc = useSignDocument();

  const { data: doc, isLoading } = useQuery({
    queryKey: ['legal', id],
    queryFn: async () => {
      const { data } = await api.get(`/legal`);
      // Find the specific doc from the list
      return data.data?.find((d: any) => d.id === id) ?? data.find?.((d: any) => d.id === id);
    },
  });

  const handleSign = (signature: string) => {
    // signature is a base64 data URL from the canvas
    const signatureData = signature.replace('data:image/png;base64,', '');

    signDoc.mutate(
      { documentId: id!, signatureData },
      {
        onSuccess: () => {
          Alert.alert('Signed', 'Document signed successfully', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        },
        onError: () => {
          Alert.alert('Error', 'Failed to sign document. Please try again.');
        },
      },
    );
  };

  if (isLoading) return null;

  return (
    <View className="flex-1 bg-white">
      <ScrollView className="flex-1 px-6 pt-16">
        <Text className="text-2xl font-bold mb-4">{doc?.title ?? 'Document'}</Text>
        <Text className="text-base text-gray-700 leading-6 mb-6">{doc?.content}</Text>
        <Text className="text-sm font-medium text-gray-700 mb-2">Your Signature</Text>
      </ScrollView>

      <View className="h-48 mx-6 border border-gray-300 rounded-lg overflow-hidden mb-4">
        <SignatureScreen
          ref={signatureRef}
          onOK={handleSign}
          webStyle={`.m-signature-pad--footer { display: none; }`}
        />
      </View>

      <View className="px-6 pb-8 gap-3">
        <Button
          title="Sign Document"
          onPress={() => signatureRef.current?.readSignature()}
          loading={signDoc.isPending}
        />
        <Button
          title="Clear Signature"
          variant="outline"
          onPress={() => signatureRef.current?.clearSignature()}
        />
      </View>
    </View>
  );
}
```

**Step 4: Commit**

```bash
git add src/api/legal.ts app/(app)/legal/
git commit -m "feat: add legal document onboarding gate with signature capture"
```

---

## Phase 4: Main App Tabs

### Task 8: Tab Navigator & Home Screen

**Files:**
- Create: `app/(app)/(tabs)/_layout.tsx`
- Create: `app/(app)/(tabs)/index.tsx`
- Create: `src/api/attendance.ts`
- Create: `src/api/subscriptions.ts`

**Step 1: Create attendance API hooks**

Create `~/Documents/js/gym-mobile/src/api/attendance.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface Streak {
  id: string;
  memberId: string;
  weeklyStreak: number;
  longestStreak: number;
  daysThisWeek: number;
  weekStart: string;
  lastCheckInDate?: string;
}

interface CheckInResponse {
  alreadyCheckedIn: boolean;
  message: string;
  weeklyStreak?: number;
  longestStreak?: number;
  daysThisWeek?: number;
  daysRequired?: number;
}

interface AttendanceRecord {
  id: string;
  memberId: string;
  checkInDate: string;
  checkInTime: string;
}

export function useStreak() {
  return useQuery<Streak>({
    queryKey: ['streak'],
    queryFn: async () => {
      const { data } = await api.get('/attendance/streak');
      return data;
    },
  });
}

export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation<CheckInResponse, Error, string>({
    mutationFn: async (qrCode: string) => {
      const { data } = await api.post('/attendance/check-in', { qrCode });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streak'] });
      queryClient.invalidateQueries({ queryKey: ['attendance-history'] });
    },
  });
}

export function useAttendanceHistory() {
  return useQuery<AttendanceRecord[]>({
    queryKey: ['attendance-history'],
    queryFn: async () => {
      const { data } = await api.get('/attendance/history');
      return data;
    },
  });
}
```

**Step 2: Create subscriptions API hooks**

Create `~/Documents/js/gym-mobile/src/api/subscriptions.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  billingInterval: string;
  description?: string;
  maxMembers: number;
  maxFreezeDays: number;
  isActive: boolean;
}

interface Subscription {
  id: string;
  primaryMemberId: string;
  planId: string;
  plan: SubscriptionPlan;
  startDate: string;
  endDate: string;
  status: 'PENDING' | 'ACTIVE' | 'FROZEN' | 'EXPIRED' | 'CANCELLED';
  paymentMethod: string;
  freezeStartDate?: string;
  freezeEndDate?: string;
  frozenDaysUsed: number;
}

export function useMySubscriptions() {
  return useQuery<Subscription[]>({
    queryKey: ['my-subscriptions'],
    queryFn: async () => {
      const { data } = await api.get('/subscriptions/my');
      return data;
    },
  });
}

export function useSubscriptionPlans() {
  return useQuery<SubscriptionPlan[]>({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data } = await api.get('/subscription-plans');
      return data;
    },
  });
}

export function useCreateSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (planId: string) => {
      const { data } = await api.post('/subscriptions', { planId });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
    },
  });
}

export function useFreezeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, days }: { id: string; days: number }) => {
      const { data } = await api.patch(`/subscriptions/${id}/freeze`, { days });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
    },
  });
}

export function useUnfreezeSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/subscriptions/${id}/unfreeze`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.patch(`/subscriptions/${id}/cancel`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
    },
  });
}
```

**Step 3: Create tab layout**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/_layout.tsx`:

```typescript
import { Tabs } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#9CA3AF',
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <MaterialIcons name="home" size={28} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Check In',
          tabBarIcon: ({ color }) => <MaterialIcons name="qr-code-scanner" size={28} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <MaterialIcons name="person" size={28} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

**Step 4: Create home screen**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/index.tsx`:

```typescript
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuthStore } from '../../../src/stores/auth';
import { useStreak } from '../../../src/api/attendance';
import { useMySubscriptions } from '../../../src/api/subscriptions';
import { useUnsignedDocs } from '../../../src/api/legal';
import { DAYS_REQUIRED_PER_WEEK } from '../../../src/lib/constants';
import { useState } from 'react';

export default function HomeScreen() {
  const { user } = useAuthStore();
  const { data: streak, refetch: refetchStreak } = useStreak();
  const { data: subscriptions, refetch: refetchSubs } = useMySubscriptions();
  const { data: unsignedDocs } = useUnsignedDocs();
  const [refreshing, setRefreshing] = useState(false);

  // Redirect to legal if unsigned docs exist
  if (unsignedDocs && unsignedDocs.length > 0) {
    router.replace('/(app)/legal');
    return null;
  }

  const activeSub = subscriptions?.find((s) => s.status === 'ACTIVE');
  const daysThisWeek = streak?.daysThisWeek ?? 0;
  const progress = Math.min(daysThisWeek / DAYS_REQUIRED_PER_WEEK, 1);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchStreak(), refetchSubs()]);
    setRefreshing(false);
  };

  return (
    <ScrollView
      className="flex-1 bg-gray-50"
      contentContainerClassName="px-6 pt-16 pb-8"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text className="text-2xl font-bold mb-6">
        Hey, {user?.firstName ?? 'Member'}
      </Text>

      {/* Streak Card */}
      <View className="bg-white rounded-2xl p-6 mb-4 shadow-sm">
        <Text className="text-sm text-gray-500 mb-1">Weekly Streak</Text>
        <Text className="text-4xl font-bold text-primary">
          {streak?.weeklyStreak ?? 0} <Text className="text-lg text-gray-400">weeks</Text>
        </Text>

        <View className="mt-4">
          <View className="flex-row justify-between mb-1">
            <Text className="text-sm text-gray-500">This week</Text>
            <Text className="text-sm font-medium">
              {daysThisWeek}/{DAYS_REQUIRED_PER_WEEK} days
            </Text>
          </View>
          <View className="h-3 bg-gray-200 rounded-full overflow-hidden">
            <View
              className={`h-full rounded-full ${progress >= 1 ? 'bg-success' : 'bg-primary'}`}
              style={{ width: `${progress * 100}%` }}
            />
          </View>
        </View>

        <Text className="text-xs text-gray-400 mt-2">
          Longest streak: {streak?.longestStreak ?? 0} weeks
        </Text>
      </View>

      {/* Subscription Status */}
      <View className="bg-white rounded-2xl p-6 mb-4 shadow-sm">
        <Text className="text-sm text-gray-500 mb-1">Subscription</Text>
        {activeSub ? (
          <>
            <Text className="text-lg font-semibold">{activeSub.plan.name}</Text>
            <Text className="text-sm text-gray-500">
              Expires {new Date(activeSub.endDate).toLocaleDateString()}
            </Text>
            <TouchableOpacity
              className="mt-3"
              onPress={() => router.push('/(app)/subscription/my')}
            >
              <Text className="text-primary font-medium">Manage</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text className="text-lg font-semibold text-gray-400">No active plan</Text>
            <TouchableOpacity
              className="mt-3"
              onPress={() => router.push('/(app)/subscription/plans')}
            >
              <Text className="text-primary font-medium">Browse Plans</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Quick Actions */}
      <View className="flex-row gap-3">
        <TouchableOpacity
          className="flex-1 bg-primary rounded-2xl p-4 items-center"
          onPress={() => router.push('/(app)/(tabs)/scan')}
        >
          <MaterialIcons name="qr-code-scanner" size={32} color="white" />
          <Text className="text-white font-medium mt-2">Scan QR</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-white rounded-2xl p-4 items-center shadow-sm"
          onPress={() => router.push('/(app)/attendance/history')}
        >
          <MaterialIcons name="calendar-today" size={32} color="#2563EB" />
          <Text className="text-gray-700 font-medium mt-2">History</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-white rounded-2xl p-4 items-center shadow-sm"
          onPress={() => router.push('/(app)/notifications')}
        >
          <MaterialIcons name="notifications" size={32} color="#2563EB" />
          <Text className="text-gray-700 font-medium mt-2">Alerts</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
```

**Step 5: Commit**

```bash
git add app/ src/api/
git commit -m "feat: add tab navigator, home screen with streak card and subscription status"
```

---

### Task 9: QR Scanner Screen

**Files:**
- Create: `app/(app)/(tabs)/scan.tsx`

**Step 1: Create QR scanner screen**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/scan.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCheckIn } from '../../../src/api/attendance';
import { Button } from '../../../src/components/Button';
import { DAYS_REQUIRED_PER_WEEK } from '../../../src/lib/constants';

type ScanState = 'scanning' | 'success' | 'already' | 'error';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanState, setScanState] = useState<ScanState>('scanning');
  const [resultMessage, setResultMessage] = useState('');
  const [streakInfo, setStreakInfo] = useState<{ weeklyStreak: number; daysThisWeek: number } | null>(null);
  const checkIn = useCheckIn();

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanState !== 'scanning') return;

    setScanState('success'); // Prevent double-scan

    checkIn.mutate(data, {
      onSuccess: (result) => {
        if (result.alreadyCheckedIn) {
          setScanState('already');
          setResultMessage("You're already checked in today!");
        } else {
          setScanState('success');
          setResultMessage('Check-in successful!');
        }
        if (result.weeklyStreak !== undefined) {
          setStreakInfo({
            weeklyStreak: result.weeklyStreak,
            daysThisWeek: result.daysThisWeek ?? 0,
          });
        }
      },
      onError: (error: any) => {
        setScanState('error');
        const msg = error?.response?.data?.message ?? 'Check-in failed';
        setResultMessage(msg);
      },
    });
  };

  const resetScanner = () => {
    setScanState('scanning');
    setResultMessage('');
    setStreakInfo(null);
  };

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <MaterialIcons name="camera-alt" size={64} color="#9CA3AF" />
        <Text className="text-lg font-semibold mt-4 mb-2">Camera Access Needed</Text>
        <Text className="text-gray-500 text-center mb-6">
          We need camera access to scan the gym QR code for check-in
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} />
      </View>
    );
  }

  if (scanState !== 'scanning') {
    const icon = scanState === 'success' ? 'check-circle' : scanState === 'already' ? 'info' : 'error';
    const iconColor = scanState === 'error' ? '#EF4444' : '#22C55E';

    return (
      <View className="flex-1 bg-white items-center justify-center px-6">
        <MaterialIcons name={icon} size={80} color={iconColor} />
        <Text className="text-xl font-bold mt-4 mb-2">{resultMessage}</Text>

        {streakInfo && (
          <View className="bg-gray-50 rounded-xl p-4 mt-4 w-full items-center">
            <Text className="text-3xl font-bold text-primary">
              {streakInfo.weeklyStreak} <Text className="text-base text-gray-400">week streak</Text>
            </Text>
            <Text className="text-sm text-gray-500 mt-1">
              {streakInfo.daysThisWeek}/{DAYS_REQUIRED_PER_WEEK} days this week
            </Text>
          </View>
        )}

        <View className="mt-8 w-full">
          <Button title="Scan Again" onPress={resetScanner} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleBarCodeScanned}
      />
      <View className="flex-1 items-center justify-center">
        <View className="w-64 h-64 border-2 border-white rounded-3xl opacity-50" />
        <Text className="text-white text-lg mt-4 font-medium">Scan gym QR code</Text>
      </View>
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add app/(app)/(tabs)/scan.tsx
git commit -m "feat: add QR scanner screen with check-in flow and streak display"
```

---

### Task 10: Profile Screen

**Files:**
- Create: `app/(app)/(tabs)/profile.tsx`

**Step 1: Create profile screen**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/profile.tsx`:

```typescript
import { useState } from 'react';
import { View, Text, ScrollView, Alert, Image, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuthStore } from '../../../src/stores/auth';
import { useMe, useUpdateProfile, useChangePassword, useLogout } from '../../../src/api/auth';
import { Input } from '../../../src/components/Input';
import { Button } from '../../../src/components/Button';
import api from '../../../src/api/client';

export default function ProfileScreen() {
  const { user } = useAuthStore();
  const { refetch } = useMe();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const logout = useLogout();

  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleUpdateProfile = () => {
    updateProfile.mutate(
      { firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() },
      {
        onSuccess: () => {
          refetch();
          Alert.alert('Updated', 'Profile updated successfully');
        },
        onError: () => Alert.alert('Error', 'Failed to update profile'),
      },
    );
  };

  const handleChangePassword = () => {
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          Alert.alert('Updated', 'Password changed successfully');
          setShowPasswordForm(false);
          setCurrentPassword('');
          setNewPassword('');
        },
        onError: () => Alert.alert('Error', 'Failed to change password. Check your current password.'),
      },
    );
  };

  const handleUploadAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) return;

    const asset = result.assets[0];
    const formData = new FormData();
    formData.append('file', {
      uri: asset.uri,
      type: 'image/jpeg',
      name: 'avatar.jpg',
    } as any);

    try {
      const { data } = await api.post('/uploads/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await updateProfile.mutateAsync({ displayPicture: data.url });
      refetch();
    } catch {
      Alert.alert('Error', 'Failed to upload image');
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: () => logout.mutate() },
    ]);
  };

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="px-6 pt-16 pb-8">
      {/* Avatar */}
      <View className="items-center mb-6">
        <TouchableOpacity onPress={handleUploadAvatar}>
          {user?.displayPicture ? (
            <Image
              source={{ uri: user.displayPicture }}
              className="w-24 h-24 rounded-full"
            />
          ) : (
            <View className="w-24 h-24 rounded-full bg-gray-200 items-center justify-center">
              <MaterialIcons name="person" size={48} color="#9CA3AF" />
            </View>
          )}
          <View className="absolute bottom-0 right-0 bg-primary rounded-full p-1.5">
            <MaterialIcons name="camera-alt" size={16} color="white" />
          </View>
        </TouchableOpacity>
        <Text className="text-lg font-semibold mt-2">{user?.firstName} {user?.lastName}</Text>
        <Text className="text-gray-500">{user?.email}</Text>
      </View>

      {/* Edit Profile */}
      <View className="bg-white rounded-2xl p-6 mb-4">
        <Text className="text-lg font-semibold mb-4">Edit Profile</Text>
        <Input label="First Name" value={firstName} onChangeText={setFirstName} />
        <Input label="Last Name" value={lastName} onChangeText={setLastName} />
        <Input label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Button
          title="Save Changes"
          onPress={handleUpdateProfile}
          loading={updateProfile.isPending}
        />
      </View>

      {/* Change Password */}
      <View className="bg-white rounded-2xl p-6 mb-4">
        {!showPasswordForm ? (
          <Button
            title="Change Password"
            variant="outline"
            onPress={() => setShowPasswordForm(true)}
          />
        ) : (
          <>
            <Text className="text-lg font-semibold mb-4">Change Password</Text>
            <Input
              label="Current Password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
            />
            <Input
              label="New Password"
              placeholder="Min 8 characters"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
            />
            <Button
              title="Update Password"
              onPress={handleChangePassword}
              loading={changePassword.isPending}
              disabled={!currentPassword || newPassword.length < 8}
            />
          </>
        )}
      </View>

      {/* Logout */}
      <Button
        title="Logout"
        variant="danger"
        onPress={handleLogout}
        loading={logout.isPending}
      />
    </ScrollView>
  );
}
```

**Step 2: Install image picker**

```bash
npx expo install expo-image-picker
```

**Step 3: Commit**

```bash
git add app/(app)/(tabs)/profile.tsx
git commit -m "feat: add profile screen with edit, avatar upload, password change, logout"
```

---

## Phase 5: Subscriptions & Payments

### Task 11: Subscription Screens

**Files:**
- Create: `src/api/payments.ts`
- Create: `app/(app)/subscription/plans.tsx`
- Create: `app/(app)/subscription/my.tsx`
- Create: `app/(app)/subscription/payment.tsx`

**Step 1: Create payments API hooks**

Create `~/Documents/js/gym-mobile/src/api/payments.ts`:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import api from './client';

interface PaymentInitResponse {
  authorizationUrl: string;
  reference: string;
}

interface Payment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  createdAt: string;
}

export function useInitializePayment() {
  return useMutation<PaymentInitResponse, Error, string>({
    mutationFn: async (subscriptionId: string) => {
      const { data } = await api.post(`/payments/initialize/${subscriptionId}`);
      return data;
    },
  });
}

export function usePaymentHistory() {
  return useQuery({
    queryKey: ['payment-history'],
    queryFn: async () => {
      const { data } = await api.get<{ data: Payment[]; total: number }>('/payments/history');
      return data;
    },
  });
}
```

**Step 2: Create plans screen**

Create `~/Documents/js/gym-mobile/app/(app)/subscription/plans.tsx`:

```typescript
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useSubscriptionPlans, useCreateSubscription } from '../../../src/api/subscriptions';
import { useInitializePayment } from '../../../src/api/payments';
import { Button } from '../../../src/components/Button';

export default function PlansScreen() {
  const { data: plans, isLoading } = useSubscriptionPlans();
  const createSub = useCreateSubscription();
  const initPayment = useInitializePayment();

  const handleSelectPlan = async (planId: string) => {
    createSub.mutate(planId, {
      onSuccess: (subscription) => {
        initPayment.mutate(subscription.id, {
          onSuccess: (payment) => {
            router.push({
              pathname: '/(app)/subscription/payment',
              params: { url: payment.authorizationUrl },
            });
          },
        });
      },
    });
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  const formatInterval = (interval: string) => {
    return interval.charAt(0) + interval.slice(1).toLowerCase();
  };

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-16">
      <Text className="text-2xl font-bold mb-6">Choose a Plan</Text>

      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View className="bg-white rounded-2xl p-6 mb-4 shadow-sm">
            <Text className="text-xl font-bold">{item.name}</Text>
            <Text className="text-3xl font-bold text-primary mt-2">
              KES {item.price.toLocaleString()}
              <Text className="text-sm text-gray-400 font-normal">
                /{formatInterval(item.billingInterval)}
              </Text>
            </Text>
            {item.description && (
              <Text className="text-gray-500 mt-2">{item.description}</Text>
            )}
            <View className="mt-4">
              <Text className="text-sm text-gray-500">
                {item.maxMembers > 1 ? `Up to ${item.maxMembers} members` : 'Solo plan'}
              </Text>
              {item.maxFreezeDays > 0 && (
                <Text className="text-sm text-gray-500">
                  Up to {item.maxFreezeDays} freeze days per cycle
                </Text>
              )}
            </View>
            <View className="mt-4">
              <Button
                title="Subscribe"
                onPress={() => handleSelectPlan(item.id)}
                loading={createSub.isPending || initPayment.isPending}
              />
            </View>
          </View>
        )}
      />
    </View>
  );
}
```

**Step 3: Create my subscriptions screen**

Create `~/Documents/js/gym-mobile/app/(app)/subscription/my.tsx`:

```typescript
import { View, Text, FlatList, ActivityIndicator, Alert } from 'react-native';
import {
  useMySubscriptions,
  useFreezeSubscription,
  useUnfreezeSubscription,
  useCancelSubscription,
} from '../../../src/api/subscriptions';
import { Button } from '../../../src/components/Button';
import { useState } from 'react';
import { Input } from '../../../src/components/Input';

export default function MySubscriptionsScreen() {
  const { data: subscriptions, isLoading } = useMySubscriptions();
  const freezeSub = useFreezeSubscription();
  const unfreezeSub = useUnfreezeSubscription();
  const cancelSub = useCancelSubscription();
  const [freezeDays, setFreezeDays] = useState('');
  const [freezingId, setFreezingId] = useState<string | null>(null);

  const handleFreeze = (id: string) => {
    const days = parseInt(freezeDays, 10);
    if (!days || days < 1 || days > 30) {
      Alert.alert('Invalid', 'Enter 1-30 days');
      return;
    }
    freezeSub.mutate(
      { id, days },
      {
        onSuccess: () => {
          setFreezingId(null);
          setFreezeDays('');
          Alert.alert('Frozen', 'Subscription frozen successfully');
        },
        onError: (err: any) => Alert.alert('Error', err?.response?.data?.message ?? 'Failed to freeze'),
      },
    );
  };

  const handleCancel = (id: string) => {
    Alert.alert('Cancel Subscription', 'This cannot be undone. Are you sure?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, Cancel',
        style: 'destructive',
        onPress: () => cancelSub.mutate(id, {
          onSuccess: () => Alert.alert('Cancelled', 'Subscription cancelled'),
        }),
      },
    ]);
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  const statusColor: Record<string, string> = {
    ACTIVE: 'text-success',
    FROZEN: 'text-blue-500',
    PENDING: 'text-amber-500',
    EXPIRED: 'text-gray-400',
    CANCELLED: 'text-danger',
  };

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-16">
      <Text className="text-2xl font-bold mb-6">My Subscriptions</Text>

      <FlatList
        data={subscriptions}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <Text className="text-gray-500 text-center mt-8">No subscriptions yet</Text>
        }
        renderItem={({ item }) => (
          <View className="bg-white rounded-2xl p-6 mb-4 shadow-sm">
            <View className="flex-row justify-between items-center">
              <Text className="text-lg font-bold">{item.plan.name}</Text>
              <Text className={`font-semibold ${statusColor[item.status] ?? 'text-gray-500'}`}>
                {item.status}
              </Text>
            </View>

            <Text className="text-sm text-gray-500 mt-2">
              {new Date(item.startDate).toLocaleDateString()} — {new Date(item.endDate).toLocaleDateString()}
            </Text>

            {item.status === 'ACTIVE' && (
              <View className="mt-4 gap-2">
                {freezingId === item.id ? (
                  <View>
                    <Input
                      label="Days to freeze"
                      value={freezeDays}
                      onChangeText={setFreezeDays}
                      keyboardType="number-pad"
                      placeholder="1-30"
                    />
                    <View className="flex-row gap-2">
                      <View className="flex-1">
                        <Button title="Confirm" onPress={() => handleFreeze(item.id)} loading={freezeSub.isPending} />
                      </View>
                      <View className="flex-1">
                        <Button title="Cancel" variant="outline" onPress={() => setFreezingId(null)} />
                      </View>
                    </View>
                  </View>
                ) : (
                  <Button title="Freeze" variant="outline" onPress={() => setFreezingId(item.id)} />
                )}
                <Button title="Cancel Subscription" variant="danger" onPress={() => handleCancel(item.id)} />
              </View>
            )}

            {item.status === 'FROZEN' && (
              <View className="mt-4">
                <Text className="text-sm text-gray-500 mb-2">
                  Frozen until {new Date(item.freezeEndDate!).toLocaleDateString()}
                </Text>
                <Button
                  title="Unfreeze"
                  onPress={() => unfreezeSub.mutate(item.id)}
                  loading={unfreezeSub.isPending}
                />
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}
```

**Step 4: Create Paystack WebView payment screen**

Create `~/Documents/js/gym-mobile/app/(app)/subscription/payment.tsx`:

```typescript
import { View, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { WebView } from 'react-native-webview';
import { useQueryClient } from '@tanstack/react-query';

export default function PaymentScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const queryClient = useQueryClient();

  const handleNavigationChange = (navState: { url: string }) => {
    // Paystack redirects to callback URL on success/cancel
    if (navState.url.includes('callback') || navState.url.includes('trxref')) {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
      router.replace('/(app)/subscription/my');
    }
  };

  if (!url) {
    router.back();
    return null;
  }

  return (
    <View className="flex-1 pt-12">
      <WebView
        source={{ uri: url }}
        onNavigationStateChange={handleNavigationChange}
        startInLoadingState
        renderLoading={() => (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#2563EB" />
          </View>
        )}
      />
    </View>
  );
}
```

**Step 5: Commit**

```bash
git add src/api/payments.ts app/(app)/subscription/
git commit -m "feat: add subscription plans, management, and Paystack WebView payment"
```

---

## Phase 6: Attendance History

### Task 12: Attendance History Screen

**Files:**
- Create: `app/(app)/attendance/history.tsx`

**Step 1: Create attendance history screen**

Create `~/Documents/js/gym-mobile/app/(app)/attendance/history.tsx`:

```typescript
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAttendanceHistory } from '../../../src/api/attendance';

export default function AttendanceHistoryScreen() {
  const { data: records, isLoading } = useAttendanceHistory();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-KE', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-KE', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <View className="flex-1 bg-gray-50 px-6 pt-16">
      <Text className="text-2xl font-bold mb-6">Attendance History</Text>

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View className="items-center mt-12">
            <MaterialIcons name="event-busy" size={64} color="#D1D5DB" />
            <Text className="text-gray-400 mt-4">No check-ins yet</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View className="bg-white rounded-xl p-4 mb-2 flex-row items-center">
            <View className="bg-primary/10 rounded-full p-2 mr-4">
              <MaterialIcons name="check-circle" size={24} color="#2563EB" />
            </View>
            <View>
              <Text className="font-medium">{formatDate(item.checkInDate)}</Text>
              <Text className="text-sm text-gray-500">{formatTime(item.checkInTime)}</Text>
            </View>
          </View>
        )}
      />
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add app/(app)/attendance/
git commit -m "feat: add attendance history screen"
```

---

## Phase 7: Notifications

### Task 13: Notification API Hooks & Screen

**Files:**
- Create: `src/api/notifications.ts`
- Create: `app/(app)/notifications.tsx`

**Step 1: Create notification API hooks**

Create `~/Documents/js/gym-mobile/src/api/notifications.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: string;
  isRead: boolean;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

interface PaginatedNotifications {
  data: Notification[];
  total: number;
  page: number;
  limit: number;
}

export function useNotifications(page = 1) {
  return useQuery<PaginatedNotifications>({
    queryKey: ['notifications', page],
    queryFn: async () => {
      const { data } = await api.get('/notifications', { params: { page, limit: 20 } });
      return data;
    },
  });
}

export function useUnreadCount() {
  return useQuery<number>({
    queryKey: ['notifications', 'unread-count'],
    queryFn: async () => {
      const { data } = await api.get('/notifications', { params: { page: 1, limit: 1 } });
      // Count unread from total — backend should ideally support a count endpoint
      // For now, we use the unread items from the first page
      return data.data?.filter((n: Notification) => !n.isRead).length ?? 0;
    },
    refetchInterval: 30000, // Poll every 30s
  });
}

export function useMarkAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export function useMarkAllAsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.patch('/notifications/read-all');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
```

**Step 2: Create notifications screen**

Create `~/Documents/js/gym-mobile/app/(app)/notifications.tsx`:

```typescript
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useNotifications, useMarkAsRead, useMarkAllAsRead } from '../../src/api/notifications';

const typeIcons: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  SUBSCRIPTION_EXPIRING: 'schedule',
  PAYMENT_REMINDER: 'payment',
  STREAK_NUDGE: 'local-fire-department',
  STATUS_CHANGE: 'swap-horiz',
  GENERAL: 'campaign',
};

const typeRoutes: Record<string, string> = {
  SUBSCRIPTION_EXPIRING: '/(app)/subscription/my',
  PAYMENT_REMINDER: '/(app)/subscription/my',
  STATUS_CHANGE: '/(app)/subscription/my',
};

export default function NotificationsScreen() {
  const { data, isLoading } = useNotifications();
  const markRead = useMarkAsRead();
  const markAllRead = useMarkAllAsRead();

  const handleTap = (notification: { id: string; type: string; isRead: boolean }) => {
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }
    const route = typeRoutes[notification.type];
    if (route) {
      router.push(route as any);
    }
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50 pt-16">
      <View className="flex-row justify-between items-center px-6 mb-4">
        <Text className="text-2xl font-bold">Notifications</Text>
        <TouchableOpacity onPress={() => markAllRead.mutate()}>
          <Text className="text-primary font-medium">Mark all read</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={data?.data}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-6"
        ListEmptyComponent={
          <View className="items-center mt-12">
            <MaterialIcons name="notifications-none" size={64} color="#D1D5DB" />
            <Text className="text-gray-400 mt-4">No notifications</Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            className={`flex-row items-start p-4 mb-2 rounded-xl ${
              item.isRead ? 'bg-white' : 'bg-blue-50'
            }`}
            onPress={() => handleTap(item)}
          >
            <View className="bg-primary/10 rounded-full p-2 mr-3 mt-0.5">
              <MaterialIcons
                name={typeIcons[item.type] ?? 'notifications'}
                size={20}
                color="#2563EB"
              />
            </View>
            <View className="flex-1">
              <Text className="font-semibold">{item.title}</Text>
              <Text className="text-sm text-gray-600 mt-0.5">{item.body}</Text>
              <Text className="text-xs text-gray-400 mt-1">{formatTime(item.createdAt)}</Text>
            </View>
            {!item.isRead && (
              <View className="w-2.5 h-2.5 rounded-full bg-primary mt-2" />
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}
```

**Step 3: Commit**

```bash
git add src/api/notifications.ts app/(app)/notifications.tsx
git commit -m "feat: add notifications screen with mark read and deep linking"
```

---

## Phase 8: Backend — Notification Module

> **Note:** Tasks 14-16 are implemented in the API repo at `~/Documents/js/gym-management`.

### Task 14: Notification & PushToken Prisma Models

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add Notification and PushToken models**

Add the following to the end of `prisma/schema.prisma` (before the closing of the file):

```prisma
model Notification {
  id        String   @id @default(uuid())
  userId    String?
  title     String
  body      String
  type      String   // SUBSCRIPTION_EXPIRING, PAYMENT_REMINDER, STREAK_NUDGE, STATUS_CHANGE, GENERAL
  isRead    Boolean  @default(false)
  metadata  Json?
  createdAt DateTime @default(now())

  user User? @relation("UserNotifications", fields: [userId], references: [id])

  @@index([userId, createdAt])
}

model PushToken {
  id        String   @id @default(uuid())
  userId    String
  token     String   @unique
  platform  String   // ios, android
  createdAt DateTime @default(now())

  user User @relation("UserPushTokens", fields: [userId], references: [id])

  @@index([userId])
}
```

Also add the reverse relations on the `User` model:

```prisma
  notifications Notification[] @relation("UserNotifications")
  pushTokens    PushToken[]    @relation("UserPushTokens")
```

**Step 2: Generate migration**

```bash
npx prisma migrate dev --name add-notifications-and-push-tokens
```

**Step 3: Regenerate client**

```bash
npx prisma generate
```

**Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(notifications): add Notification and PushToken models"
```

---

### Task 15: Notifications NestJS Module

**Files:**
- Create: `src/notifications/notifications.module.ts`
- Create: `src/notifications/notifications.controller.ts`
- Create: `src/notifications/notifications.service.ts`
- Create: `src/notifications/dto/create-notification.dto.ts`
- Create: `src/notifications/dto/notification-response.dto.ts`
- Create: `src/notifications/push-tokens.controller.ts`
- Modify: `src/app.module.ts` (add NotificationsModule to imports)

**Step 1: Create DTOs**

Create `~/Documents/js/gym-management/src/notifications/dto/create-notification.dto.ts`:

```typescript
import { IsString, IsOptional, IsUUID, MaxLength, IsObject } from 'class-validator';

export class CreateNotificationDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsString()
  @MaxLength(200)
  title: string;

  @IsString()
  @MaxLength(1000)
  body: string;

  @IsString()
  @MaxLength(50)
  type: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
```

Create `~/Documents/js/gym-management/src/notifications/dto/notification-response.dto.ts`:

```typescript
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiPropertyOptional({ format: 'uuid' })
  userId?: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  body: string;

  @ApiProperty({ example: 'GENERAL' })
  type: string;

  @ApiProperty()
  isRead: boolean;

  @ApiPropertyOptional()
  metadata?: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;
}
```

Create `~/Documents/js/gym-management/src/notifications/dto/register-push-token.dto.ts`:

```typescript
import { IsString, MaxLength } from 'class-validator';

export class RegisterPushTokenDto {
  @IsString()
  @MaxLength(200)
  token: string;

  @IsString()
  @MaxLength(10)
  platform: string; // ios, android
}
```

**Step 2: Create service**

Create `~/Documents/js/gym-management/src/notifications/notifications.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNotificationDto } from './dto/create-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({ data: dto });

    // Send push notification
    await this.sendPush(dto.userId ?? null, dto.title, dto.body, dto.metadata);

    return notification;
  }

  async findAllForUser(userId: string, page = 1, limit = 20) {
    const where = {
      OR: [{ userId }, { userId: null }], // User's notifications + broadcasts
    };

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        id,
        OR: [{ userId }, { userId: null }],
      },
      data: { isRead: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        OR: [{ userId }, { userId: null }],
        isRead: false,
      },
      data: { isRead: true },
    });
  }

  async registerPushToken(userId: string, token: string, platform: string) {
    return this.prisma.pushToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async removePushToken(token: string) {
    return this.prisma.pushToken.deleteMany({ where: { token } });
  }

  private async sendPush(
    userId: string | null,
    title: string,
    body: string,
    metadata?: Record<string, unknown> | null,
  ) {
    try {
      let tokens: { token: string }[];

      if (userId) {
        tokens = await this.prisma.pushToken.findMany({
          where: { userId },
          select: { token: true },
        });
      } else {
        // Broadcast — get all push tokens
        tokens = await this.prisma.pushToken.findMany({
          select: { token: true },
        });
      }

      if (tokens.length === 0) return;

      const messages = tokens.map((t) => ({
        to: t.token,
        sound: 'default' as const,
        title,
        body,
        data: metadata ?? {},
      }));

      // Send via Expo Push API
      const chunks = this.chunkArray(messages, 100);
      for (const chunk of chunks) {
        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chunk),
        });
      }
    } catch {
      // Silent fail — push is best-effort
    }
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
```

**Step 3: Create notifications controller**

Create `~/Documents/js/gym-management/src/notifications/notifications.controller.ts`:

```typescript
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOkResponse, ApiCreatedResponse } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @ApiCreatedResponse({ description: 'Notification created and pushed' })
  create(@Body() dto: CreateNotificationDto) {
    return this.notificationsService.create(dto);
  }

  @Get()
  @ApiOkResponse({ description: 'Paginated notifications for current user' })
  findAll(@CurrentUser('id') userId: string, @Query() query: PaginationQueryDto) {
    return this.notificationsService.findAllForUser(userId, query.page, query.limit);
  }

  @Patch(':id/read')
  @ApiOkResponse({ description: 'Notification marked as read' })
  markAsRead(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return this.notificationsService.markAsRead(id, userId);
  }

  @Patch('read-all')
  @ApiOkResponse({ description: 'All notifications marked as read' })
  markAllAsRead(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
```

**Step 4: Create push tokens controller**

Create `~/Documents/js/gym-management/src/notifications/push-tokens.controller.ts`:

```typescript
import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Push Tokens')
@ApiBearerAuth()
@Controller('push-tokens')
@UseGuards(JwtAuthGuard)
export class PushTokensController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post()
  register(@CurrentUser('id') userId: string, @Body() dto: RegisterPushTokenDto) {
    return this.notificationsService.registerPushToken(userId, dto.token, dto.platform);
  }

  @Delete()
  remove(@Body('token') token: string) {
    return this.notificationsService.removePushToken(token);
  }
}
```

**Step 5: Create module**

Create `~/Documents/js/gym-management/src/notifications/notifications.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { PushTokensController } from './push-tokens.controller';
import { NotificationsService } from './notifications.service';

@Module({
  controllers: [NotificationsController, PushTokensController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

**Step 6: Register module in AppModule**

Add `NotificationsModule` to the imports array in `src/app.module.ts`.

**Step 7: Run tests and lint**

```bash
yarn test
yarn lint
```

**Step 8: Commit**

```bash
git add src/notifications/ src/app.module.ts
git commit -m "feat(notifications): add notifications module with push via Expo Push API"
```

---

### Task 16: Hook Notifications into Existing Events

**Files:**
- Modify: `src/attendance/attendance.service.ts` (streak nudge on 3/4 days)
- Modify: `src/subscriptions/subscriptions.service.ts` (status change notifications)
- Modify: `src/billing/billing.service.ts` (expiry + payment reminders)

**Step 1: Inject NotificationsService into AttendanceService**

Add to `AttendanceService` constructor:

```typescript
constructor(
  private prisma: PrismaService,
  private readonly eventEmitter: EventEmitter2,
  private readonly notificationsService: NotificationsService,
) {}
```

After the streak update in `checkIn()`, add:

```typescript
// Streak nudge: "One more day this week!"
if (streak.daysThisWeek === this.DAYS_REQUIRED_PER_WEEK - 1) {
  this.notificationsService.create({
    userId: memberId,
    title: 'Almost there!',
    body: `One more day this week to keep your ${streak.weeklyStreak}-week streak going!`,
    type: 'STREAK_NUDGE',
    metadata: { weeklyStreak: streak.weeklyStreak, daysThisWeek: streak.daysThisWeek },
  }).catch(() => {}); // Fire and forget
}
```

Update `AttendanceModule` imports to include `NotificationsModule`.

**Step 2: Add status change notification in SubscriptionsService**

After subscription status changes (freeze, unfreeze, cancel), add:

```typescript
await this.notificationsService.create({
  userId: subscription.primaryMemberId,
  title: 'Subscription Updated',
  body: `Your subscription has been ${newStatus.toLowerCase()}`,
  type: 'STATUS_CHANGE',
  metadata: { subscriptionId: subscription.id, status: newStatus },
});
```

Update `SubscriptionsModule` imports to include `NotificationsModule`.

**Step 3: Add expiry and payment reminders in BillingService**

In the daily billing cron, when finding subscriptions expiring in 7, 3, or 1 days:

```typescript
await this.notificationsService.create({
  userId: subscription.primaryMemberId,
  title: 'Subscription Expiring Soon',
  body: `Your ${subscription.plan.name} expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
  type: 'SUBSCRIPTION_EXPIRING',
  metadata: { subscriptionId: subscription.id, daysLeft },
});
```

For M-Pesa payment reminders:

```typescript
await this.notificationsService.create({
  userId: subscription.primaryMemberId,
  title: 'Payment Reminder',
  body: `Payment due for your ${subscription.plan.name} plan`,
  type: 'PAYMENT_REMINDER',
  metadata: { subscriptionId: subscription.id },
});
```

Update `BillingModule` imports to include `NotificationsModule`.

**Step 4: Run tests**

```bash
yarn test
```

Fix any failing tests by adding `NotificationsService` mock to test providers.

**Step 5: Commit**

```bash
git add src/
git commit -m "feat(notifications): hook notifications into attendance, subscriptions, billing"
```

---

## Phase 9: Final Verification

### Task 17: Mobile App Verification

**Step 1: Verify all screens render**

```bash
cd ~/Documents/js/gym-mobile
npx expo start
```

Walk through each screen manually:
- Login → Register → Forgot Password
- Home (streak card, subscription status, quick actions)
- QR Scanner (camera permission, scan flow)
- Profile (edit, avatar, password, logout)
- Subscription plans → payment WebView
- My subscriptions (freeze/cancel)
- Attendance history
- Notifications list
- Legal docs → sign

**Step 2: Run lint**

```bash
npx expo lint
```

**Step 3: Commit any fixes**

```bash
git add .
git commit -m "fix: address issues found during verification"
```

---

### Task 18: Backend Verification

**Step 1: Run full test suite**

```bash
cd ~/Documents/js/gym-management
yarn test
yarn lint
yarn build
```

**Step 2: Test notification endpoints manually**

```bash
# Register push token
curl -X POST http://localhost:3000/api/v1/push-tokens \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"token":"ExponentPushToken[test]","platform":"ios"}'

# Create notification (as admin)
curl -X POST http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test","body":"Hello!","type":"GENERAL"}'

# Get notifications
curl http://localhost:3000/api/v1/notifications \
  -H "Authorization: Bearer <token>"
```

**Step 3: Commit any fixes**

```bash
git add .
git commit -m "fix: address issues found during backend verification"
```
