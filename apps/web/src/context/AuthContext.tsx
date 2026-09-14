'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';

interface AuthProfile {
  id: string;
  fullName: string;
  displayName?: string;
  avatarUrl?: string;
  role: 'PLATFORM_ADMIN' | 'ORGANIZER' | 'TOURNAMENT_ADMIN' | 'SCORER' | 'PLAYER' | 'SPECTATOR';
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: AuthProfile | null;
  loading: boolean;
  error: string | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async (userId: string, attempt = 0): Promise<AuthProfile | null> => {
    try {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profileError) {
        const errMsg = profileError.message || '';
        const isJwtFuture = errMsg.toLowerCase().includes('jwt issued at future') || errMsg.toLowerCase().includes('future');
        const isJwtInvalid = errMsg.toLowerCase().includes('jwt') || profileError.code === 'PGRST301' || (profileError as any).status === 401;

        // If JWT is considered issued at future (due to slight server-client clock skew), retry after a short delay
        if (isJwtFuture && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 500));
          return await fetchProfile(userId, attempt + 1);
        }

        // If JWT is invalid/expired, attempt session refresh
        if (isJwtInvalid && attempt < 2) {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData.session?.user) {
            return await fetchProfile(refreshData.session.user.id, attempt + 1);
          }
        }

        // If unrecoverable JWT error, sign out cleanly to prevent persistent zombie state
        if (isJwtFuture || isJwtInvalid) {
          console.warn('Unrecoverable auth session error. Clearing stale session:', errMsg);
          await supabase.auth.signOut();
          setUser(null);
          setSession(null);
          setProfile(null);
          return null;
        }

        throw profileError;
      }

      if (!data) return null;

      const loadedProfile: AuthProfile = {
        id: data.id,
        fullName: data.full_name || '',
        displayName: data.display_name || data.full_name || '',
        avatarUrl: data.avatar_url || '',
        role: data.role || 'SPECTATOR',
      };

      setProfile(loadedProfile);
      setError(null);
      return loadedProfile;
    } catch (err: any) {
      console.error('Error fetching profile:', err.message || err);
      setProfile(null);
      setError(err.message || 'Error fetching profile');
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (!isMounted) return;

      setSession(currentSession);
      setUser(currentSession?.user ?? null);

      if (currentSession?.user) {
        setLoading(true);
        await fetchProfile(currentSession.user.id);
        if (isMounted) setLoading(false);
      } else {
        setProfile(null);
        if (isMounted) setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = async () => {
    setLoading(true);
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setUser(null);
      setSession(null);
      setProfile(null);
    } catch (err: any) {
      setError(err.message || 'Failed to sign out');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, error, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
