# Gym Mobile App — MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Expo React Native mobile app for gym members covering auth, legal signing, QR check-in, streaks, subscriptions, profile, and notifications.

**Architecture:** Expo Router for file-based navigation with auth/app route groups. TanStack Query for server state, Zustand for auth tokens. Axios client with interceptors for JWT refresh and Basic Auth.

**Tech Stack:** Expo SDK 52+, Expo Router, NativeWind v4, TanStack Query, Zustand, Axios, expo-camera, expo-secure-store, expo-notifications, react-native-webview, react-native-signature-canvas

**Design Doc:** See `~/Documents/js/gym-management/docs/plans/2026-03-12-gym-mobile-design.md`

**Repo:** `~/Documents/js/gym-mobile` (separate from API repo at `~/Documents/js/gym-management`)

**API Repo CLAUDE.md:** Read `~/Documents/js/gym-management/CLAUDE.md` for full API architecture, endpoints, auth patterns, and environment variables.

**Backend dependency:** This plan assumes the backend notification module is already implemented in the API repo. The notification endpoints used by this app are:
- `GET /notifications` — paginated notifications for current user
- `PATCH /notifications/:id/read` — mark as read
- `PATCH /notifications/read-all` — mark all as read
- `POST /push-tokens` — register Expo push token
- `DELETE /push-tokens` — remove push token on logout

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
  pushToken: string | null;

  setTokens: (access: string, refresh: string) => Promise<void>;
  setUser: (user: User) => void;
  setPushToken: (token: string) => void;
  loadTokens: () => Promise<void>;
  clearAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  isLoading: true,
  pushToken: null,

  setTokens: async (access, refresh) => {
    await SecureStore.setItemAsync('accessToken', access);
    await SecureStore.setItemAsync('refreshToken', refresh);
    set({ accessToken: access, refreshToken: refresh });
  },

  setUser: (user) => set({ user }),

  setPushToken: (token) => set({ pushToken: token }),

  loadTokens: async () => {
    const accessToken = await SecureStore.getItemAsync('accessToken');
    const refreshToken = await SecureStore.getItemAsync('refreshToken');
    set({ accessToken, refreshToken, isLoading: false });
  },

  clearAuth: async () => {
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    set({ accessToken: null, refreshToken: null, user: null, pushToken: null, isLoading: false });
  },
}));
```

**Step 3: Create API client**

Create `~/Documents/js/gym-mobile/src/api/client.ts`:

```typescript
import axios from 'axios';
import { API_BASE_URL, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } from '../lib/constants';
import { useAuthStore } from '../stores/auth';

const PUBLIC_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/forgot-password'];

const api = axios.create({ baseURL: API_BASE_URL });

// Request interceptor — attach JWT or Basic Auth
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  const url = config.url ?? '';

  if (PUBLIC_ENDPOINTS.some((ep) => url.includes(ep))) {
    // Public endpoints use Basic Auth
    if (BASIC_AUTH_USER && BASIC_AUTH_PASSWORD) {
      config.headers.Authorization = `Basic ${btoa(`${BASIC_AUTH_USER}:${BASIC_AUTH_PASSWORD}`)}`;
    }
  } else if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  return config;
});

// Response interceptor — handle 401 token refresh
let isRefreshing = false;
let failedQueue: { resolve: (token: string) => void; reject: (err: unknown) => void }[] = [];

const processQueue = (error: unknown, token: string | null) => {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (originalRequest.url?.includes('/auth/refresh')) {
      await useAuthStore.getState().clearAuth();
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token) => {
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
      const { refreshToken, setTokens } = useAuthStore.getState();
      const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
      await setTokens(data.accessToken, data.refreshToken);
      processQueue(null, data.accessToken);
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError, null);
      await useAuthStore.getState().clearAuth();
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
```

**Step 4: Commit**

```bash
git add src/
git commit -m "feat: add API client with JWT refresh, auth store with secure storage"
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
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useAuthStore } from '../stores/auth';
import api from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function useNotifications() {
  const notificationListener = useRef<Notifications.Subscription>();
  const responseListener = useRef<Notifications.Subscription>();
  const { accessToken, setPushToken } = useAuthStore();

  useEffect(() => {
    if (!accessToken) return;

    registerForPushNotifications().then(async (token) => {
      if (token) {
        setPushToken(token);
        try {
          await api.post('/push-tokens', {
            token,
            platform: Platform.OS,
          });
        } catch {
          // Silent fail
        }
      }
    });

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      // Notification received in foreground — TanStack Query will refetch
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      // Handle navigation based on notification type
      if (data?.type === 'SUBSCRIPTION_EXPIRING') {
        // Navigate to subscriptions
      }
    });

    return () => {
      if (notificationListener.current) {
        Notifications.removeNotificationSubscription(notificationListener.current);
      }
      if (responseListener.current) {
        Notifications.removeNotificationSubscription(responseListener.current);
      }
    };
  }, [accessToken]);
}

async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
    });
  }

  return tokenData.data;
}
```

**Step 2: Create root layout**

Create `~/Documents/js/gym-mobile/app/_layout.tsx`:

```tsx
import '../global.css';
import { useEffect } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../src/stores/auth';
import { useNotifications } from '../src/hooks/useNotifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function RootLayoutInner() {
  const { accessToken, isLoading, loadTokens } = useAuthStore();
  const segments = useSegments();
  const router = useRouter();

  useNotifications();

  useEffect(() => {
    loadTokens();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!accessToken && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (accessToken && inAuthGroup) {
      router.replace('/(app)/(tabs)');
    }
  }, [accessToken, isLoading, segments]);

  if (isLoading) return null;

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

**Step 3: Create `.env.example`**

Create `~/Documents/js/gym-mobile/.env.example`:

```
EXPO_PUBLIC_API_URL=http://localhost:3000/api/v1
EXPO_PUBLIC_BASIC_AUTH_USER=
EXPO_PUBLIC_BASIC_AUTH_PASSWORD=
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat: add root layout with providers, notification hook, auth routing guard"
```

