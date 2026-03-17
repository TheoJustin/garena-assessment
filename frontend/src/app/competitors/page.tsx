import { Pool } from 'pg';
import CompetitorTable from './competitor-table';

export const dynamic = 'force-dynamic';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default async function CompetitorsPage() {
  let initialData = [];

  try {
    // Query ALL data once
    const { rows } = await pool.query(
      'SELECT * FROM competitor_analysis ORDER BY competitor_name ASC, id DESC',
    );
    initialData = rows;
  } catch (error) {
    console.error('Failed to fetch data:', error);
  }

  // Pass the raw data into our interactive Client Component
  return <CompetitorTable initialData={initialData} />;
}
