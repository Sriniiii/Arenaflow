import { GET } from '../src/app/api/tournaments/[slug]/export/route';
import { NextRequest } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = value;
      }
    });
  }
}
loadEnv();

async function run() {
  console.log('Testing Route Handler GET function directly...');

  const slug = 'arenaflow-e2e-1788246848510';
  const tests = [
    { type: 'results', format: 'csv' },
    { type: 'results', format: 'xlsx' },
    { type: 'results', format: 'pdf' },
    { type: 'standings', format: 'csv' },
    { type: 'standings', format: 'xlsx' },
    { type: 'standings', format: 'pdf' },
    { type: 'schedule', format: 'csv' },
    { type: 'schedule', format: 'xlsx' },
    { type: 'schedule', format: 'pdf' }
  ];

  for (const t of tests) {
    const url = `http://localhost:3000/api/tournaments/${slug}/export?type=${t.type}&format=${t.format}`;
    const req = new NextRequest(url);
    const res = await GET(req, { params: Promise.resolve({ slug }) });
    const buffer = await res.arrayBuffer();
    console.log(`[HTTP ${res.status}] ${t.type.padEnd(12)} (${t.format.padEnd(4)}) -> Size: ${String(buffer.byteLength).padStart(6)} bytes | Content-Type: ${res.headers.get('content-type')} | Disposition: ${res.headers.get('content-disposition')}`);
  }
}

run();
