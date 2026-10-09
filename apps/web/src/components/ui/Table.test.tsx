// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Table, type TableColumn } from './Table';

interface StandingRow {
  manager: string;
  wins: number;
  potShare: string;
}

const columns: TableColumn<StandingRow>[] = [
  { key: 'manager', header: 'Manager' },
  { key: 'wins', header: 'W', numeric: true },
  { key: 'potShare', header: 'Pot share', numeric: true },
];

const rows: StandingRow[] = [
  { manager: 'Dov Amado', wins: 4, potShare: '$41.25' },
  { manager: 'Marge Kowalski', wins: 2, potShare: '$17.50' },
];

describe('Table', () => {
  it('renders headers, rows, and cells', () => {
    render(<Table caption="Standings" columns={columns} rows={rows} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Manager' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Dov Amado' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '4' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 body rows
    expect(screen.getByText('Standings')).toBeInTheDocument();
  });

  it('marks numeric columns so numerals can go mono', () => {
    render(<Table columns={columns} rows={rows} />);
    expect(screen.getByRole('columnheader', { name: 'Pot share' })).toHaveClass('sh-table__num');
    expect(screen.getByRole('cell', { name: '$41.25' })).toHaveClass('sh-table__num');
    expect(screen.getByRole('columnheader', { name: 'Manager' })).not.toHaveClass('sh-table__num');
  });
});
