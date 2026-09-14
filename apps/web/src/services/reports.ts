import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  calculateStandings,
  calculateTournamentStats,
  StandingEntry,
  TournamentStats
} from '@arena-flow/statistics-engine';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export type ReportType =
  | 'participants'
  | 'schedule'
  | 'results'
  | 'standings'
  | 'draw'
  | 'summary'
  | 'score_sheet';

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface ReportTableData {
  title: string;
  subtitle?: string;
  metadata?: Record<string, string>;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  summarySections?: {
    title: string;
    items: { label: string; value: string | number }[];
  }[];
  categoryBreakdowns?: {
    categoryName: string;
    headers: string[];
    rows: (string | number | null | undefined)[][];
  }[];
}

// ============================================================================
// SECURITY & SANITIZATION UTILITIES
// ============================================================================

/**
 * Sanitizes cell values to prevent CSV / Spreadsheet Formula Injection (CSV Injection).
 * If a cell string starts with '=', '+', '-', or '@', it is escaped with a leading apostrophe.
 */
export function sanitizeSpreadsheetCell(value: any): any {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  const str = String(value);
  if (str.length > 0 && ['=', '+', '-', '@'].includes(str[0])) {
    return `'${str}`;
  }
  return str;
}

/**
 * Encodes a CSV field according to RFC 4180:
 * - Sanitizes formula injection
 * - Wraps fields containing commas, double quotes, or newlines in quotes
 * - Escapes internal quotes by doubling them (""")
 */
export function formatCSVCell(value: any): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (str.length > 0 && ['=', '+', '-', '@'].includes(str[0])) {
    str = `'${str}`;
  }
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Sanitizes file names for safe filesystem and browser downloads.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').replace(/_+/g, '_');
}

// ============================================================================
// FORMAT-SPECIFIC GENERATORS
// ============================================================================

/**
 * Generates a standard UTF-8 CSV string with BOM for Excel compatibility.
 */
