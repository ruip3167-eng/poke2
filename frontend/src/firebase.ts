/**
 * Firebase Web SDK for Expo Go.
 * Persists auth state via AsyncStorage.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  // @ts-ignore - getReactNativePersistence is exported but not in types
  getReactNativePersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyCeyeXFLlcNpJ9K-KdyGcrnceTZW8AZYPI',
  authDomain: 'pokevalue-scanner.firebaseapp.com',
  projectId: 'pokevalue-scanner',
  storageBucket: 'pokevalue-scanner.firebasestorage.app',
  messagingSenderId: '163747565337',
  appId: '1:163747565337:web:337b2cb62100f39e16bf88',
  measurementId: 'G-1P79YGQTL2',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let auth: ReturnType<typeof getAuth>;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  // already initialized (Fast Refresh) — fall back to getAuth
  auth = getAuth(app);
}

export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, fbSignOut, onAuthStateChanged };
export type { User };
