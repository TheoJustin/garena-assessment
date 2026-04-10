import { pool } from '@/lib/db';
import CompetitorTable from './competitor-table';

export const dynamic = 'force-dynamic';

export default async function CompetitorsPage() {
  let initialData = [];
  let tableReady = true; // ADD THIS

  try {
    const { rows } = await pool.query(
      'SELECT * FROM competitor_analysis ORDER BY competitor_name ASC, id DESC',
    );
    initialData = rows;
  } catch (error: any) {
    // Postgres error code 42P01 = "undefined_table"
    if (error.code === '42P01') {
      tableReady = false; // Table doesn't exist yet
    } else {
      console.error('Failed to fetch data:', error);
    }
  }

  return <CompetitorTable initialData={initialData} tableReady={tableReady} />;
}
