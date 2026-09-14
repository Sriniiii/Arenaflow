'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../services/supabase';
import { tournamentSchema, venueSchema } from '@arena-flow/validation';
import { createTournamentWithUniqueSlug } from '../../../utils/slugify';
import Navigation from '../../../components/Navigation';

interface Sport {
  id: string;
  name: string;
  slug: string;
}

interface Venue {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
}

export default function CreateTournamentPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Sports & Venues lists
  const [sports, setSports] = useState<Sport[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sportId, setSportId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState('');
  const [registrationClose, setRegistrationClose] = useState('');
  const [rules, setRules] = useState('');

  // Venue selection/creation states
  const [selectedVenueId, setSelectedVenueId] = useState<string>('none');
  const [isCreatingNewVenue, setIsCreatingNewVenue] = useState(false);
  const [newVenueName, setNewVenueName] = useState('');
  const [newVenueAddress, setNewVenueAddress] = useState('');
  const [newVenueCity, setNewVenueCity] = useState('');
  const [newVenueCountry, setNewVenueCountry] = useState('');

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push('/auth/login');
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const fetchInitialData = async () => {
      try {
        // Fetch active sports
        const { data: sportsData, error: sportsErr } = await supabase
          .from('sports')
          .select('id, name, slug')
          .eq('is_active', true);
        if (sportsErr) throw sportsErr;

        const filteredSports = (sportsData || []).filter(s => {
          return !/^(P[0-9]|Test)/i.test(s.name);
        });
        setSports(filteredSports);
        
        // Find Badminton and make it default
        const badminton = filteredSports.find((s: Sport) => s.slug === 'badminton');
        if (badminton) {
          setSportId(badminton.id);
        } else if (filteredSports.length > 0) {
          setSportId(filteredSports[0].id);
        }

        // Fetch venues owned by this organizer
        const { data: venuesData, error: venuesErr } = await supabase
          .from('venues')
          .select('id, name, address, city, country')
          .eq('owner_id', user.id);
        if (venuesErr) throw venuesErr;

        setVenues(venuesData || []);
      } catch (err: any) {
        console.error('Failed to load initial data:', err.message);
      } finally {
        setLoadingInitial(false);
      }
    };

    fetchInitialData();
  }, [user]);

  const handleCreateVenue = async (): Promise<string | null> => {
    if (!newVenueName) return null;

    // Validate new venue data
    const venueValidation = venueSchema.safeParse({
      name: newVenueName,
      address: newVenueAddress,
      city: newVenueCity,
      country: newVenueCountry
    });

    if (!venueValidation.success) {
      const fieldErrors: Record<string, string> = {};
      venueValidation.error.issues.forEach((issue: any) => {
        fieldErrors[`venue_${issue.path[0]}`] = issue.message;
      });
      setErrors(prev => ({ ...prev, ...fieldErrors }));
      return null;
    }

    const { data, error } = await supabase
      .from('venues')
      .insert({
        name: newVenueName,
        address: newVenueAddress,
        city: newVenueCity,
        country: newVenueCountry,
        owner_id: user?.id
      })
      .select('id')
      .single();

    if (error) {
      setSubmitError(`Failed to create venue: ${error.message}`);
      return null;
    }

    return data.id;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    setSubmitError(null);

    // 1. Validate Form via Zod Shared Schema
    const tourneyValidation = tournamentSchema.safeParse({
      name,
      description,
      sport_id: sportId,
      venue_id: selectedVenueId === 'none' ? null : selectedVenueId,
      start_date: startDate ? new Date(startDate).toISOString() : '',
      end_date: endDate ? new Date(endDate).toISOString() : '',
      registration_open: registrationOpen ? new Date(registrationOpen).toISOString() : '',
      registration_close: registrationClose ? new Date(registrationClose).toISOString() : '',
      status: 'DRAFT',
      rules
    });

    if (!tourneyValidation.success) {
      const fieldErrors: Record<string, string> = {};
      tourneyValidation.error.issues.forEach(issue => {
        fieldErrors[issue.path[0] as string] = issue.message;
      });
      setErrors(fieldErrors);
      setSaving(false);
      return;
    }

    try {
      // 2. Handle Venue Creation if required
      let finalVenueId = selectedVenueId === 'none' ? null : selectedVenueId;
      if (isCreatingNewVenue) {
        const newlyCreatedId = await handleCreateVenue();
        if (!newlyCreatedId) {
          setSaving(false);
          return;
        }
        finalVenueId = newlyCreatedId;
      }

      // 3. Create Tournament with Server-Side Unique Slug Retry Loops
      const { data, error: insertError } = await createTournamentWithUniqueSlug({
        name,
        description,
        sport_id: sportId,
        venue_id: finalVenueId,
        start_date: new Date(startDate).toISOString(),
        end_date: new Date(endDate).toISOString(),
        registration_open: new Date(registrationOpen).toISOString(),
        registration_close: new Date(registrationClose).toISOString(),
        status: 'DRAFT',
        organizer_id: user!.id
      });

      if (insertError) {
        throw insertError;
      }

      // 4. Redirect to configuration panel
      router.push(`/tournaments/${data.id}/configure`);
    } catch (err: any) {
      setSubmitError(err.message || 'An error occurred while creating the tournament.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || loadingInitial) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent text-[#64748B]">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 border-2 border-[#14966B] border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-semibold">Loading setup form...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-[#0F172A] flex flex-col">
      <Navigation />

      <main className="max-w-4xl mx-auto w-full px-4 sm:px-6 py-8 flex-1 space-y-6">
        <div>
          <button
            onClick={() => router.back()}
            className="text-xs font-semibold text-[#64748B] hover:text-[#0F172A] mb-2 inline-flex items-center gap-1 transition"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0F172A]">Create Tournament</h1>
          <p className="text-xs sm:text-sm text-[#64748B] mt-0.5">Set up a new competitive tournament and configure brackets.</p>
        </div>

        {/* Wizard Step Progression Visualizer */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4 pro-glass p-3 sm:p-4 rounded-xl shadow-xs">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#14966B] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
              1
            </span>
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#0F172A] block">Basic Info</span>
              <span className="text-[9px] text-[#64748B] hidden sm:block">Sport & Details</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 border-l border-slate-200/80 pl-2 sm:pl-4">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-emerald-50 text-[#14966B] border border-emerald-200 flex items-center justify-center text-xs font-bold shrink-0">
              2
            </span>
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#0F172A] block">Venue</span>
              <span className="text-[9px] text-[#64748B] hidden sm:block">Location & Courts</span>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 border-l border-slate-200/80 pl-2 sm:pl-4">
            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-emerald-50 text-[#14966B] border border-emerald-200 flex items-center justify-center text-xs font-bold shrink-0">
              3
            </span>
            <div>
              <span className="text-[10px] sm:text-xs font-bold text-[#0F172A] block">Schedule</span>
              <span className="text-[9px] text-[#64748B] hidden sm:block">Dates & Rules</span>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {submitError && (
            <div className="bg-[#FDEEEE]/90 backdrop-blur-md border border-[#FECDCA] text-[#C94A4A] rounded-xl p-4 text-xs font-medium" role="alert">
              {submitError}
            </div>
          )}

          {/* General Details */}
          <div className="pro-card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#0F172A] border-b border-slate-200/80 pb-2.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#14966B]" />
              Tournament Details
            </h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">Tournament Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Delhi Badminton Open"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="arena-input w-full"
                />
                {errors.name && <p className="text-xs text-[#C94A4A] mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">Sport *</label>
                <select
                  value={sportId}
                  onChange={(e) => setSportId(e.target.value)}
                  className="arena-select w-full"
                >
                  {sports.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {errors.sport_id && <p className="text-xs text-[#C94A4A] mt-1">{errors.sport_id}</p>}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5">Description</label>
              <textarea
                rows={3}
                placeholder="A brief description of the event..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="arena-textarea w-full"
              />
              {errors.description && <p className="text-xs text-[#C94A4A] mt-1">{errors.description}</p>}
            </div>
          </div>

          {/* Venue & Location Selection */}
          <div className="pro-card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#0F172A] border-b border-slate-200/80 pb-2.5">
              Venue & Location
            </h2>

            {!isCreatingNewVenue ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-[#334155] mb-1.5">Select Venue</label>
                  <select
                    value={selectedVenueId}
                    onChange={(e) => setSelectedVenueId(e.target.value)}
                    className="arena-select w-full"
                  >
                    <option value="none">No Venue Assigned</option>
                    {venues.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.city || 'No city'})
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingNewVenue(true)}
                  className="text-xs text-[#14966B] hover:underline font-semibold"
                >
                  + Add A New Venue
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200/80">
                  <span className="text-xs font-bold text-[#0F172A] uppercase">Create New Venue</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreatingNewVenue(false);
                      setSelectedVenueId('none');
                    }}
                    className="text-xs text-[#64748B] hover:text-[#0F172A] font-medium"
                  >
                    Cancel
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#334155] mb-1.5">Venue Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Delhi Sports Arena"
                      value={newVenueName}
                      onChange={(e) => setNewVenueName(e.target.value)}
                      className="arena-input w-full"
                    />
                    {errors.venue_name && <p className="text-xs text-[#C94A4A] mt-1">{errors.venue_name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334155] mb-1.5">Address</label>
                    <input
                      type="text"
                      placeholder="Street, Area"
                      value={newVenueAddress}
                      onChange={(e) => setNewVenueAddress(e.target.value)}
                      className="arena-input w-full"
                    />
                    {errors.venue_address && <p className="text-xs text-[#C94A4A] mt-1">{errors.venue_address}</p>}
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-[#334155] mb-1.5">City</label>
                    <input
                      type="text"
                      placeholder="e.g. Delhi"
                      value={newVenueCity}
                      onChange={(e) => setNewVenueCity(e.target.value)}
                      className="arena-input w-full"
                    />
                    {errors.venue_city && <p className="text-xs text-[#C94A4A] mt-1">{errors.venue_city}</p>}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#334155] mb-1.5">Country</label>
                    <input
                      type="text"
                      placeholder="e.g. India"
                      value={newVenueCountry}
                      onChange={(e) => setNewVenueCountry(e.target.value)}
                      className="arena-input w-full"
                    />
                    {errors.venue_country && <p className="text-xs text-[#C94A4A] mt-1">{errors.venue_country}</p>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Timeline & Dates */}
          <div className="pro-card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#0F172A] border-b border-slate-200/80 pb-2.5">
              Timeline & Schedule
            </h2>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">Start Date *</label>
                <input
                  type="date"
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="arena-input w-full"
                />
                {errors.start_date && <p className="text-xs text-[#C94A4A] mt-1">{errors.start_date}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">End Date *</label>
                <input
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="arena-input w-full"
                />
                {errors.end_date && <p className="text-xs text-[#C94A4A] mt-1">{errors.end_date}</p>}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">Registration Open Date *</label>
                <input
                  type="date"
                  required
                  value={registrationOpen}
                  onChange={(e) => setRegistrationOpen(e.target.value)}
                  className="arena-input w-full"
                />
                {errors.registration_open && <p className="text-xs text-[#C94A4A] mt-1">{errors.registration_open}</p>}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#334155] mb-1.5">Registration Close Date *</label>
                <input
                  type="date"
                  required
                  value={registrationClose}
                  onChange={(e) => setRegistrationClose(e.target.value)}
                  className="arena-input w-full"
                />
                {errors.registration_close && <p className="text-xs text-[#C94A4A] mt-1">{errors.registration_close}</p>}
              </div>
            </div>
          </div>

          {/* Basic Rules & Policies */}
          <div className="pro-card p-6 space-y-4">
            <h2 className="text-base font-bold text-[#0F172A] border-b border-slate-200/80 pb-2.5">
              Rules & Guidelines
            </h2>

            <div>
              <label className="block text-xs font-semibold text-[#334155] mb-1.5">Rules & Notes</label>
              <textarea
                rows={4}
                placeholder="Specific ground rules, scoring modes, match setups..."
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                className="arena-textarea w-full"
              />
              {errors.rules && <p className="text-xs text-[#C94A4A] mt-1">{errors.rules}</p>}
            </div>
          </div>

          <div className="flex space-x-3 justify-end pt-2">
            <button
              type="button"
              onClick={() => router.back()}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Creating...' : 'Create Tournament'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