---

## Phase 2: Auth Screens

### Task 4: Auth API Hooks

**Files:**
- Create: `src/api/auth.ts`

**Step 1: Create auth API hooks**

Create `~/Documents/js/gym-mobile/src/api/auth.ts`:

```typescript
import { useMutation, useQuery } from '@tanstack/react-query';
import api from './client';
import { useAuthStore } from '../stores/auth';

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone: string;
  gender: string;
}

export function useLogin() {
  const { setTokens, setUser } = useAuthStore();

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await api.post('/auth/login', payload);
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
    mutationFn: async (payload: RegisterPayload) => {
      const { data } = await api.post('/auth/register', payload);
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
      const { data } = await api.post('/auth/forgot-password', { email });
      return data;
    },
  });
}

export function useMe() {
  const { setUser, accessToken } = useAuthStore();

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
  return useMutation({
    mutationFn: async (payload: { firstName?: string; lastName?: string; phone?: string; gender?: string }) => {
      const { data } = await api.patch('/auth/me', payload);
      return data;
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) => {
      const { data } = await api.patch('/auth/change-password', payload);
      return data;
    },
  });
}

export function useLogout() {
  const { clearAuth, pushToken } = useAuthStore();

  return useMutation({
    mutationFn: async () => {
      if (pushToken) {
        await api.delete('/push-tokens', { data: { token: pushToken } }).catch(() => {});
      }
      await api.post('/auth/logout');
    },
    onSettled: async () => {
      await clearAuth();
    },
  });
}
```

**Step 2: Commit**

```bash
git add src/api/
git commit -m "feat(auth): add auth API hooks (login, register, forgot-password, me, logout)"
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

**Step 1: Create shared components**

Create `~/Documents/js/gym-mobile/src/components/Input.tsx`:

```tsx
import { TextInput, View, Text, TextInputProps } from 'react-native';

interface InputProps extends TextInputProps {
  label: string;
  error?: string;
}

export function Input({ label, error, ...props }: InputProps) {
  return (
    <View className="mb-4">
      <Text className="mb-1 text-sm font-medium text-gray-700">{label}</Text>
      <TextInput
        className={`rounded-lg border px-4 py-3 text-base ${
          error ? 'border-danger' : 'border-gray-300'
        } bg-white`}
        placeholderTextColor="#9CA3AF"
        {...props}
      />
      {error && <Text className="mt-1 text-sm text-danger">{error}</Text>}
    </View>
  );
}
```

Create `~/Documents/js/gym-mobile/src/components/Button.tsx`:

```tsx
import { TouchableOpacity, Text, ActivityIndicator, ViewStyle } from 'react-native';

interface ButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'outline';
  disabled?: boolean;
  style?: ViewStyle;
}

const variants = {
  primary: 'bg-primary',
  secondary: 'bg-secondary',
  danger: 'bg-danger',
  outline: 'border border-primary bg-transparent',
};

const textVariants = {
  primary: 'text-white',
  secondary: 'text-white',
  danger: 'text-white',
  outline: 'text-primary',
};

export function Button({ title, onPress, loading, variant = 'primary', disabled, style }: ButtonProps) {
  return (
    <TouchableOpacity
      className={`rounded-lg px-6 py-3.5 ${variants[variant]} ${
        disabled || loading ? 'opacity-50' : ''
      }`}
      onPress={onPress}
      disabled={disabled || loading}
      style={style}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'outline' ? '#2563EB' : '#fff'} />
      ) : (
        <Text className={`text-center text-base font-semibold ${textVariants[variant]}`}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}
