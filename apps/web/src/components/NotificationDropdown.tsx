'use client';

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabase';
import { useAuth } from '../context/AuthContext';

export interface NotificationItem {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  tournament_id?: string | null;
  match_id?: string | null;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
}

export default function NotificationDropdown() {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const fetchNotifications = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching notifications:', error);
      } else if (data) {
        setNotifications(data as NotificationItem[]);
      }
    } catch (err) {
      console.error('Failed to load notifications:', err);
    }
  };

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      return;
    }

    fetchNotifications();

    // Setup Realtime subscription with unique channel name
    const channelName = `user_notifs_${user.id}_${Math.random().toString(36).slice(2, 9)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${user.id}`,
        },
        () => {
          fetchNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  // Click outside listener
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAsRead = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await supabase.rpc('mark_notification_read', { p_notification_id: id });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n))
      );
    } catch (err) {
      console.error('Failed to mark notification read:', err);
    }
  };

  const markAllAsRead = async () => {
    if (!user || unreadCount === 0) return;
    setLoading(true);
    try {
      await supabase.rpc('mark_all_notifications_read');
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, is_read: true, read_at: new Date().toISOString() }))
      );
    } catch (err) {
      console.error('Failed to mark all notifications read:', err);
    } finally {
      setLoading(false);
    }
  };

  const getTypeBadgeColor = (type: string) => {
    switch (type) {
      case 'MATCH_SCHEDULED':
      case 'COURT_ASSIGNED':
        return 'bg-[#EEF4FF] text-[#3538CD] border-[#C7D7FE]';
      case 'MATCH_STARTED':
      case 'MATCH_STARTING':
        return 'bg-[#FEF6EE] text-[#B54708] border-[#F9DBAF]';
      case 'MATCH_RESULT':
      case 'NEXT_ROUND':
      case 'QUALIFIED':
        return 'bg-[#ECFDF3] text-[#027A48] border-[#ABEFC6]';
      case 'ELIMINATED':
        return 'bg-[#FEF3F2] text-[#B42318] border-[#FECDCA]';
      case 'REGISTRATION_RECEIVED':
      case 'REGISTRATION_STATUS':
        return 'bg-[#F9F5FF] text-[#6941C6] border-[#E9D7FE]';
      case 'SCORER_ASSIGNED':
        return 'bg-[#F0F9FF] text-[#026AA2] border-[#B9E6FE]';
      default:
        return 'bg-[#F2F4F7] text-[#344054] border-[#D0D5DD]';
    }
  };

  const formatTimeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  if (!user) return null;

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg text-[#667085] hover:text-[#172033] hover:bg-[#F2F4F7] transition border border-transparent focus:outline-none"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>

        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-[#F04438] text-white text-[10px] font-bold rounded-full shadow-sm">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="origin-top-right absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-white shadow-xl border border-[#E4E7EC] z-50 overflow-hidden animate-in fade-in duration-150">
          {/* Header */}
          <div className="p-3.5 px-4 bg-[#F8FAF9] border-b border-[#E4E7EC] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#172033]">Notifications</span>
              {unreadCount > 0 && (
                <span className="bg-[#14966B] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                disabled={loading}
                className="text-[11px] font-semibold text-[#14966B] hover:text-[#10805B] transition disabled:opacity-50"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-[380px] overflow-y-auto divide-y divide-[#F2F4F7]">
            {notifications.length === 0 ? (
              <div className="py-12 px-4 text-center">
                <div className="w-10 h-10 rounded-full bg-[#F2F4F7] flex items-center justify-center mx-auto mb-2 text-[#98A2B3]">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-[#475467]">No notifications yet</p>
                <p className="text-[11px] text-[#98A2B3] mt-0.5">You will be alerted about matches and schedules here.</p>
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => !item.is_read && markAsRead(item.id)}
                  className={`p-3.5 px-4 transition cursor-pointer flex gap-3 ${
                    item.is_read ? 'bg-white hover:bg-[#F9FAFB]' : 'bg-[#F0FDF4]/50 hover:bg-[#ECFDF3]'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider ${getTypeBadgeColor(item.type)}`}>
                        {item.type.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[10px] text-[#98A2B3]">{formatTimeAgo(item.created_at)}</span>
                      {!item.is_read && (
                        <span className="w-1.5 h-1.5 rounded-full bg-[#14966B] ml-auto"></span>
                      )}
                    </div>
                    <h4 className={`text-xs ${item.is_read ? 'font-semibold text-[#344054]' : 'font-bold text-[#172033]'}`}>
                      {item.title}
                    </h4>
                    <p className="text-[11px] text-[#667085] mt-0.5 line-clamp-2 leading-relaxed">
                      {item.message}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
