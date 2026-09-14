import { z } from 'zod';

export const tournamentSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters').max(100),
  description: z.string().max(1000).optional().or(z.literal('')),
  sport_id: z.string().uuid('Invalid Sport ID'),
  venue_id: z.string().uuid('Invalid Venue ID').nullable().optional(),
  start_date: z.string().refine(val => !isNaN(Date.parse(val)), { message: "Invalid start date" }),
  end_date: z.string().refine(val => !isNaN(Date.parse(val)), { message: "Invalid end date" }),
  registration_open: z.string().refine(val => !isNaN(Date.parse(val)), { message: "Invalid registration open date" }),
  registration_close: z.string().refine(val => !isNaN(Date.parse(val)), { message: "Invalid registration close date" }),
  status: z.enum(['DRAFT', 'PUBLISHED', 'COMPLETED', 'CANCELLED']).default('DRAFT'),
  rules: z.string().optional().or(z.literal('')),
}).refine(data => Date.parse(data.end_date) >= Date.parse(data.start_date), {
  message: "End date must be on or after start date",
  path: ["end_date"]
}).refine(data => Date.parse(data.registration_close) > Date.parse(data.registration_open), {
  message: "Registration closing date must be after opening date",
  path: ["registration_close"]
}).refine(data => Date.parse(data.registration_close) <= Date.parse(data.start_date), {
  message: "Registration closing date must be on or before tournament start date",
  path: ["registration_close"]
});

export const footballCategoryRulesConfigSchema = z.object({
  regulationHalfMinutes: z.number().int().positive('Regulation half duration must be greater than 0').default(45),
  extraTimeEnabled: z.boolean().default(false),
  extraTimeHalfMinutes: z.number().int().nonnegative('Extra time half duration cannot be negative').default(15),
  penaltyShootoutEnabled: z.boolean().default(false),
  maxSubstitutions: z.number().int().nonnegative('Max substitutions cannot be negative').default(5),
  allowDraw: z.boolean().default(true),
  playersPerTeam: z.number().int().positive('Players per team must be greater than 0').default(11),
  pointsPerWin: z.number().int().nonnegative().default(3),
  pointsPerDraw: z.number().int().nonnegative().default(1),
  pointsPerLoss: z.number().int().nonnegative().default(0),
  tieBreakOrder: z.array(z.string()).optional(),
}).refine(data => {
  if (data.extraTimeEnabled && data.extraTimeHalfMinutes <= 0) {
    return false;
  }
  return true;
}, {
  message: 'Extra time half duration must be greater than 0 when extra time is enabled',
  path: ['extraTimeHalfMinutes']
});

export const categorySchema = z.object({
  name: z.string().min(3, 'Category name must be at least 3 characters').max(100),
  category_type: z.enum(['SINGLES', 'DOUBLES', 'TEAM']),
  match_type: z.enum(['MENS', 'WOMENS', 'MIXED', 'OPEN']).default('OPEN'),
  format: z.enum(['KNOCKOUT', 'ROUND_ROBIN', 'GROUP_KNOCKOUT']),
  age_group: z.string().min(2).max(20).optional().or(z.literal('')),
  skill_level: z.string().min(2).max(30).optional().or(z.literal('')),
  max_participants: z.number().int().positive('Max participants must be positive').optional().nullable(),
  registration_fee: z.number().nonnegative('Registration fee must be positive').default(0),
  rules_config: footballCategoryRulesConfigSchema.optional().nullable(),
});

export const venueSchema = z.object({
  name: z.string().min(3, 'Venue name must be at least 3 characters').max(100),
  address: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
});

export const courtSchema = z.object({
  name: z.string().min(1, 'Court name cannot be empty').max(50),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const participantSchema = z.object({
  category_id: z.string().uuid(),
  participant_type: z.enum(['INDIVIDUAL', 'TEAM']),
  seed: z.number().int().positive().optional().nullable(),
  player_ids: z.array(z.string().uuid()),
}).refine(data => {
  if (data.participant_type === 'INDIVIDUAL') {
    return data.player_ids.length === 1;
  }
  // TEAM participant: supports doubles (2) or multi-player squads (up to 50)
  return data.player_ids.length >= 1 && data.player_ids.length <= 50;
}, {
  message: 'Invalid number of squad members for participant',
  path: ['player_ids']
});

export const footballLineupSchema = z.object({
  match_id: z.string().uuid(),
  team: z.enum(['A', 'B']),
  starting_xi: z.array(z.string().uuid()).length(11, 'Starting XI must contain exactly 11 players'),
  substitutes: z.array(z.string().uuid()).max(39, 'Substitutes cannot exceed squad capacity'),
  captain_id: z.string().uuid().optional().nullable(),
  positions: z.record(z.string(), z.string()).optional(),
}).refine(data => {
  const set = new Set(data.starting_xi);
  return set.size === data.starting_xi.length;
}, {
  message: 'Starting XI contains duplicate players',
  path: ['starting_xi']
}).refine(data => {
  const subSet = new Set(data.substitutes);
  if (subSet.size !== data.substitutes.length) return false;
  return !data.substitutes.some(sub => data.starting_xi.includes(sub));
}, {
  message: 'Player cannot be listed as both starter and substitute',
  path: ['substitutes']
}).refine(data => {
  if (data.captain_id) {
    return data.starting_xi.includes(data.captain_id);
  }
  return true;
}, {
  message: 'Captain must be in the starting XI',
  path: ['captain_id']
});

export const registrationSchema = z.object({
  category_id: z.string().uuid(),
  participant_id: z.string().uuid(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine(data => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