```

**Step 2: Create auth layout**

Create `~/Documents/js/gym-mobile/app/(auth)/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot-password" />
    </Stack>
  );
}
```

**Step 3: Create Login screen**

Create `~/Documents/js/gym-mobile/app/(auth)/login.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { useLogin } from '../../src/api/auth';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();

  const handleLogin = () => {
    if (!email || !password) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    login.mutate(
      { email: email.trim().toLowerCase(), password },
      { onError: (err: any) => Alert.alert('Login Failed', err.response?.data?.message ?? 'Invalid credentials') },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 justify-center px-6">
            <Text className="mb-2 text-center text-3xl font-bold text-primary">Welcome Back</Text>
            <Text className="mb-8 text-center text-gray-500">Sign in to your account</Text>

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
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <Button title="Sign In" onPress={handleLogin} loading={login.isPending} />

            <Link href="/(auth)/forgot-password" className="mt-4 text-center text-primary">
              Forgot password?
            </Link>

            <View className="mt-6 flex-row justify-center">
              <Text className="text-gray-500">Don't have an account? </Text>
              <Link href="/(auth)/register" className="font-semibold text-primary">
                Sign Up
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

**Step 4: Create Register screen**

Create `~/Documents/js/gym-mobile/app/(auth)/register.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Alert } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { useRegister } from '../../src/api/auth';

export default function RegisterScreen() {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    gender: '',
    password: '',
    confirmPassword: '',
  });
  const register = useRegister();

  const update = (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const handleRegister = () => {
    if (Object.values(form).some((v) => !v)) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }
    if (form.password !== form.confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters');
      return;
    }

    const { confirmPassword, ...payload } = form;
    register.mutate(
      { ...payload, email: payload.email.trim().toLowerCase() },
      { onError: (err: any) => Alert.alert('Registration Failed', err.response?.data?.message ?? 'Please try again') },
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View className="flex-1 justify-center px-6 py-8">
            <Text className="mb-2 text-center text-3xl font-bold text-primary">Create Account</Text>
            <Text className="mb-8 text-center text-gray-500">Join the gym today</Text>

            <Input label="First Name" placeholder="John" value={form.firstName} onChangeText={(v) => update('firstName', v)} />
            <Input label="Last Name" placeholder="Doe" value={form.lastName} onChangeText={(v) => update('lastName', v)} />
            <Input label="Email" placeholder="you@example.com" value={form.email} onChangeText={(v) => update('email', v)} keyboardType="email-address" autoCapitalize="none" />
            <Input label="Phone" placeholder="+254..." value={form.phone} onChangeText={(v) => update('phone', v)} keyboardType="phone-pad" />
            <Input label="Gender" placeholder="MALE / FEMALE" value={form.gender} onChangeText={(v) => update('gender', v)} autoCapitalize="characters" />
            <Input label="Password" placeholder="Min 8 characters" value={form.password} onChangeText={(v) => update('password', v)} secureTextEntry />
            <Input label="Confirm Password" placeholder="••••••••" value={form.confirmPassword} onChangeText={(v) => update('confirmPassword', v)} secureTextEntry />

            <Button title="Create Account" onPress={handleRegister} loading={register.isPending} />

            <View className="mt-6 flex-row justify-center">
              <Text className="text-gray-500">Already have an account? </Text>
              <Link href="/(auth)/login" className="font-semibold text-primary">
                Sign In
              </Link>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

**Step 5: Create Forgot Password screen**

Create `~/Documents/js/gym-mobile/app/(auth)/forgot-password.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Input } from '../../src/components/Input';
import { Button } from '../../src/components/Button';
import { useForgotPassword } from '../../src/api/auth';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const forgotPassword = useForgotPassword();
  const router = useRouter();

  const handleSubmit = () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email');
      return;
    }
    forgotPassword.mutate(email.trim().toLowerCase(), {
      onSuccess: () => {
        Alert.alert('Email Sent', 'Check your inbox for password reset instructions', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      },
      onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Please try again'),
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <View className="flex-1 justify-center px-6">
          <Text className="mb-2 text-center text-3xl font-bold text-primary">Forgot Password</Text>
          <Text className="mb-8 text-center text-gray-500">We'll send you a reset link</Text>

          <Input
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Button title="Send Reset Link" onPress={handleSubmit} loading={forgotPassword.isPending} />

          <Button title="Back to Login" onPress={() => router.back()} variant="outline" style={{ marginTop: 16 }} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

**Step 6: Commit**

```bash
git add .
git commit -m "feat(auth): add login, register, forgot-password screens with shared components"
```

---

### Task 6: Auth Routing Guard

The root layout already handles the basic auth/app routing. This task adds the `mustChangePassword` and legal docs gate.

**Files:**
- Modify: `app/_layout.tsx`

**Step 1: Enhance root layout with `useMe` check**

Update `RootLayoutInner` in `app/_layout.tsx` to call `useMe()` when authenticated, then:
- If `user.mustChangePassword` → redirect to a change-password screen
- If unsigned legal docs exist → redirect to legal gate
- Otherwise → `(app)` tabs

```tsx
// Inside RootLayoutInner, after token loading:
const { data: me } = useMe();

useEffect(() => {
  if (isLoading) return;
  const inAuthGroup = segments[0] === '(auth)';

  if (!accessToken && !inAuthGroup) {
    router.replace('/(auth)/login');
  } else if (accessToken && inAuthGroup) {
    router.replace('/(app)/(tabs)');
  }
}, [accessToken, isLoading, segments]);
```

The legal gate is handled at the `(app)/_layout.tsx` level (Task 7).

**Step 2: Commit**

```bash
git add app/
git commit -m "feat(auth): enhance routing guard with me check"
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface LegalDocument {
  id: string;
  title: string;
  content: string;
  version: string;
  isRequired: boolean;
}

export function useUnsignedDocs() {
  return useQuery<LegalDocument[]>({
    queryKey: ['legal', 'unsigned'],
    queryFn: async () => {
      const { data } = await api.get('/legal/unsigned');
      return data;
    },
  });
}

export function useLegalDoc(id: string) {
  return useQuery<LegalDocument>({
    queryKey: ['legal', id],
    queryFn: async () => {
      const { data } = await api.get(`/legal/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

export function useSignDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId, signature }: { documentId: string; signature: string }) => {
      const { data } = await api.post('/legal/sign', { documentId, signature });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['legal'] });
    },
  });
}
```

**Step 2: Create legal gate screen**

Create `~/Documents/js/gym-mobile/app/(app)/legal/index.tsx`:

```tsx
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUnsignedDocs } from '../../../src/api/legal';

