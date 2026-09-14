import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  sanitizeSpreadsheetCell,
  formatCSVCell,
  sanitizeFilename,
  generateCSV,
  generateXLSX,
  generatePDF,
  buildParticipantsReportData,
  buildScheduleReportData,
  buildResultsReportData,
  buildStandingsReportData,
  buildDrawReportData,
  buildTournamentSummaryReportData,
  buildMatchScoreSheetReportData,
  exportTournamentReport,
  ReportTableData
} from '../src/services/reports';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4Mzg3NjgwMH0.placeholder';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4NzY4MDB9.placeholder';

describe('Feature 6: Export / Reporting Test Suite', () => {
  let adminClient: SupabaseClient;
  let anonClient: SupabaseClient;

  // Mock Tournament Data for deterministic unit & domain tests
  const mockTournament = {
    id: 'tourney-test-101',
    name: 'ArenaFlow All-Star Championship',
    slug: 'arenaflow-allstar',
    status: 'PUBLISHED',
    start_date: '2026-09-10T09:00:00Z',
    end_date: '2026-09-15T18:00:00Z',
    registration_open: '2026-08-01T00:00:00Z',
    registration_close: '2026-09-05T23:59:59Z',
    sports: { id: 'sport-1', name: 'Badminton' },
    venues: { id: 'venue-1', name: 'National Sports Arena', address: '1 Olympic Way', city: 'London' }
  };

  const mockCategories = [
    { id: 'cat-singles', name: "Men's Singles", category_type: 'SINGLES', format: 'KNOCKOUT', match_type: 'MENS' },
    { id: 'cat-doubles', name: "Mixed Doubles", category_type: 'DOUBLES', format: 'ROUND_ROBIN', match_type: 'MIXED' }
  ];

  const mockCourts = [
    { id: 'court-1', name: 'Court 1', venue_id: 'venue-1', status: 'ACTIVE' },
    { id: 'court-2', name: 'Court 2', venue_id: 'venue-1', status: 'ACTIVE' }
  ];

  const mockParticipants = [
    {
      id: 'part-1',
      category_id: 'cat-singles',
      seed: 1,
      status: 'ACTIVE',
      participant_type: 'INDIVIDUAL',
      members: [{ player: { id: 'p1', full_name: 'Viktor Axelsen', display_name: 'V. Axelsen' } }]
    },
    {
      id: 'part-2',
      category_id: 'cat-singles',
      seed: 2,
      status: 'ACTIVE',
      participant_type: 'INDIVIDUAL',
      members: [{ player: { id: 'p2', full_name: 'Lee Zii Jia', display_name: 'Lee Z. J.' } }]
    },
    {
      id: 'part-3',
      category_id: 'cat-singles',
      seed: null,
      status: 'ACTIVE',
      participant_type: 'INDIVIDUAL',
      members: [{ player: { id: 'p3', full_name: '=cmd|’ /C calc’!A0', display_name: 'Formula Player' } }] // Security test payload
    },
    {
      id: 'part-4',
      category_id: 'cat-doubles',
      seed: 1,
      status: 'ACTIVE',
      participant_type: 'TEAM',
      members: [
        { player: { id: 'p4', full_name: 'Zheng Siwei', display_name: 'Zheng S.' } },
        { player: { id: 'p5', full_name: 'Huang Yaqiong', display_name: 'Huang Y.' } }
      ]
    },
    {
      id: 'part-5',
      category_id: 'cat-doubles',
      seed: 2,
      status: 'ACTIVE',
      participant_type: 'TEAM',
      members: [
        { player: { id: 'p6', full_name: 'Yuta Watanabe', display_name: 'Y. Watanabe' } },
        { player: { id: 'p7', full_name: 'Arisa Higashino', display_name: 'A. Higashino' } }
      ]
    }
  ];

  const mockMatches = [
    {
      id: 'match-1',
      category_id: 'cat-singles',
      round_name: 'Finals',
      match_order: 1,
      court_id: 'court-1',
      court_name: 'Court 1',
      scheduled_at: '2026-09-15T14:00:00Z',
      status: 'COMPLETED',
      outcome: 'COMPLETED',
      duration_minutes: 45,
      participant_a_id: 'part-1',
      participant_b_id: 'part-2',
      winner_id: 'part-1',
      participant_a: mockParticipants[0],
      participant_b: mockParticipants[1],
      games: [
        { id: 'g1', game_number: 1, participant_a_score: 21, participant_b_score: 18, status: 'COMPLETED', winner_id: 'part-1' },
        { id: 'g2', game_number: 2, participant_a_score: 21, participant_b_score: 19, status: 'COMPLETED', winner_id: 'part-1' }
      ]
    },
    {
      id: 'match-2',
      category_id: 'cat-singles',
      round_name: 'Semifinals',
      match_order: 2,
      court_id: 'court-2',
      scheduled_at: '2026-09-14T10:00:00Z',
      status: 'COMPLETED',
      outcome: 'WALKOVER',
      duration_minutes: 0,
      participant_a_id: 'part-2',
      participant_b_id: 'part-3',
      winner_id: 'part-2',
      participant_a: mockParticipants[1],
      participant_b: mockParticipants[2],
      games: []
    },
    {
      id: 'match-3',
      category_id: 'cat-doubles',
      round_name: 'Group A - Match 1',
      match_order: 3,
      court_id: 'court-1',
      scheduled_at: '2026-09-12T11:00:00Z',
      status: 'COMPLETED',
      outcome: 'RETIREMENT',
      duration_minutes: 32,
      participant_a_id: 'part-4',
      participant_b_id: 'part-5',
      winner_id: 'part-4',
      participant_a: mockParticipants[3],
      participant_b: mockParticipants[4],
      games: [
        { id: 'g3', game_number: 1, participant_a_score: 21, participant_b_score: 15, status: 'COMPLETED', winner_id: 'part-4' },
        { id: 'g4', game_number: 2, participant_a_score: 11, participant_b_score: 7, status: 'COMPLETED', winner_id: 'part-4' }
      ]
    }
  ];

  before(() => {
    adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  });

  // ==========================================================================
  // SECTION 1: SPREADSHEET FORMULA INJECTION & CSV ESCAPING
  // ==========================================================================
  describe('1. Spreadsheet Sanitization & CSV Encoding', () => {
    test('sanitizes formula injection prefixes (=, +, -, @) with leading apostrophe', () => {
      assert.strictEqual(sanitizeSpreadsheetCell('=1+1'), "'=1+1");
      assert.strictEqual(sanitizeSpreadsheetCell('+cmd|calc'), "'+cmd|calc");
      assert.strictEqual(sanitizeSpreadsheetCell('-5+2'), "'-5+2");
      assert.strictEqual(sanitizeSpreadsheetCell('@SUM(A1:A10)'), "'@SUM(A1:A10)");
      assert.strictEqual(sanitizeSpreadsheetCell('Normal Name'), 'Normal Name');
      assert.strictEqual(sanitizeSpreadsheetCell(42), 42);
      assert.strictEqual(sanitizeSpreadsheetCell(null), '');
      assert.strictEqual(sanitizeSpreadsheetCell(undefined), '');
    });

    test('formatCSVCell handles commas, quotes, newlines, and RFC 4180 escaping', () => {
      assert.strictEqual(formatCSVCell('Simple Text'), 'Simple Text');
      assert.strictEqual(formatCSVCell('Text, with comma'), '"Text, with comma"');
      assert.strictEqual(formatCSVCell('Text with "quotes"'), '"Text with ""quotes"""');
      assert.strictEqual(formatCSVCell("Line 1\nLine 2"), '"Line 1\nLine 2"');
      // Formula injection inside CSV
      assert.strictEqual(formatCSVCell('=cmd|calc'), "'=cmd|calc");
      assert.strictEqual(formatCSVCell('=cmd, calc'), '"\'=cmd, calc"');
    });

    test('sanitizeFilename removes illegal characters and path traversals', () => {
      assert.strictEqual(sanitizeFilename('badminton/tournament:2026?*'), 'badminton_tournament_2026_');
      assert.strictEqual(sanitizeFilename('valid-file_name.csv'), 'valid-file_name.csv');
    });
  });

  // ==========================================================================
  // SECTION 2: CORE FORMAT GENERATION (CSV, XLSX, PDF)
  // ==========================================================================
  describe('2. Core Format Generators (CSV, XLSX, PDF)', () => {
    const sampleTable: ReportTableData = {
      title: 'Sample Championship Report',
      subtitle: 'Official Report',
      metadata: { Tournament: 'Sample Tournament', Date: '2026-09-06' },
      headers: ['Rank', 'Name', 'Score'],
      rows: [
        [1, 'Player One', 100],
        [2, 'Player Two', 85],
        [3, '=SUM(1,2)', 70]
      ],
      summarySections: [
        {
          title: 'Metrics',
          items: [
            { label: 'Total Players', value: 3 },
            { label: 'Avg Score', value: 85 }
          ]
        }
      ]
    };

    test('generateCSV generates valid UTF-8 BOM CSV with RFC 4180 format', () => {
      const csv = generateCSV(sampleTable);
      assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM');
      assert.ok(csv.includes('# Sample Championship Report'));
      assert.ok(csv.includes('Rank,Name,Score'));
      assert.ok(csv.includes('1,Player One,100'));
      assert.ok(csv.includes("3,\"'=SUM(1,2)\",70"), 'Formula cell must be sanitized and quoted');
    });

    test('generateXLSX produces a valid Uint8Array Excel binary workbook', () => {
      const xlsxBuffer = generateXLSX(sampleTable, 'Standings');
      assert.ok(xlsxBuffer instanceof Uint8Array);
      assert.ok(xlsxBuffer.length > 100, 'XLSX buffer should contain zip package structure');
      // Verify ZIP/PK signature (0x50, 0x4B, 0x03, 0x04)
      assert.strictEqual(xlsxBuffer[0], 0x50);
      assert.strictEqual(xlsxBuffer[1], 0x4b);
    });

    test('generatePDF produces a valid Uint8Array PDF binary buffer', () => {
      const pdfBuffer = generatePDF(sampleTable);
      assert.ok(pdfBuffer instanceof Uint8Array);
      assert.ok(pdfBuffer.length > 500);
      const pdfHeader = Buffer.from(pdfBuffer.slice(0, 5)).toString('ascii');
      assert.strictEqual(pdfHeader, '%PDF-');
    });
  });

  // ==========================================================================
  // SECTION 3: DOMAIN REPORT BUILDERS (ALL 7 TYPES)
  // ==========================================================================
  describe('3. Domain Report Data Builders', () => {
    test('3.1 Participants Report Data Builder handles seeds, types, and sorting', () => {
      const report = buildParticipantsReportData(mockTournament, mockCategories, mockParticipants, [], 'ALL');
      assert.strictEqual(report.title, 'Participants & Registrations — ArenaFlow All-Star Championship');
      assert.strictEqual(report.rows.length, 5);
      // Verify singles participant
      const p1Row = report.rows.find(r => r[2] === 'V. Axelsen');
      assert.ok(p1Row);
      assert.strictEqual(p1Row[1], "Men's Singles");
      assert.strictEqual(p1Row[6], 'Seed 1');
      // Verify doubles participant
      const p4Row = report.rows.find(r => r[2] === 'Zheng S. & Huang Y.');
      assert.ok(p4Row);
      assert.strictEqual(p4Row[1], 'Mixed Doubles');
      assert.strictEqual(p4Row[4], 'Zheng Siwei');
      assert.strictEqual(p4Row[5], 'Huang Yaqiong');
    });

    test('3.2 Match Schedule Report Data Builder handles court and time formatting', () => {
      const report = buildScheduleReportData(mockTournament, mockCategories, mockMatches, [], mockCourts, 'ALL');
      assert.strictEqual(report.rows.length, 3);
      const m1Row = report.rows.find(r => r[0] === 1);
      assert.ok(m1Row);
      assert.strictEqual(m1Row[1], "Men's Singles");
      assert.strictEqual(m1Row[3], 'V. Axelsen');
      assert.strictEqual(m1Row[4], 'Lee Z. J.');
      assert.strictEqual(m1Row[5], '2026-09-15');
      assert.strictEqual(m1Row[6], '14:00');
      assert.strictEqual(m1Row[7], 'Court 1');
    });

    test('3.3 Match Results Report Data Builder handles Walkover & Retirement correctly without fake scores', () => {
      const report = buildResultsReportData(mockTournament, mockCategories, mockMatches, [], mockCourts, 'ALL');
      assert.strictEqual(report.rows.length, 3);
      // Match 1: Completed standard score
      const m1 = report.rows.find(r => r[0] === 1);
      assert.ok(m1);
      assert.strictEqual(m1[6], 'COMPLETED');
      assert.strictEqual(m1[7], '21-18, 21-19');
      // Match 2: Walkover
      const m2 = report.rows.find(r => r[0] === 2);
      assert.ok(m2);
      assert.strictEqual(m2[6], 'WALKOVER');
      assert.strictEqual(m2[7], 'WALKOVER', 'Must not fabricate 21-0 scores for Walkovers');
      // Match 3: Retirement
      const m3 = report.rows.find(r => r[0] === 3);
      assert.ok(m3);
      assert.strictEqual(m3[6], 'RETIREMENT');
      assert.strictEqual(m3[7], '21-15, 11-7 (RET)');
    });

    test('3.4 Standings Report Data Builder integrates 1:1 with statistics-engine', () => {
      const report = buildStandingsReportData(mockTournament, mockCategories, mockParticipants, mockMatches, 'ALL');
      assert.ok(report.rows.length > 0);
      assert.ok(report.categoryBreakdowns && report.categoryBreakdowns.length > 0);
      // Winner of singles match (part-1) must have 1 win
      const part1Standing = report.rows.find(r => r[2] === 'V. Axelsen');
      assert.ok(part1Standing);
      assert.strictEqual(part1Standing[3], 1); // Played
      assert.strictEqual(part1Standing[4], 1); // Won
      assert.strictEqual(part1Standing[5], 0); // Lost
    });

    test('3.5 Draw / Bracket Report Data Builder produces complete node hierarchy', () => {
      const mockCategory = mockCategories[0];
      const mockDraw = { id: 'draw-1', category_id: mockCategory.id, format: 'KNOCKOUT' };
      const mockRounds = [{ id: 'rnd-1', draw_id: 'draw-1', round_number: 1, name: 'Finals' }];
      const mockDrawNodes = [
        {
          id: 'node-1',
          draw_id: 'draw-1',
          round_id: 'rnd-1',
          round_number: 1,
          position: 1,
          match_id: 'match-1',
          match_index: 0,
          next_node_index: null
        }
      ];

      const report = buildDrawReportData(mockTournament, mockCategory, mockDraw, mockRounds, mockDrawNodes, mockMatches);
      assert.strictEqual(report.rows.length, 1);
      assert.strictEqual(report.rows[0][0], 'Finals');
      assert.strictEqual(report.rows[0][3], 'V. Axelsen');
      assert.strictEqual(report.rows[0][4], 'Lee Z. J.');
      assert.strictEqual(report.rows[0][5], 'V. Axelsen');
      assert.strictEqual(report.rows[0][6], 'Finals (Champion)');
    });

    test('3.6 Tournament Summary Report Data Builder aggregates KPIs via calculateTournamentStats', () => {
      const report = buildTournamentSummaryReportData(
        mockTournament,
        mockCategories,
        mockParticipants,
        [],
        mockMatches,
        [],
        mockCourts
      );
      assert.ok(report.summarySections && report.summarySections.length === 2);
      const kpis = report.summarySections[1].items;
      const totalMatches = kpis.find(k => k.label === 'Total Matches')?.value;
      const completedMatches = kpis.find(k => k.label === 'Completed Matches')?.value;
      const walkovers = kpis.find(k => k.label === 'Walkovers')?.value;
      const retirements = kpis.find(k => k.label === 'Retirements')?.value;

      assert.strictEqual(totalMatches, 3);
      assert.strictEqual(completedMatches, 3);
      assert.strictEqual(walkovers, 1);
      assert.strictEqual(retirements, 1);
    });

    test('3.7 Match Score Sheet Report Data Builder exports complete games breakdown', () => {
      const report = buildMatchScoreSheetReportData(
        mockTournament,
        mockCategories[0],
        mockMatches[0],
        mockMatches[0].games,
        []
      );
      assert.strictEqual(report.title, 'Official Match Score Sheet');
      assert.strictEqual(report.rows.length, 2);
      assert.strictEqual(report.rows[0][0], 1);
      assert.strictEqual(report.rows[0][1], 21);
      assert.strictEqual(report.rows[0][2], 18);
      assert.strictEqual(report.rows[0][3], 'V. Axelsen');
    });
  });

  // ==========================================================================
  // SECTION 4: EXPORT ORCHESTRATOR & EDGE CASES
  // ==========================================================================
  describe('4. Export Orchestrator & Edge Cases', () => {
    test('exportTournamentReport orchestrates all formats cleanly', () => {
      const sampleTable = buildParticipantsReportData(mockTournament, mockCategories, mockParticipants, []);
      
      const csvExport = exportTournamentReport(sampleTable, 'csv', 'tourney_participants');
      assert.strictEqual(csvExport.filename, 'tourney_participants.csv');
      assert.strictEqual(csvExport.mimeType, 'text/csv;charset=utf-8;');

      const xlsxExport = exportTournamentReport(sampleTable, 'xlsx', 'tourney_participants');
      assert.strictEqual(xlsxExport.filename, 'tourney_participants.xlsx');
      assert.strictEqual(xlsxExport.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      const pdfExport = exportTournamentReport(sampleTable, 'pdf', 'tourney_participants');
      assert.strictEqual(pdfExport.filename, 'tourney_participants.pdf');
      assert.strictEqual(pdfExport.mimeType, 'application/pdf');
    });

    test('Handles Unicode player names, empty datasets, and special chars without crash', () => {
      const unicodeParticipants = [
        {
          id: 'u1',
          category_id: 'cat-singles',
          participant_type: 'INDIVIDUAL',
          members: [{ player: { id: 'up1', full_name: '李宗伟 (Lee Chong Wei)' } }]
        },
        {
          id: 'u2',
          category_id: 'cat-singles',
          participant_type: 'INDIVIDUAL',
          members: [{ player: { id: 'up2', full_name: 'Björn Borg (Accented)' } }]
        }
      ];

      const report = buildParticipantsReportData(mockTournament, mockCategories, unicodeParticipants, []);
      const csv = generateCSV(report);
      assert.ok(csv.includes('李宗伟 (Lee Chong Wei)'));
      assert.ok(csv.includes('Björn Borg (Accented)'));

      const xlsx = generateXLSX(report);
      assert.ok(xlsx.length > 0);

      const pdf = generatePDF(report);
      assert.ok(pdf.length > 0);
    });
  });

  // ==========================================================================
  // SECTION 5: DATABASE NON-MUTATION VERIFICATION
  // ==========================================================================
  describe('5. Database Non-Mutation Guarantee (Read-Only Safety)', () => {
    test('Database records remain 100% unchanged before and after exports', async () => {
      const getCounts = async () => {
        const [{ count: tCount }, { count: cCount }, { count: pCount }, { count: mCount }, { count: gCount }] = await Promise.all([
          adminClient.from('tournaments').select('*', { count: 'exact', head: true }),
          adminClient.from('categories').select('*', { count: 'exact', head: true }),
          adminClient.from('participants').select('*', { count: 'exact', head: true }),
          adminClient.from('matches').select('*', { count: 'exact', head: true }),
          adminClient.from('games').select('*', { count: 'exact', head: true })
        ]);
        return { tCount, cCount, pCount, mCount, gCount };
      };

      const countsBefore = await getCounts();

      // Run all 7 exports in all 3 formats
      const allBuilders = [
        () => buildParticipantsReportData(mockTournament, mockCategories, mockParticipants, []),
        () => buildScheduleReportData(mockTournament, mockCategories, mockMatches, [], mockCourts),
        () => buildResultsReportData(mockTournament, mockCategories, mockMatches, [], mockCourts),
        () => buildStandingsReportData(mockTournament, mockCategories, mockParticipants, mockMatches),
        () => buildTournamentSummaryReportData(mockTournament, mockCategories, mockParticipants, [], mockMatches, [], mockCourts)
      ];

      for (const builder of allBuilders) {
        const data = builder();
        generateCSV(data);
        generateXLSX(data);
        generatePDF(data);
      }

      const countsAfter = await getCounts();

      assert.deepStrictEqual(countsBefore, countsAfter, 'Database table counts must remain strictly identical (0 mutations)');
    });
  });
});
