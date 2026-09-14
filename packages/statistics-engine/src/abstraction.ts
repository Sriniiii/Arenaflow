import {
  MatchDataInput,
  BadmintonAnalytics,
  FootballAnalytics,
} from './types';
import { calculateBadmintonAnalytics } from './badminton';
import { calculateFootballAnalytics } from './football';

/**
 * Generic Interface for Sport-Specific Analytics Providers
 */
export interface ISportAnalyticsProvider<TAnalytics = any> {
  sportSlug: string;
  sportName: string;
  calculateAnalytics(matches: MatchDataInput[]): TAnalytics;
}

/**
 * Built-in Badminton Analytics Provider
 */
export class BadmintonAnalyticsProvider implements ISportAnalyticsProvider<BadmintonAnalytics> {
  sportSlug = 'badminton';
  sportName = 'Badminton';

  calculateAnalytics(matches: MatchDataInput[]): BadmintonAnalytics {
    return calculateBadmintonAnalytics(matches);
  }
}

/**
 * Built-in Football Analytics Provider
 */
export class FootballAnalyticsProvider implements ISportAnalyticsProvider<FootballAnalytics> {
  sportSlug = 'football';
  sportName = 'Football';

  calculateAnalytics(matches: MatchDataInput[]): FootballAnalytics {
    return calculateFootballAnalytics(matches);
  }
}

/**
 * Sport Analytics Registry
 */
export class SportAnalyticsRegistry {
  private static providers = new Map<string, ISportAnalyticsProvider>();

  static {
    // Register default providers
    const badminton = new BadmintonAnalyticsProvider();
    const football = new FootballAnalyticsProvider();
    this.register(badminton);
    this.register(football);
  }

  static register(provider: ISportAnalyticsProvider): void {
    this.providers.set(provider.sportSlug.toLowerCase(), provider);
  }

  static get(sportSlug: string): ISportAnalyticsProvider | undefined {
    return this.providers.get(sportSlug.toLowerCase());
  }

  static calculateSportAnalytics(sportSlug: string, matches: MatchDataInput[]): any {
    const provider = this.get(sportSlug);
    if (!provider) return null;
    return provider.calculateAnalytics(matches);
  }

  static getSupportedSports(): string[] {
    return Array.from(this.providers.keys());
  }
}