export default function LegalGateScreen() {
  const { data: docs, isLoading } = useUnsignedDocs();
  const router = useRouter();

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Text className="text-gray-500">Loading documents...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="px-6 pt-8">
        <Text className="text-2xl font-bold text-gray-900">Required Documents</Text>
        <Text className="mt-2 text-gray-500">Please review and sign the following documents to continue</Text>
      </View>

      <FlatList
        data={docs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            className="mb-3 rounded-lg border border-gray-200 bg-white p-4"
            onPress={() => router.push(`/(app)/legal/sign/${item.id}`)}
          >
            <Text className="text-lg font-semibold text-gray-900">{item.title}</Text>
            <Text className="mt-1 text-sm text-gray-500">Version {item.version}</Text>
            <Text className="mt-2 text-sm font-medium text-primary">Tap to review & sign →</Text>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```

**Step 3: Create sign screen with signature pad**

Create `~/Documents/js/gym-mobile/app/(app)/legal/sign/[id].tsx`:

```tsx
import { useRef, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import SignatureScreen from 'react-native-signature-canvas';
import { useLegalDoc, useSignDocument } from '../../../../src/api/legal';
import { Button } from '../../../../src/components/Button';

export default function SignDocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: doc, isLoading } = useLegalDoc(id);
  const signDoc = useSignDocument();
  const signatureRef = useRef<any>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const router = useRouter();

  const handleSign = () => {
    if (!signature) {
      Alert.alert('Error', 'Please provide your signature');
      return;
    }
    signDoc.mutate(
      { documentId: id, signature },
      {
        onSuccess: () => {
          Alert.alert('Signed', 'Document signed successfully', [{ text: 'OK', onPress: () => router.back() }]);
        },
        onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed to sign'),
      },
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <Text className="text-gray-500">Loading...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView className="flex-1 px-6 pt-4">
        <Text className="text-2xl font-bold text-gray-900">{doc?.title}</Text>
        <Text className="mt-4 text-base leading-6 text-gray-700">{doc?.content}</Text>

        <Text className="mb-2 mt-8 text-lg font-semibold text-gray-900">Your Signature</Text>
        <View className="h-48 overflow-hidden rounded-lg border border-gray-300">
          <SignatureScreen
            ref={signatureRef}
            onOK={(sig: string) => setSignature(sig)}
            onClear={() => setSignature(null)}
            descriptionText=""
            webStyle={`.m-signature-pad--footer { display: none; }`}
          />
        </View>

        <View className="mt-4 flex-row gap-3">
          <Button
            title="Clear"
            variant="outline"
            onPress={() => signatureRef.current?.clearSignature()}
            style={{ flex: 1 }}
          />
          <Button
            title="Save Signature"
            variant="secondary"
            onPress={() => signatureRef.current?.readSignature()}
            style={{ flex: 1 }}
          />
        </View>

        <View className="mb-8 mt-6">
          <Button title="Submit Signature" onPress={handleSign} loading={signDoc.isPending} disabled={!signature} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat(legal): add legal doc gate with signature capture"
```

---

## Phase 4: Main App Tabs

### Task 8: Tab Navigator & Home Screen

**Files:**
- Create: `app/(app)/_layout.tsx`
- Create: `app/(app)/(tabs)/_layout.tsx`
- Create: `app/(app)/(tabs)/index.tsx`
- Create: `src/api/attendance.ts`
- Create: `src/api/subscriptions.ts`
- Create: `src/api/notifications.ts`

**Step 1: Create API hooks for home screen data**

Create `~/Documents/js/gym-mobile/src/api/attendance.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface Streak {
  weeklyStreak: number;
  daysThisWeek: number;
  weekStart: string;
}

interface AttendanceRecord {
  id: string;
  checkInDate: string;
  checkInTime: string;
  createdAt: string;
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

export function useAttendanceHistory(page = 1) {
  return useQuery<{ data: AttendanceRecord[]; total: number }>({
    queryKey: ['attendance', 'history', page],
    queryFn: async () => {
      const { data } = await api.get('/attendance/history', { params: { page, limit: 20 } });
      return data;
    },
  });
}

export function useCheckIn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (qrCode: string) => {
      const { data } = await api.post('/attendance/check-in', { qrCode });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streak'] });
      queryClient.invalidateQueries({ queryKey: ['attendance'] });
    },
  });
}
```

Create `~/Documents/js/gym-mobile/src/api/subscriptions.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from './client';

interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  durationDays: number;
  maxMembers: number;
  maxFreezeDays: number;
  isActive: boolean;
}

interface Subscription {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  frozenAt?: string;
  plan: SubscriptionPlan;
}

export function useSubscriptionPlans() {
  return useQuery<SubscriptionPlan[]>({
    queryKey: ['subscription-plans'],
    queryFn: async () => {
      const { data } = await api.get('/subscription-plans');
      return data.data ?? data;
    },
  });
}

export function useMySubscriptions() {
  return useQuery<Subscription[]>({
    queryKey: ['my-subscriptions'],
    queryFn: async () => {
      const { data } = await api.get('/subscriptions/my');
      return data.data ?? data;
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
    mutationFn: async (subscriptionId: string) => {
      const { data } = await api.patch(`/subscriptions/${subscriptionId}/freeze`);
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
    mutationFn: async (subscriptionId: string) => {
      const { data } = await api.patch(`/subscriptions/${subscriptionId}/unfreeze`);
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
    mutationFn: async (subscriptionId: string) => {
      const { data } = await api.patch(`/subscriptions/${subscriptionId}/cancel`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
    },
  });
}
```

Create `~/Documents/js/gym-mobile/src/api/notifications.ts`:

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export function useNotificationsList(page = 1) {
  return useQuery<{ data: Notification[]; total: number }>({
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
      // Count unread from first page — good enough for badge
      return data.data?.filter((n: Notification) => !n.isRead).length ?? 0;
    },
    refetchInterval: 30_000, // Poll every 30s
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

**Step 2: Create app layout with legal gate check**

Create `~/Documents/js/gym-mobile/app/(app)/_layout.tsx`:

```tsx
import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useUnsignedDocs } from '../../src/api/legal';

export default function AppLayout() {
  const { data: unsignedDocs, isLoading } = useUnsignedDocs();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && unsignedDocs && unsignedDocs.length > 0) {
      router.replace('/(app)/legal');
    }
  }, [unsignedDocs, isLoading]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="legal" options={{ headerShown: true, headerTitle: 'Required Documents' }} />
      <Stack.Screen name="subscription" options={{ headerShown: true, headerTitle: 'Subscriptions' }} />
      <Stack.Screen name="attendance" options={{ headerShown: true, headerTitle: 'Attendance' }} />
      <Stack.Screen name="notifications" options={{ headerShown: true, headerTitle: 'Notifications' }} />
    </Stack>
  );
}
```

**Step 3: Create tab navigator**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/_layout.tsx`:

```tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useUnreadCount } from '../../../src/api/notifications';

export default function TabLayout() {
  const { data: unreadCount } = useUnreadCount();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#2563EB',
        tabBarInactiveTintColor: '#9CA3AF',
        headerRight: () => null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" size={size} color={color} />,
          headerRight: () => null,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Check In',
          tabBarIcon: ({ color, size }) => <Ionicons name="qr-code-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}
```

**Step 4: Create Home screen**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/index.tsx`:

```tsx
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStreak } from '../../../src/api/attendance';
import { useMySubscriptions } from '../../../src/api/subscriptions';
import { useUnreadCount } from '../../../src/api/notifications';
import { useMe } from '../../../src/api/auth';
import { DAYS_REQUIRED_PER_WEEK } from '../../../src/lib/constants';
import { useState, useCallback } from 'react';

