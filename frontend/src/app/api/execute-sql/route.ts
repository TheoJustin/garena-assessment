import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export async function POST(req: Request) {
  try {
    const { sql } = await req.json();

    if (!sql) {
      return NextResponse.json({ error: 'No SQL provided' }, { status: 400 });
    }

    // 1. Ensure the table exists with the NEW pdf_name column
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS competitor_analysis (
          id SERIAL PRIMARY KEY,
          competitor_name VARCHAR(255),
          feature_name VARCHAR(255),
          price VARCHAR(255),
          advantages TEXT,
          disadvantages TEXT,
          pdf_name VARCHAR(255)
      );
    `;

    // Execute table creation
    await pool.query(createTableQuery);

    // 2. Execute the generated INSERT statements
    await pool.query(sql);

    return NextResponse.json({
      success: true,
      message: 'Data inserted successfully',
    });
  } catch (error) {
    console.error('Database execution error:', error);
    return NextResponse.json(
      { error: 'Failed to execute SQL', details: (error as Error).message },
      { status: 500 },
    );
  }
}