export function generateCSV(table: ReportTableData): string {
  const lines: string[] = [];

  // Title and metadata header comments
  if (table.title) {
    lines.push(`# ${table.title}`);
  }
  if (table.subtitle) {
    lines.push(`# ${table.subtitle}`);
  }
  if (table.metadata) {
    for (const [k, v] of Object.entries(table.metadata)) {
      lines.push(`# ${k}: ${v}`);
    }
  }
  if (table.title || table.metadata) {
    lines.push('');
  }

  // Summary sections if present
  if (table.summarySections && table.summarySections.length > 0) {
    for (const sec of table.summarySections) {
      lines.push(`--- ${sec.title} ---`);
      for (const item of sec.items) {
        lines.push(`${formatCSVCell(item.label)},${formatCSVCell(item.value)}`);
      }
      lines.push('');
    }
  }

  // Main table headers and rows
  if (table.headers && table.headers.length > 0) {
    lines.push(table.headers.map(formatCSVCell).join(','));
    for (const row of table.rows) {
      lines.push(row.map(formatCSVCell).join(','));
    }
  }

  // Category breakdowns if present
  if (table.categoryBreakdowns && table.categoryBreakdowns.length > 0) {
    for (const cat of table.categoryBreakdowns) {
      lines.push('');
      lines.push(`--- Category: ${cat.categoryName} ---`);
      lines.push(cat.headers.map(formatCSVCell).join(','));
      for (const row of cat.rows) {
        lines.push(row.map(formatCSVCell).join(','));
      }
    }
  }

  // Return with UTF-8 BOM
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Generates a clean Excel XLSX workbook binary buffer.
 */
export function generateXLSX(table: ReportTableData, sheetName = 'Report'): Uint8Array {
  const wb = XLSX.utils.book_new();

  const dataMatrix: any[][] = [];

  // Title & Metadata
  if (table.title) {
    dataMatrix.push([table.title]);
  }
  if (table.subtitle) {
    dataMatrix.push([table.subtitle]);
  }
  if (table.metadata) {
    for (const [k, v] of Object.entries(table.metadata)) {
      dataMatrix.push([k, v]);
    }
  }
  if (table.title || table.metadata) {
    dataMatrix.push([]);
  }

  // Summary sections
  if (table.summarySections && table.summarySections.length > 0) {
    for (const sec of table.summarySections) {
      dataMatrix.push([`[ ${sec.title} ]`]);
      for (const item of sec.items) {
        dataMatrix.push([sanitizeSpreadsheetCell(item.label), sanitizeSpreadsheetCell(item.value)]);
      }
      dataMatrix.push([]);
    }
  }

  // Main Table
  if (table.headers && table.headers.length > 0) {
    dataMatrix.push(table.headers.map(sanitizeSpreadsheetCell));
    for (const row of table.rows) {
      dataMatrix.push(row.map(sanitizeSpreadsheetCell));
    }
  }

  // Category breakdowns
  if (table.categoryBreakdowns && table.categoryBreakdowns.length > 0) {
    for (const cat of table.categoryBreakdowns) {
      dataMatrix.push([]);
      dataMatrix.push([`[ Category: ${cat.categoryName} ]`]);
      dataMatrix.push(cat.headers.map(sanitizeSpreadsheetCell));
      for (const row of cat.rows) {
        dataMatrix.push(row.map(sanitizeSpreadsheetCell));
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(dataMatrix);

  // Auto-fit column widths
  const colWidths = dataMatrix.reduce<number[]>((acc, row) => {
    row.forEach((cell, idx) => {
      const len = cell ? String(cell).length : 0;
      acc[idx] = Math.max(acc[idx] || 10, Math.min(len + 4, 40));
    });
    return acc;
  }, []);
  ws['!cols'] = colWidths.map(w => ({ wch: w }));

  XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));

  // Write as binary array
  const output = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(output);
}

/**
 * Generates a printable PDF document with professional typography, headers, and footers.
 */
export function generatePDF(
  table: ReportTableData,
  options: { landscape?: boolean } = {}
): Uint8Array {
  const doc = new jsPDF({
    orientation: options.landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  // Header Banner
  doc.setFillColor(20, 150, 107); // Emerald Green #14966B
  doc.rect(0, 0, pageWidth, 8, 'F');

  let currentY = 36;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(24, 32, 47); // Dark Slate
  doc.text(table.title || 'ArenaFlow Tournament Report', margin, currentY);
  currentY += 16;

  // Subtitle
  if (table.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(90, 105, 120);
    doc.text(table.subtitle, margin, currentY);
    currentY += 14;
  }

  // Metadata Grid
  if (table.metadata && Object.keys(table.metadata).length > 0) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 110, 125);
    const metaEntries = Object.entries(table.metadata);
    let metaX = margin;
    for (let i = 0; i < metaEntries.length; i++) {
      const [k, v] = metaEntries[i];
      doc.text(`${k}: ${v}`, metaX, currentY);
      metaX += 160;
      if (metaX > pageWidth - margin - 100 || (i + 1) % 3 === 0) {
        metaX = margin;
        currentY += 12;
      }
    }
    currentY += 10;
  }

  // Summary sections
  if (table.summarySections && table.summarySections.length > 0) {
    for (const sec of table.summarySections) {
      if (currentY > pageHeight - 100) {
        doc.addPage();
        currentY = 40;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(20, 150, 107);
      doc.text(sec.title, margin, currentY);
      currentY += 10;

      const summaryRows = sec.items.map(i => [i.label, String(i.value)]);
      autoTable(doc, {
        startY: currentY,
        head: [['Metric', 'Value']],
        body: summaryRows,
        margin: { left: margin, right: margin },
        theme: 'striped',
        headStyles: { fillColor: [240, 245, 243], textColor: [20, 150, 107], fontStyle: 'bold', fontSize: 9 },
        bodyStyles: { fontSize: 8.5, textColor: [30, 40, 55] },
        styles: { cellPadding: 4 }
      });
      currentY = (doc as any).lastAutoTable.finalY + 18;
    }
  }

  // Main Table
  if (table.headers && table.headers.length > 0 && table.rows.length > 0) {
    if (currentY > pageHeight - 120) {
      doc.addPage();
      currentY = 40;
    }

    autoTable(doc, {
      startY: currentY,
      head: [table.headers],
      body: table.rows.map(r => r.map(c => (c === null || c === undefined ? '' : String(c)))),
      margin: { left: margin, right: margin },
      theme: 'striped',
      headStyles: {
        fillColor: [24, 32, 47],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5
      },
      bodyStyles: { fontSize: 8, textColor: [30, 40, 55] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { cellPadding: 5, overflow: 'linebreak' }
    });

    currentY = (doc as any).lastAutoTable.finalY + 18;
  }

  // Category Breakdowns
  if (table.categoryBreakdowns && table.categoryBreakdowns.length > 0) {
    for (const cat of table.categoryBreakdowns) {
      if (currentY > pageHeight - 120) {
        doc.addPage();
        currentY = 40;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(24, 32, 47);
      doc.text(`Category: ${cat.categoryName}`, margin, currentY);
      currentY += 8;

      autoTable(doc, {
        startY: currentY,
        head: [cat.headers],
        body: cat.rows.map(r => r.map(c => (c === null || c === undefined ? '' : String(c)))),
        margin: { left: margin, right: margin },
        theme: 'striped',
        headStyles: { fillColor: [45, 60, 80], textColor: [255, 255, 255], fontSize: 8 },
        bodyStyles: { fontSize: 7.5, textColor: [30, 40, 55] },
        styles: { cellPadding: 4 }
      });

      currentY = (doc as any).lastAutoTable.finalY + 16;
    }
  }

  // Footer: Page numbering and timestamp
  const totalPages = (doc.internal as any).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(150, 160, 175);
    doc.text(
      `Generated by ArenaFlow • ${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`,
      margin,
      pageHeight - 16
    );
    doc.text(
      `Page ${i} of ${totalPages}`,
      pageWidth - margin - 50,
      pageHeight - 16
    );
  }

  const pdfOutput = doc.output('arraybuffer');
  return new Uint8Array(pdfOutput);
}

// ============================================================================
// DOMAIN REPORT BUILDERS
// ============================================================================

export function getParticipantDisplayName(participant: any): string {
  if (!participant) return 'TBD (Waiting)';
  if (participant.display_name) return participant.display_name;
  if (participant.name) return participant.name;
  if (participant.members && Array.isArray(participant.members) && participant.members.length > 0) {
    return participant.members
      .map((m: any) => m.player?.display_name || m.player?.full_name || 'Player')
      .join(' & ');
  }
  return 'TBD (Waiting)';
}

/**
 * 1. Participants / Registrations Report
 */
export function buildParticipantsReportData(
  tournament: any,
  categories: any[],
  participants: any[],
  registrations: any[] = [],
  categoryIdFilter = 'ALL'
): ReportTableData {
  const filteredCats = categoryIdFilter === 'ALL'
    ? categories
    : categories.filter(c => c.id === categoryIdFilter);

  const catMap = new Map<string, any>(categories.map(c => [c.id, c]));

  let targetParticipants = participants || [];
  if (categoryIdFilter !== 'ALL') {
    targetParticipants = targetParticipants.filter(p => p.category_id === categoryIdFilter);
  }

  // Sort deterministically: Category -> Seed (if present) -> Name
  targetParticipants.sort((a, b) => {
    const catA = catMap.get(a.category_id)?.name || '';
    const catB = catMap.get(b.category_id)?.name || '';
    if (catA !== catB) return catA.localeCompare(catB);
    const nameA = getParticipantDisplayName(a);
    const nameB = getParticipantDisplayName(b);
    return nameA.localeCompare(nameB);
  });

  const headers = [
    '#',
    'Category',
    'Participant Name',
    'Type',
    'Player 1',
    'Player 2',
    'Seed',
    'Status',
    'Registered At'
  ];

  const rows = targetParticipants.map((p, idx) => {
    const cat = catMap.get(p.category_id);
    const members = p.members || [];
    const p1 = members[0]?.player?.full_name || members[0]?.player?.display_name || '';
    const p2 = members[1]?.player?.full_name || members[1]?.player?.display_name || '';
    const seedStr = p.seed ? `Seed ${p.seed}` : 'Unseeded';

    // Find registration timestamp if available
    const reg = registrations.find(r => r.participant_id === p.id);
    const regDate = reg?.created_at ? new Date(reg.created_at).toISOString().substring(0, 10) : 'N/A';

    return [
      idx + 1,
      cat?.name || 'Unknown',
      getParticipantDisplayName(p),
      p.participant_type || (cat?.category_type === 'DOUBLES' ? 'TEAM' : 'INDIVIDUAL'),
      p1 || 'N/A',
      p2 || (cat?.category_type === 'DOUBLES' ? 'None' : 'N/A'),
      seedStr,
      p.status || 'ACTIVE',
      regDate
    ];
  });

  return {
    title: `Participants & Registrations — ${tournament?.name || 'Tournament'}`,
    subtitle: `Total Participants: ${targetParticipants.length} | Category Filter: ${categoryIdFilter === 'ALL' ? 'All Categories' : catMap.get(categoryIdFilter)?.name || categoryIdFilter}`,
    metadata: {
      Tournament: tournament?.name || '',
      Status: tournament?.status || '',
      Dates: `${tournament?.start_date?.substring(0, 10) || ''} to ${tournament?.end_date?.substring(0, 10) || ''}`,
      Exported: new Date().toISOString().substring(0, 19) + ' UTC'
    },
    headers,
    rows
  };
}

/**
 * 2. Match Schedule Report
 */
export function buildScheduleReportData(
  tournament: any,
  categories: any[],
  matches: any[],
  venues: any[] = [],
  courts: any[] = [],
  categoryIdFilter = 'ALL'
): ReportTableData {
  const catMap = new Map<string, any>(categories.map(c => [c.id, c]));
  const courtMap = new Map<string, any>(courts.map(c => [c.id, c]));
  const venueMap = new Map<string, any>(venues.map(v => [v.id, v]));

  let targetMatches = matches || [];
  if (categoryIdFilter !== 'ALL') {
    targetMatches = targetMatches.filter(m => m.category_id === categoryIdFilter);
  }

  // Sort deterministically: Category -> Round -> Match Order -> Scheduled Time
  targetMatches.sort((a, b) => {
    const catA = catMap.get(a.category_id)?.name || '';
    const catB = catMap.get(b.category_id)?.name || '';
    if (catA !== catB) return catA.localeCompare(catB);
    const ordA = a.match_order ?? a.position ?? 0;
    const ordB = b.match_order ?? b.position ?? 0;
    return ordA - ordB;
  });

  const headers = [
    'Match #',
    'Category',
    'Round',
    'Side A',
    'Side B',
    'Scheduled Date',
    'Time',
    'Court',
    'Status',
    'Winner / Outcome'
  ];

  const rows = targetMatches.map((m, idx) => {
    const cat = catMap.get(m.category_id);
    const sideA = getParticipantDisplayName(m.participant_a);
    const sideB = getParticipantDisplayName(m.participant_b);
    const court = courtMap.get(m.court_id)?.name || m.court_name || 'Unassigned';

    let schedDate = 'TBD';
    let schedTime = 'TBD';
    if (m.scheduled_at) {
      const dt = new Date(m.scheduled_at);
      schedDate = dt.toISOString().substring(0, 10);
      schedTime = dt.toISOString().substring(11, 16);
    }

    let winnerOutcome = 'Pending';
    if (m.status === 'COMPLETED' || m.status === 'FINAL') {
      const winnerName = m.winner_id === m.participant_a_id ? sideA : m.winner_id === m.participant_b_id ? sideB : 'Completed';
      winnerOutcome = m.outcome && m.outcome !== 'COMPLETED' ? `${winnerName} (${m.outcome})` : winnerName;
    }

    return [
      m.match_order || idx + 1,
      cat?.name || 'Unknown',
      m.round_name || m.round?.name || `Round ${m.round_number || 1}`,
      sideA,
      sideB,
      schedDate,
      schedTime,
      court,
      m.status,
      winnerOutcome
    ];
  });

  return {
    title: `Match Schedule — ${tournament?.name || 'Tournament'}`,
    subtitle: `Total Scheduled Matches: ${targetMatches.length}`,
    metadata: {
      Tournament: tournament?.name || '',
      Venue: venueMap.get(tournament?.venue_id)?.name || tournament?.venues?.name || 'Primary Venue',
      Generated: new Date().toISOString().substring(0, 19) + ' UTC'
    },
    headers,
    rows
  };
}

/**
 * 3. Match Results Report
 */
export function buildResultsReportData(
  tournament: any,
  categories: any[],
  matches: any[],
  venues: any[] = [],
  courts: any[] = [],
  categoryIdFilter = 'ALL'
): ReportTableData {
  const catMap = new Map<string, any>(categories.map(c => [c.id, c]));
  const courtMap = new Map<string, any>(courts.map(c => [c.id, c]));

  let targetMatches = (matches || []).filter(m => m.status === 'COMPLETED' || m.status === 'FINAL' || m.status === 'LIVE');
  if (categoryIdFilter !== 'ALL') {
    targetMatches = targetMatches.filter(m => m.category_id === categoryIdFilter);
  }

  // Sort deterministically: Category -> Match Order
  targetMatches.sort((a, b) => {
    const catA = catMap.get(a.category_id)?.name || '';
    const catB = catMap.get(b.category_id)?.name || '';
    if (catA !== catB) return catA.localeCompare(catB);
    return (a.match_order || 0) - (b.match_order || 0);
  });

  const headers = [
    'Match #',
    'Category',
    'Round',
    'Side A',
    'Side B',
    'Winner',
    'Outcome',
    'Game Scores',
    'Duration',
    'Status'
  ];

  const rows = targetMatches.map((m, idx) => {
    const cat = catMap.get(m.category_id);
    const sideA = getParticipantDisplayName(m.participant_a);
    const sideB = getParticipantDisplayName(m.participant_b);
    const winnerName = m.winner_id === m.participant_a_id ? sideA : m.winner_id === m.participant_b_id ? sideB : 'N/A';

    // Format game scores accurately according to outcome rules
    let scoreStr = 'N/A';
    if (m.outcome === 'WALKOVER' || m.outcome === 'DEFAULT') {
      scoreStr = m.outcome; // DO NOT fabricate fake 21-0 scores for Walkover/Default
    } else if (m.games && Array.isArray(m.games) && m.games.length > 0) {
      const gameParts = m.games.map((g: any) => {
        const sA = g.participant_a_score ?? g.score_a ?? g.scoreA ?? 0;
        const sB = g.participant_b_score ?? g.score_b ?? g.scoreB ?? 0;
        return `${sA}-${sB}`;
      });
      scoreStr = gameParts.join(', ');
      if (m.outcome === 'RETIREMENT') {
        scoreStr += ' (RET)';
      }
    } else if (m.score_a !== null && m.score_a !== undefined && m.score_b !== null && m.score_b !== undefined) {
      scoreStr = `${m.score_a}-${m.score_b}`;
      if (m.shootout_score?.score_a !== undefined && m.shootout_score?.score_b !== undefined) {
        scoreStr += ` (${m.shootout_score.score_a}-${m.shootout_score.score_b} pen)`;
      }
      if (m.outcome === 'RETIREMENT' || m.outcome === 'ABANDONED') {
        scoreStr += ` (${m.outcome})`;
      }
    }

    const durationStr = m.duration_minutes ? `${m.duration_minutes} mins` : 'N/A';

    return [
      m.match_order || idx + 1,
      cat?.name || 'Unknown',
      m.round_name || m.round?.name || `Round ${m.round_number || 1}`,
      sideA,
      sideB,
      winnerName,
      m.outcome || 'COMPLETED',
      scoreStr,
      durationStr,
      m.status
    ];
  });

  return {
    title: `Match Results — ${tournament?.name || 'Tournament'}`,
    subtitle: `Total Recorded Results: ${targetMatches.length}`,
    metadata: {
      Tournament: tournament?.name || '',
      Status: tournament?.status || '',
      Generated: new Date().toISOString().substring(0, 19) + ' UTC'
    },
    headers,
    rows
  };
}

/**
 * 4. Standings Report (Integrated with @arena-flow/statistics-engine)
 */
export function buildStandingsReportData(
  tournament: any,
  categories: any[],
  participants: any[],
  matches: any[],
  categoryIdFilter = 'ALL'
): ReportTableData {
  const catMap = new Map<string, any>(categories.map(c => [c.id, c]));
  const targetCategories = categoryIdFilter === 'ALL'
    ? categories
    : categories.filter(c => c.id === categoryIdFilter);

  const headers = [
    'Rank',
    'Category',
    'Participant',
    'Played (P)',
    'Won (W)',
    'Lost (L)',
    'Games Won (GW)',
    'Games Lost (GL)',
    'Game Diff (GD)',
    'Points For (PF)',
    'Points Against (PA)',
    'Point Diff (PD)',
    'Win %'
  ];

  const allRows: any[][] = [];
  const categoryBreakdowns: { categoryName: string; headers: string[]; rows: any[][] }[] = [];

  for (const cat of targetCategories) {
    const catParticipants = (participants || []).filter(p => p.category_id === cat.id);
    const catMatches = (matches || []).filter(m => m.category_id === cat.id);

    if (catParticipants.length === 0) continue;

    // Use authoritative statistics-engine
    const standingsResult = calculateStandings(catParticipants, catMatches);
    const sortedEntries = standingsResult.sortedEntries || [];

    const partMap = new Map<string, any>(catParticipants.map(p => [p.id, p]));

    const catRows = sortedEntries.map((entry) => {
      const p = partMap.get(entry.participant_id);
      const name = p ? getParticipantDisplayName(p) : entry.participant_id;
      const winPct = (entry.win_percentage || entry.winPercentage || (entry.played > 0 ? (entry.won / entry.played) * 100 : 0)).toFixed(1) + '%';

      return [
        entry.rank,
        cat.name,
        name,
        entry.played,
        entry.won,
        entry.lost,
        entry.games_won ?? entry.gamesWon ?? 0,
        entry.games_lost ?? entry.gamesLost ?? 0,
        entry.games_diff ?? entry.gameDifference ?? ((entry.games_won ?? 0) - (entry.games_lost ?? 0)),
        entry.points_for ?? entry.pointsFor ?? 0,
        entry.points_against ?? entry.pointsAgainst ?? 0,
        entry.points_diff ?? entry.pointDifference ?? ((entry.points_for ?? 0) - (entry.points_against ?? 0)),
        winPct
      ];
    });

    allRows.push(...catRows);
    categoryBreakdowns.push({
      categoryName: cat.name,
      headers,
      rows: catRows
    });
  }

  return {
    title: `Standings & Rankings — ${tournament?.name || 'Tournament'}`,
    subtitle: `Computed via ArenaFlow Statistics Engine`,
    metadata: {
      Tournament: tournament?.name || '',
      Status: tournament?.status || '',
      Generated: new Date().toISOString().substring(0, 19) + ' UTC'
    },
    headers,
    rows: allRows,
    categoryBreakdowns
  };
}

/**
 * 5. Draw / Bracket Report
 */
export function buildDrawReportData(
  tournament: any,
  category: any,
  draw: any,
  rounds: any[] = [],
  drawNodes: any[] = [],
  matches: any[] = []
): ReportTableData {
  const catMatches = matches.filter(m => m.category_id === category?.id);
  const matchMap = new Map<string, any>(catMatches.map(m => [m.id, m]));

  const headers = [
    'Round',
    'Match Index',
    'Position',
    'Side A (Seed/Name)',
    'Side B (Seed/Name)',
    'Winner Advanced',
    'Next Round Target',
    'Status',
    'Outcome'
  ];

  // Sort nodes deterministically by round_number, position
  const sortedNodes = [...drawNodes].sort((a, b) => {
    if (a.round_number !== b.round_number) return a.round_number - b.round_number;
    return a.position - b.position;
  });

  const rows = sortedNodes.map((node, idx) => {
    const match = node.match_id ? matchMap.get(node.match_id) : catMatches[node.match_index];
    const roundObj = rounds.find(r => r.id === node.round_id || r.round_number === node.round_number);
    const roundName = roundObj?.name || `Round ${node.round_number}`;

    const sideA = match?.participant_a ? getParticipantDisplayName(match.participant_a) : (node.participant_a_name || 'TBD / BYE');
    const sideB = match?.participant_b ? getParticipantDisplayName(match.participant_b) : (node.participant_b_name || 'TBD / BYE');

    let winnerName = 'TBD';
    if (match?.winner_id) {
      winnerName = match.winner_id === match.participant_a_id ? sideA : sideB;
    }

    const nextTarget = node.next_node_index !== null && node.next_node_index !== undefined ? `Node #${node.next_node_index}` : 'Finals (Champion)';

    return [
      roundName,
      node.match_index ?? idx + 1,
      node.position,
      sideA,
      sideB,
      winnerName,
      nextTarget,
      match?.status || 'SCHEDULED',
      match?.outcome || 'PENDING'
    ];
  });

  return {
    title: `Draw & Bracket — ${tournament?.name || 'Tournament'}`,
    subtitle: `Category: ${category?.name || 'All'} | Format: ${draw?.format || category?.format || 'KNOCKOUT'}`,
    metadata: {
      Category: category?.name || '',
      Format: draw?.format || category?.format || 'KNOCKOUT',
      TotalNodes: String(drawNodes.length),
      Generated: new Date().toISOString().substring(0, 19) + ' UTC'
    },
    headers,
    rows
  };
}

/**
 * 6. Tournament Summary Report
 */
export function buildTournamentSummaryReportData(
  tournament: any,
  categories: any[] = [],
  participants: any[] = [],
  registrations: any[] = [],
  matches: any[] = [],
  venues: any[] = [],
  courts: any[] = []
): ReportTableData {
  // Use authoritative statistics engine to aggregate totals
  const stats: TournamentStats = calculateTournamentStats({ matches, categories, courts });

  const completedMatches = matches.filter(m => m.status === 'COMPLETED' || m.status === 'FINAL');
  const walkovers = matches.filter(m => m.outcome === 'WALKOVER').length;
  const defaults = matches.filter(m => m.outcome === 'DEFAULT').length;
  const retirements = matches.filter(m => m.outcome === 'RETIREMENT').length;
  const approvedRegs = registrations.filter(r => r.status === 'APPROVED').length;

  const summarySections = [
    {
      title: 'Tournament Overview',
      items: [
        { label: 'Tournament Name', value: tournament?.name || 'ArenaFlow Tournament' },
        { label: 'Status', value: tournament?.status || 'PUBLISHED' },
        { label: 'Sport', value: tournament?.sports?.name || 'Badminton' },
        { label: 'Venue', value: tournament?.venues?.name || 'Primary Venue' },
        { label: 'Start Date', value: tournament?.start_date?.substring(0, 10) || 'N/A' },
        { label: 'End Date', value: tournament?.end_date?.substring(0, 10) || 'N/A' },
        { label: 'Total Categories', value: categories.length },
        { label: 'Total Participants', value: participants.length },
        { label: 'Approved Registrations', value: approvedRegs },
        { label: 'Assigned Courts', value: courts.length }
      ]
    },
    {
      title: 'Match Operations & Performance',
      items: [
        { label: 'Total Matches', value: stats.totalMatches },
        { label: 'Completed Matches', value: stats.completedMatches },
        { label: 'Live / In-Progress Matches', value: stats.liveMatches },
        { label: 'Scheduled / Upcoming Matches', value: stats.scheduledMatches },
        { label: 'Walkovers', value: walkovers },
        { label: 'Defaults', value: defaults },
        { label: 'Retirements', value: retirements },
        { label: 'Total Games Played', value: stats.totalGames },
        { label: 'Total Points Scored', value: stats.totalPoints },
        { label: 'Avg Points / Match', value: stats.averagePointsPerMatch.toFixed(1) }
      ]
    }
  ];

  // Category breakdown table
  const catHeaders = ['Category Name', 'Type', 'Format', 'Total Matches', 'Completed', 'Live', 'Scheduled', 'Total Points'];
  const catRows = (stats.categoryStats || []).map(cs => [
    cs.categoryName || cs.categoryId,
    categories.find(c => c.id === cs.categoryId)?.category_type || 'SINGLES',
    categories.find(c => c.id === cs.categoryId)?.format || 'KNOCKOUT',
    cs.totalMatches,
    cs.completedMatches,
    cs.liveMatches,
    cs.scheduledMatches,
    cs.totalPoints
  ]);

  return {
    title: `Tournament Summary — ${tournament?.name || 'Tournament'}`,
    subtitle: `Comprehensive Operational Snapshot`,
    metadata: {
      Generated: new Date().toISOString().substring(0, 19) + ' UTC',
      Organizer: tournament?.organizer?.full_name || 'Tournament Director'
    },
    headers: catHeaders,
    rows: catRows,
    summarySections
  };
}

/**
 * 7. Individual Match Score Sheet Report
 */
export function buildMatchScoreSheetReportData(
  tournament: any,
  category: any,
  match: any,
  games: any[] = [],
  matchEvents: any[] = []
): ReportTableData {
  const sideA = getParticipantDisplayName(match.participant_a);
  const sideB = getParticipantDisplayName(match.participant_b);
  const winnerName = match.winner_id === match.participant_a_id ? sideA : match.winner_id === match.participant_b_id ? sideB : 'Pending';

  const summarySections = [
    {
      title: 'Match Details',
      items: [
        { label: 'Tournament', value: tournament?.name || 'Tournament' },
        { label: 'Category', value: category?.name || 'Main Event' },
        { label: 'Round', value: match.round_name || match.round?.name || 'Round 1' },
        { label: 'Match Order', value: match.match_order || 1 },
        { label: 'Court', value: match.court_name || 'Court 1' },
        { label: 'Match Status', value: match.status },
        { label: 'Outcome', value: match.outcome || 'COMPLETED' },
        { label: 'Winner', value: winnerName }
      ]
    }
  ];

  // Games table
  const headers = ['Game #', `Side A (${sideA})`, `Side B (${sideB})`, 'Winner', 'Status'];
  const rows = (games || []).map((g: any, idx) => {
    const sA = g.participant_a_score ?? g.score_a ?? g.scoreA ?? 0;
    const sB = g.participant_b_score ?? g.score_b ?? g.scoreB ?? 0;
    let gWinner = 'In Progress';
    if (g.status === 'COMPLETED' || g.isCompleted) {
      gWinner = sA > sB ? sideA : sideB;
    }
    return [
      g.game_number || idx + 1,
      sA,
      sB,
      gWinner,
      g.status || (g.isCompleted ? 'COMPLETED' : 'LIVE')
    ];
  });

  return {
    title: `Official Match Score Sheet`,
    subtitle: `${sideA} vs ${sideB}`,
    metadata: {
      Tournament: tournament?.name || '',
      Category: category?.name || '',
      Court: match.court_name || 'Court 1',
      MatchID: match.id,
      Generated: new Date().toISOString().substring(0, 19) + ' UTC'
    },
    headers,
    rows,
    summarySections
  };
}

// ============================================================================
// EXPORT ORCHESTRATOR & DOWNLOAD TRIGGER
// ============================================================================

export function exportTournamentReport(
  tableData: ReportTableData,
  format: ExportFormat,
  filenameBase: string
): { filename: string; mimeType: string; content: string | Uint8Array } {
  const cleanBase = sanitizeFilename(filenameBase);

  switch (format) {
    case 'csv': {
      const csvStr = generateCSV(tableData);
      return {
        filename: `${cleanBase}.csv`,
        mimeType: 'text/csv;charset=utf-8;',
        content: csvStr
      };
    }
    case 'xlsx': {
      const xlsxBuffer = generateXLSX(tableData, 'Report');
      return {
        filename: `${cleanBase}.xlsx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: xlsxBuffer
      };
    }
    case 'pdf': {
      const pdfBuffer = generatePDF(tableData, { landscape: tableData.headers.length > 7 });
      return {
        filename: `${cleanBase}.pdf`,
        mimeType: 'application/pdf',
        content: pdfBuffer
      };
    }
  }
}

/**
 * Triggers a browser file download for client-side generated files.
 */
export function triggerBrowserDownload(
  content: string | Uint8Array,
  filename: string,
  mimeType: string
): void {
  if (typeof window === 'undefined') return;

  const blob = content instanceof Uint8Array
    ? new Blob([content as any], { type: mimeType })
    : new Blob([content], { type: mimeType });

  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  }, 200);
}