export default function HomeScreen() {
  const { data: me } = useMe();
  const { data: streak, refetch: refetchStreak } = useStreak();
  const { data: subscriptions, refetch: refetchSubs } = useMySubscriptions();
  const { data: unreadCount } = useUnreadCount();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);

  const activeSub = subscriptions?.find((s) => s.status === 'ACTIVE');

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStreak(), refetchSubs()]);
    setRefreshing(false);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      <ScrollView
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between px-6 py-4">
          <View>
            <Text className="text-2xl font-bold text-gray-900">
              Hi, {me?.firstName ?? 'Member'}
            </Text>
            <Text className="text-gray-500">Let's crush it today</Text>
          </View>
          <TouchableOpacity className="relative" onPress={() => router.push('/(app)/notifications')}>
            <Ionicons name="notifications-outline" size={28} color="#374151" />
            {(unreadCount ?? 0) > 0 && (
              <View className="absolute -right-1 -top-1 h-5 w-5 items-center justify-center rounded-full bg-danger">
                <Text className="text-xs font-bold text-white">{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Streak Card */}
        <View className="mx-6 rounded-2xl bg-primary p-6">
          <Text className="text-lg font-semibold text-white">Weekly Streak</Text>
          <Text className="mt-1 text-4xl font-bold text-white">
            {streak?.weeklyStreak ?? 0} {streak?.weeklyStreak === 1 ? 'week' : 'weeks'}
          </Text>
          <View className="mt-4 flex-row gap-2">
            {Array.from({ length: DAYS_REQUIRED_PER_WEEK }).map((_, i) => (
              <View
                key={i}
                className={`h-3 flex-1 rounded-full ${
                  i < (streak?.daysThisWeek ?? 0) ? 'bg-accent' : 'bg-white/30'
                }`}
              />
            ))}
          </View>
          <Text className="mt-2 text-sm text-white/80">
            {streak?.daysThisWeek ?? 0}/{DAYS_REQUIRED_PER_WEEK} days this week
          </Text>
        </View>

        {/* Subscription Status */}
        <View className="mx-6 mt-4 rounded-2xl bg-white p-6 shadow-sm">
          <Text className="text-lg font-semibold text-gray-900">Subscription</Text>
          {activeSub ? (
            <>
              <Text className="mt-1 text-base text-gray-700">{activeSub.plan.name}</Text>
              <Text className="text-sm text-gray-500">
                Expires {new Date(activeSub.endDate).toLocaleDateString()}
              </Text>
              <TouchableOpacity
                className="mt-3"
                onPress={() => router.push('/(app)/subscription/my')}
              >
                <Text className="font-medium text-primary">Manage →</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text className="mt-1 text-gray-500">No active subscription</Text>
              <TouchableOpacity
                className="mt-3"
                onPress={() => router.push('/(app)/subscription/plans')}
              >
                <Text className="font-medium text-primary">Browse Plans →</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Quick Actions */}
        <View className="mx-6 mt-4 mb-8 flex-row gap-3">
          <TouchableOpacity
            className="flex-1 items-center rounded-xl bg-white p-4 shadow-sm"
            onPress={() => router.push('/(app)/attendance/history')}
          >
            <Ionicons name="calendar-outline" size={24} color="#2563EB" />
            <Text className="mt-2 text-sm font-medium text-gray-700">History</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="flex-1 items-center rounded-xl bg-white p-4 shadow-sm"
            onPress={() => router.push('/(app)/subscription/plans')}
          >
            <Ionicons name="card-outline" size={24} color="#2563EB" />
            <Text className="mt-2 text-sm font-medium text-gray-700">Plans</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
```

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add tab navigator, home screen with streak card, API hooks"
```

---

### Task 9: QR Scanner Screen

**Files:**
- Create: `app/(app)/(tabs)/scan.tsx`

**Step 1: Create QR scanner**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/scan.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { View, Text, Alert, StyleSheet } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useCheckIn } from '../../../src/api/attendance';
import { Button } from '../../../src/components/Button';

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const checkIn = useCheckIn();

  const handleBarCodeScanned = ({ data }: { data: string }) => {
    if (scanned || checkIn.isPending) return;
    setScanned(true);

    checkIn.mutate(data, {
      onSuccess: (result) => {
        const msg = result.alreadyCheckedIn
          ? "You're already checked in for today!"
          : `Checked in! Streak: ${result.streak?.weeklyStreak ?? 0} weeks`;
        Alert.alert('Success', msg, [{ text: 'OK', onPress: () => setScanned(false) }]);
      },
      onError: (err: any) => {
        const message = err.response?.data?.message ?? 'Check-in failed';
        Alert.alert('Error', message, [{ text: 'OK', onPress: () => setScanned(false) }]);
      },
    });
  };

  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <Text className="text-gray-500">Requesting camera permission...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="mb-4 text-center text-lg text-gray-700">
          Camera access is needed to scan the gym QR code
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-black">
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
      />

      {/* Overlay */}
      <View className="flex-1 items-center justify-center">
        <View className="h-64 w-64 rounded-3xl border-4 border-white/50" />
        <Text className="mt-6 text-lg font-medium text-white">
          {scanned ? 'Processing...' : 'Scan gym QR code'}
        </Text>
      </View>

      {scanned && (
        <View className="absolute bottom-12 left-6 right-6">
          <Button title="Scan Again" onPress={() => setScanned(false)} variant="outline" />
        </View>
      )}
    </View>
  );
}
```

**Step 2: Commit**

```bash
git add app/
git commit -m "feat(attendance): add QR scanner screen with camera permissions"
```

---

### Task 10: Profile Screen

**Files:**
- Create: `app/(app)/(tabs)/profile.tsx`
- Create: `src/api/uploads.ts`

**Step 1: Create uploads hook**

Create `~/Documents/js/gym-mobile/src/api/uploads.ts`:

```typescript
import { useMutation } from '@tanstack/react-query';
import api from './client';

