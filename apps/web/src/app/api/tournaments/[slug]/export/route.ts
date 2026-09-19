import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  ReportType,
  ExportFormat,
  buildParticipantsReportData,
  buildScheduleReportData,
  buildResultsReportData,
  buildStandingsReportData,
  buildDrawReportData,
  buildTournamentSummaryReportData,
  buildMatchScoreSheetReportData,
  exportTournamentReport,
  sanitizeFilename
} from '@/services/reports';
import { getNormalizedSupabaseUrl, getNormalizedSupabaseKey } from '@/services/supabase';

const supabaseUrl = getNormalizedSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = getNormalizedSupabaseKey(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ? getNormalizedSupabaseKey(process.env.SUPABASE_SERVICE_ROLE_KEY) : supabaseAnonKey;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const url = new URL(request.url);
    const reportType = (url.searchParams.get('type') || url.searchParams.get('report_type') || 'summary') as ReportType;
    const format = (url.searchParams.get('format') || 'csv').toLowerCase() as ExportFormat;
    const categoryId = url.searchParams.get('category_id') || 'ALL';
    const matchId = url.searchParams.get('match_id');

    if (!['csv', 'xlsx', 'pdf'].includes(format)) {
      return NextResponse.json({ error: 'Invalid format. Supported formats: csv, xlsx, pdf' }, { status: 400 });
    }

    const validReportTypes: ReportType[] = [
      'participants',
      'schedule',
      'results',
      'standings',
      'draw',
      'summary',
      'score_sheet'
    ];

    if (!validReportTypes.includes(reportType)) {
      return NextResponse.json(
        { error: `Invalid report type. Supported types: ${validReportTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // Extract authorization token if provided
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.replace('Bearer ', '');

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    let currentUserId: string | null = null;
    let currentUserRole: string | null = null;

    if (token) {
      const { data: userData } = await supabase.auth.getUser(token);
      if (userData?.user) {
        currentUserId = userData.user.id;
        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', currentUserId)
          .single();
        currentUserRole = profile?.role || 'PLAYER';
      }
    }

    // 1. Fetch Tournament by slug or ID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug);
    let tourneyQuery = supabase
      .from('tournaments')
      .select('*, sports(id, name), venues(id, name)');

    if (isUUID) {
      tourneyQuery = tourneyQuery.or(`slug.eq.${slug},id.eq.${slug}`);
    } else {
      tourneyQuery = tourneyQuery.eq('slug', slug);
    }

    const { data: tournament, error: tourneyErr } = await tourneyQuery.single();

    if (tourneyErr || !tournament) {
      return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
    }

    // 2. Authorization check for private reports
    const isPublicReport = ['results', 'standings', 'schedule', 'draw'].includes(reportType);
    const isOrganizer = currentUserId && (currentUserId === tournament.organizer_id || currentUserRole === 'ADMIN');

    if (!isPublicReport && !isOrganizer) {
      // Check if user is a designated scorer for this tournament
      let isScorer = false;
      if (currentUserId) {
        const { data: scorerRel } = await supabase
          .from('tournament_scorers')
          .select('id')
          .eq('tournament_id', tournament.id)
          .eq('user_id', currentUserId)
          .single();
        if (scorerRel) isScorer = true;
      }

      if (!isScorer) {
        return NextResponse.json(
          { error: 'Forbidden. Private reports require organizer or administrator access.' },
          { status: 403 }
        );
      }
    }

    // 3. Fetch Categories
    const { data: categoriesData } = await supabase
      .from('categories')
      .select('*')
      .eq('tournament_id', tournament.id);
    const categories = categoriesData || [];
    const catIds = categories.map(c => c.id);

    let reportTableData;
    let baseFilename = `${tournament.slug || tournament.name}_${reportType}`;

    switch (reportType) {
      case 'participants': {
        const { data: participantsData } = await supabase
          .from('participants')
          .select(`
            id,
            category_id,
            participant_type,
            status,
            seed,
            members: participant_members (
              player: players ( id, full_name, display_name )
            )
          `)
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        const { data: registrationsData } = await supabase
          .from('registrations')
          .select('*')
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        reportTableData = buildParticipantsReportData(
          tournament,
          categories,
          participantsData || [],
          registrationsData || [],
          categoryId
        );
        break;
      }

      case 'schedule': {
        const { data: matchesData } = await supabase
          .from('matches')
          .select(`
            *,
            participant_a: participants!matches_participant_a_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            participant_b: participants!matches_participant_b_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            court: courts ( id, name )
          `)
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        const { data: courtsData } = await supabase
          .from('courts')
          .select('*')
          .eq('venue_id', tournament.venue_id || '');

        reportTableData = buildScheduleReportData(
          tournament,
          categories,
          matchesData || [],
          [],
          courtsData || [],
          categoryId
        );
        break;
      }

      case 'results': {
        const { data: matchesData } = await supabase
          .from('matches')
          .select(`
            *,
            participant_a: participants!matches_participant_a_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            participant_b: participants!matches_participant_b_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            games ( id, game_number, participant_a_score, participant_b_score, status, winner_id )
          `)
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        reportTableData = buildResultsReportData(
          tournament,
          categories,
          matchesData || [],
          [],
          [],
          categoryId
        );
        break;
      }

      case 'standings': {
        const { data: participantsData } = await supabase
          .from('participants')
          .select(`
            id,
            category_id,
            participant_type,
            status,
            members: participant_members (
              player: players ( id, full_name, display_name )
            )
          `)
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        const { data: matchesData } = await supabase
          .from('matches')
          .select(`
            *,
            games ( id, game_number, participant_a_score, participant_b_score, status, winner_id )
          `)
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        reportTableData = buildStandingsReportData(
          tournament,
          categories,
          participantsData || [],
          matchesData || [],
          categoryId
        );
        break;
      }

      case 'draw': {
        const targetCategory = categoryId !== 'ALL'
          ? categories.find(c => c.id === categoryId)
          : categories[0];

        if (!targetCategory) {
          return NextResponse.json({ error: 'No category found for draw report' }, { status: 400 });
        }

        const { data: drawData } = await supabase
          .from('draws')
          .select('*')
          .eq('category_id', targetCategory.id)
          .single();

        const { data: roundsData } = await supabase
          .from('rounds')
          .select('*')
          .eq('draw_id', drawData?.id || '00000000-0000-0000-0000-000000000000');

        const { data: drawNodesData } = await supabase
          .from('draw_nodes')
          .select('*')
          .eq('draw_id', drawData?.id || '00000000-0000-0000-0000-000000000000');

        const { data: matchesData } = await supabase
          .from('matches')
          .select(`
            *,
            participant_a: participants!matches_participant_a_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            participant_b: participants!matches_participant_b_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            )
          `)
          .eq('category_id', targetCategory.id);

        reportTableData = buildDrawReportData(
          tournament,
          targetCategory,
          drawData,
          roundsData || [],
          drawNodesData || [],
          matchesData || []
        );
        baseFilename = `${tournament.slug || tournament.name}_draw_${targetCategory.name}`;
        break;
      }

      case 'summary': {
        const { data: participantsData } = await supabase
          .from('participants')
          .select('*')
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        const { data: registrationsData } = await supabase
          .from('registrations')
          .select('*')
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        const { data: matchesData } = await supabase
          .from('matches')
          .select(`
            *,
            games ( id, game_number, participant_a_score, participant_b_score, status, winner_id )
          `)
          .in('category_id', catIds.length > 0 ? catIds : ['00000000-0000-0000-0000-000000000000']);

        const { data: courtsData } = await supabase
          .from('courts')
          .select('*')
          .eq('venue_id', tournament.venue_id || '');

        reportTableData = buildTournamentSummaryReportData(
          tournament,
          categories,
          participantsData || [],
          registrationsData || [],
          matchesData || [],
          [],
          courtsData || []
        );
        break;
      }

      case 'score_sheet': {
        if (!matchId) {
          return NextResponse.json({ error: 'match_id parameter is required for score_sheet report' }, { status: 400 });
        }

        const { data: matchData, error: mErr } = await supabase
          .from('matches')
          .select(`
            *,
            category: categories (*),
            participant_a: participants!matches_participant_a_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            participant_b: participants!matches_participant_b_id_fkey (
              id,
              members: participant_members ( player: players ( id, full_name, display_name ) )
            ),
            games ( id, game_number, participant_a_score, participant_b_score, status, winner_id )
          `)
          .eq('id', matchId)
          .single();

        if (mErr || !matchData) {
          return NextResponse.json({ error: 'Match not found' }, { status: 404 });
        }

        const { data: eventsData } = await supabase
          .from('match_events')
          .select('*')
          .eq('match_id', matchId)
          .order('sequence_number', { ascending: true });

        reportTableData = buildMatchScoreSheetReportData(
          tournament,
          matchData.category,
          matchData,
          matchData.games || [],
          eventsData || []
        );
        baseFilename = `${tournament.slug || tournament.name}_match_${matchData.match_order || matchData.id}_scoresheet`;
        break;
      }
    }

    const { filename, mimeType, content } = exportTournamentReport(
      reportTableData,
      format,
      baseFilename
    );

    const responseBody = typeof content === 'string' ? content : Buffer.from(content);

    return new NextResponse(responseBody as any, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error: any) {
    console.error('Export API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error during report generation' },
      { status: 500 }
    );
  }
}