export function useUploadImage() {
  return useMutation({
    mutationFn: async (uri: string) => {
      const formData = new FormData();
      const filename = uri.split('/').pop() ?? 'photo.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const type = match ? `image/${match[1]}` : 'image/jpeg';

      formData.append('file', { uri, name: filename, type } as any);

      const { data } = await api.post('/uploads/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
  });
}
```

**Step 2: Create Profile screen**

Create `~/Documents/js/gym-mobile/app/(app)/(tabs)/profile.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, ScrollView, Alert, Image, TouchableOpacity } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMe, useUpdateProfile, useChangePassword, useLogout } from '../../../src/api/auth';
import { useUploadImage } from '../../../src/api/uploads';
import { Input } from '../../../src/components/Input';
import { Button } from '../../../src/components/Button';

export default function ProfileScreen() {
  const { data: me, refetch } = useMe();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();
  const uploadImage = useUploadImage();
  const logout = useLogout();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    firstName: me?.firstName ?? '',
    lastName: me?.lastName ?? '',
    phone: me?.phone ?? '',
    gender: me?.gender ?? '',
  });
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '' });
  const [showPasswordChange, setShowPasswordChange] = useState(false);

  const handleSaveProfile = () => {
    updateProfile.mutate(form, {
      onSuccess: () => {
        refetch();
        setEditing(false);
        Alert.alert('Success', 'Profile updated');
      },
      onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed to update'),
    });
  };

  const handleAvatarPick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      uploadImage.mutate(result.assets[0].uri, {
        onSuccess: (data) => {
          updateProfile.mutate({ ...form, displayPicture: data.url } as any, {
            onSuccess: () => refetch(),
          });
        },
        onError: () => Alert.alert('Error', 'Failed to upload image'),
      });
    }
  };

  const handleChangePassword = () => {
    if (!passwords.currentPassword || !passwords.newPassword) {
      Alert.alert('Error', 'Please fill in both fields');
      return;
    }
    changePassword.mutate(passwords, {
      onSuccess: () => {
        setShowPasswordChange(false);
        setPasswords({ currentPassword: '', newPassword: '' });
        Alert.alert('Success', 'Password changed');
      },
      onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed to change password'),
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={['top']}>
      <ScrollView className="flex-1 px-6 pt-4">
        {/* Avatar */}
        <TouchableOpacity className="mb-6 items-center" onPress={handleAvatarPick}>
          {me?.displayPicture ? (
            <Image source={{ uri: me.displayPicture }} className="h-24 w-24 rounded-full" />
          ) : (
            <View className="h-24 w-24 items-center justify-center rounded-full bg-primary">
              <Text className="text-3xl font-bold text-white">
                {me?.firstName?.[0]}{me?.lastName?.[0]}
              </Text>
            </View>
          )}
          <Text className="mt-2 text-sm text-primary">Change Photo</Text>
        </TouchableOpacity>

        {/* Profile Info */}
        <View className="rounded-2xl bg-white p-6 shadow-sm">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-gray-900">Profile</Text>
            <TouchableOpacity onPress={() => setEditing(!editing)}>
              <Text className="font-medium text-primary">{editing ? 'Cancel' : 'Edit'}</Text>
            </TouchableOpacity>
          </View>

          {editing ? (
            <>
              <Input label="First Name" value={form.firstName} onChangeText={(v) => setForm((p) => ({ ...p, firstName: v }))} />
              <Input label="Last Name" value={form.lastName} onChangeText={(v) => setForm((p) => ({ ...p, lastName: v }))} />
              <Input label="Phone" value={form.phone} onChangeText={(v) => setForm((p) => ({ ...p, phone: v }))} keyboardType="phone-pad" />
              <Input label="Gender" value={form.gender} onChangeText={(v) => setForm((p) => ({ ...p, gender: v }))} />
              <Button title="Save" onPress={handleSaveProfile} loading={updateProfile.isPending} />
            </>
          ) : (
            <>
              <ProfileRow label="Name" value={`${me?.firstName} ${me?.lastName}`} />
              <ProfileRow label="Email" value={me?.email ?? ''} />
              <ProfileRow label="Phone" value={me?.phone ?? 'Not set'} />
              <ProfileRow label="Gender" value={me?.gender ?? 'Not set'} />
            </>
          )}
        </View>

        {/* Change Password */}
        <TouchableOpacity
          className="mt-4 rounded-2xl bg-white p-6 shadow-sm"
          onPress={() => setShowPasswordChange(!showPasswordChange)}
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-gray-900">Change Password</Text>
            <Ionicons name={showPasswordChange ? 'chevron-up' : 'chevron-down'} size={20} color="#9CA3AF" />
          </View>

          {showPasswordChange && (
            <View className="mt-4">
              <Input label="Current Password" value={passwords.currentPassword} onChangeText={(v) => setPasswords((p) => ({ ...p, currentPassword: v }))} secureTextEntry />
              <Input label="New Password" value={passwords.newPassword} onChangeText={(v) => setPasswords((p) => ({ ...p, newPassword: v }))} secureTextEntry />
              <Button title="Change Password" onPress={handleChangePassword} loading={changePassword.isPending} />
            </View>
          )}
        </TouchableOpacity>

        {/* Logout */}
        <View className="mb-8 mt-6">
          <Button title="Logout" variant="danger" onPress={() => {
            Alert.alert('Logout', 'Are you sure?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Logout', style: 'destructive', onPress: () => logout.mutate() },
            ]);
          }} loading={logout.isPending} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="mb-3 flex-row justify-between">
      <Text className="text-gray-500">{label}</Text>
      <Text className="font-medium text-gray-900">{value}</Text>
    </View>
  );
}
```

**Step 3: Install image picker**

```bash
npx expo install expo-image-picker
```

**Step 4: Commit**

```bash
git add .
git commit -m "feat(profile): add profile screen with edit, avatar upload, password change, logout"
```

---

## Phase 5: Subscriptions & Payments

### Task 11: Subscription Screens

**Files:**
- Create: `app/(app)/subscription/plans.tsx`
- Create: `app/(app)/subscription/my.tsx`
- Create: `app/(app)/subscription/payment.tsx`
- Create: `src/api/payments.ts`

**Step 1: Create payments API hook**

Create `~/Documents/js/gym-mobile/src/api/payments.ts`:

```typescript
import { useMutation } from '@tanstack/react-query';
import api from './client';

interface PaymentInitResponse {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export function useInitializePayment() {
  return useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { data } = await api.post<PaymentInitResponse>(`/payments/initialize/${subscriptionId}`);
      return data;
    },
  });
}
```

**Step 2: Create plans screen**

Create `~/Documents/js/gym-mobile/app/(app)/subscription/plans.tsx`:

```tsx
import { View, Text, FlatList, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSubscriptionPlans, useCreateSubscription } from '../../../src/api/subscriptions';

export default function PlansScreen() {
  const { data: plans, isLoading } = useSubscriptionPlans();
  const createSub = useCreateSubscription();
  const router = useRouter();

  const handleSelectPlan = (planId: string) => {
    createSub.mutate(planId, {
      onSuccess: (sub) => {
        router.push({ pathname: '/(app)/subscription/payment', params: { subscriptionId: sub.id } });
      },
      onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed to create subscription'),
    });
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={[]}>
      <FlatList
        data={plans}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24 }}
        ListHeaderComponent={
          <Text className="mb-4 text-2xl font-bold text-gray-900">Choose a Plan</Text>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            className="mb-4 rounded-2xl bg-white p-6 shadow-sm"
            onPress={() => handleSelectPlan(item.id)}
            disabled={createSub.isPending}
          >
            <Text className="text-xl font-bold text-gray-900">{item.name}</Text>
            <Text className="mt-1 text-3xl font-bold text-primary">
              KES {item.price.toLocaleString()}
            </Text>
            <Text className="mt-1 text-gray-500">{item.durationDays} days</Text>
            {item.maxMembers > 1 && (
              <Text className="mt-1 text-sm text-accent">Up to {item.maxMembers} members (duo)</Text>
            )}
            {item.maxFreezeDays > 0 && (
              <Text className="mt-1 text-sm text-gray-400">
                {item.maxFreezeDays} freeze days included
              </Text>
            )}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```

**Step 3: Create my subscriptions screen**

Create `~/Documents/js/gym-mobile/app/(app)/subscription/my.tsx`:

```tsx
import { View, Text, FlatList, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMySubscriptions, useFreezeSubscription, useUnfreezeSubscription, useCancelSubscription } from '../../../src/api/subscriptions';
import { Button } from '../../../src/components/Button';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-success',
  FROZEN: 'bg-accent',
  PENDING: 'bg-gray-400',
  CANCELLED: 'bg-danger',
  EXPIRED: 'bg-gray-400',
};

export default function MySubscriptionsScreen() {
  const { data: subs, isLoading, refetch } = useMySubscriptions();
  const freeze = useFreezeSubscription();
  const unfreeze = useUnfreezeSubscription();
  const cancel = useCancelSubscription();

  const handleFreeze = (id: string) => {
    Alert.alert('Freeze Subscription', 'Your check-ins will be blocked while frozen.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Freeze',
        onPress: () => freeze.mutate(id, {
          onSuccess: () => { refetch(); Alert.alert('Done', 'Subscription frozen'); },
          onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed'),
        }),
      },
    ]);
  };

  const handleUnfreeze = (id: string) => {
    unfreeze.mutate(id, {
      onSuccess: () => { refetch(); Alert.alert('Done', 'Subscription unfrozen'); },
      onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed'),
    });
  };

  const handleCancel = (id: string) => {
    Alert.alert('Cancel Subscription', 'This cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Subscription',
        style: 'destructive',
        onPress: () => cancel.mutate(id, {
          onSuccess: () => { refetch(); Alert.alert('Done', 'Subscription cancelled'); },
          onError: (err: any) => Alert.alert('Error', err.response?.data?.message ?? 'Failed'),
        }),
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={[]}>
      <FlatList
        data={subs}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24 }}
        ListEmptyComponent={
          <Text className="text-center text-gray-500">No subscriptions found</Text>
        }
        renderItem={({ item }) => (
          <View className="mb-4 rounded-2xl bg-white p-6 shadow-sm">
            <View className="flex-row items-center justify-between">
              <Text className="text-lg font-bold text-gray-900">{item.plan.name}</Text>
              <View className={`rounded-full px-3 py-1 ${statusColors[item.status] ?? 'bg-gray-400'}`}>
                <Text className="text-xs font-semibold text-white">{item.status}</Text>
              </View>
            </View>
            <Text className="mt-1 text-gray-500">
              {new Date(item.startDate).toLocaleDateString()} — {new Date(item.endDate).toLocaleDateString()}
            </Text>

            {item.status === 'ACTIVE' && (
              <View className="mt-4 flex-row gap-3">
                <Button title="Freeze" variant="outline" onPress={() => handleFreeze(item.id)} style={{ flex: 1 }} />
                <Button title="Cancel" variant="danger" onPress={() => handleCancel(item.id)} style={{ flex: 1 }} />
              </View>
            )}

            {item.status === 'FROZEN' && (
              <View className="mt-4">
                <Button title="Unfreeze" variant="primary" onPress={() => handleUnfreeze(item.id)} />
              </View>
            )}
          </View>
        )}
      />
    </SafeAreaView>
  );
}
```

**Step 4: Create payment WebView screen**

Create `~/Documents/js/gym-mobile/app/(app)/subscription/payment.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, ActivityIndicator, Alert } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { WebView } from 'react-native-webview';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useInitializePayment } from '../../../src/api/payments';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export default function PaymentScreen() {
  const { subscriptionId } = useLocalSearchParams<{ subscriptionId: string }>();
  const initPayment = useInitializePayment();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);

  useEffect(() => {
    if (subscriptionId) {
      initPayment.mutate(subscriptionId, {
        onSuccess: (data) => setPaymentUrl(data.authorization_url),
        onError: (err: any) => {
          Alert.alert('Error', err.response?.data?.message ?? 'Failed to initialize payment', [
            { text: 'OK', onPress: () => router.back() },
          ]);
        },
      });
    }
  }, [subscriptionId]);

  const handleNavigationChange = (navState: { url: string }) => {
    // Paystack redirects to callback URL on success
    if (navState.url.includes('callback') || navState.url.includes('success')) {
      queryClient.invalidateQueries({ queryKey: ['my-subscriptions'] });
      Alert.alert('Payment Complete', 'Your subscription is being activated', [
        { text: 'OK', onPress: () => router.replace('/(app)/(tabs)') },
      ]);
    }
  };

  if (!paymentUrl) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#2563EB" />
        <Text className="mt-4 text-gray-500">Initializing payment...</Text>
      </SafeAreaView>
    );
  }

  return (
    <View className="flex-1">
      <WebView
        source={{ uri: paymentUrl }}
        onNavigationStateChange={handleNavigationChange}
        startInLoadingState
        renderLoading={() => (
          <View className="absolute inset-0 items-center justify-center bg-white">
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
git add .
git commit -m "feat(subscriptions): add plans, my subscriptions, and Paystack payment WebView"
```

---

## Phase 6: Attendance History

### Task 12: Attendance History Screen

**Files:**
- Create: `app/(app)/attendance/history.tsx`

**Step 1: Create attendance history screen**

Create `~/Documents/js/gym-mobile/app/(app)/attendance/history.tsx`:

```tsx
import { useState } from 'react';
import { View, Text, FlatList, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAttendanceHistory } from '../../../src/api/attendance';

export default function AttendanceHistoryScreen() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAttendanceHistory(page);

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={[]}>
      <FlatList
        data={data?.data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24 }}
        ListHeaderComponent={
          <Text className="mb-4 text-2xl font-bold text-gray-900">Attendance History</Text>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator className="mt-8" />
          ) : (
            <Text className="text-center text-gray-500">No check-ins yet</Text>
          )
        }
        renderItem={({ item }) => (
          <View className="mb-3 flex-row items-center rounded-xl bg-white p-4 shadow-sm">
            <View className="mr-4 h-10 w-10 items-center justify-center rounded-full bg-success/10">
              <Ionicons name="checkmark-circle" size={24} color="#22C55E" />
            </View>
            <View>
              <Text className="font-semibold text-gray-900">
                {new Date(item.checkInDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </Text>
              <Text className="text-sm text-gray-500">{item.checkInTime}</Text>
            </View>
          </View>
        )}
        onEndReached={() => {
          if (data && data.data.length < data.total) {
            setPage((p) => p + 1);
          }
        }}
        onEndReachedThreshold={0.5}
      />
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/
git commit -m "feat(attendance): add attendance history screen with pagination"
```

---

## Phase 7: Notifications

### Task 13: Notification List Screen

**Files:**
- Create: `app/(app)/notifications.tsx`

**Step 1: Create notification list screen**

Create `~/Documents/js/gym-mobile/app/(app)/notifications.tsx`:

```tsx
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNotificationsList, useMarkAsRead, useMarkAllAsRead } from '../../src/api/notifications';

const typeIcons: Record<string, string> = {
  SUBSCRIPTION_EXPIRING: 'time-outline',
  PAYMENT_REMINDER: 'card-outline',
  STREAK_NUDGE: 'flame-outline',
  STATUS_CHANGE: 'sync-outline',
  GENERAL: 'megaphone-outline',
};

export default function NotificationsScreen() {
  const { data, isLoading, refetch } = useNotificationsList();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const router = useRouter();

  const handleTap = (notification: any) => {
    if (!notification.isRead) {
      markAsRead.mutate(notification.id);
    }

    // Deep link based on type
    switch (notification.type) {
      case 'SUBSCRIPTION_EXPIRING':
      case 'STATUS_CHANGE':
        router.push('/(app)/subscription/my');
        break;
      case 'PAYMENT_REMINDER':
        router.push('/(app)/subscription/plans');
        break;
      case 'STREAK_NUDGE':
        router.push('/(app)/(tabs)/scan');
        break;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50" edges={[]}>
      <FlatList
        data={data?.data}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 24 }}
        ListHeaderComponent={
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="text-2xl font-bold text-gray-900">Notifications</Text>
            <TouchableOpacity onPress={() => markAllAsRead.mutate()}>
              <Text className="font-medium text-primary">Mark all read</Text>
            </TouchableOpacity>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator className="mt-8" />
          ) : (
            <Text className="text-center text-gray-500">No notifications</Text>
          )
        }
        onRefresh={refetch}
        refreshing={isLoading}
        renderItem={({ item }) => (
          <TouchableOpacity
            className={`mb-3 flex-row rounded-xl p-4 shadow-sm ${
              item.isRead ? 'bg-white' : 'bg-blue-50'
            }`}
            onPress={() => handleTap(item)}
          >
            <View className="mr-3 mt-0.5">
              <Ionicons
                name={(typeIcons[item.type] ?? 'notifications-outline') as any}
                size={24}
                color={item.isRead ? '#9CA3AF' : '#2563EB'}
              />
            </View>
            <View className="flex-1">
              <Text className={`font-semibold ${item.isRead ? 'text-gray-700' : 'text-gray-900'}`}>
                {item.title}
              </Text>
              <Text className="mt-0.5 text-sm text-gray-500">{item.body}</Text>
              <Text className="mt-1 text-xs text-gray-400">
                {new Date(item.createdAt).toLocaleDateString()}
              </Text>
            </View>
            {!item.isRead && <View className="mt-2 h-2.5 w-2.5 rounded-full bg-primary" />}
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}
```

**Step 2: Commit**

```bash
git add app/
git commit -m "feat(notifications): add notification list with deep linking and mark read"
```

---

## Phase 8: Final Verification

### Task 14: Mobile App Verification

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
