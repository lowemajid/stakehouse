import './ui.css';

export interface TableColumn<Row> {
  key: keyof Row & string;
  header: string;
  /** Numeric cells get tabular mono numerals, right-aligned. */
  numeric?: boolean;
}

export interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  caption?: string;
  className?: string;
}

/** Data table with a felt-700 head; numeric columns render in mono. */
export function Table<Row extends object>({ columns, rows, caption, className }: TableProps<Row>) {
  const classes = ['sh-table', className].filter(Boolean).join(' ');
  return (
    <table className={classes}>
      {caption ? <caption className="sh-table__caption">{caption}</caption> : null}
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.key}
              scope="col"
              className={column.numeric ? 'sh-table__num' : undefined}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column.key} className={column.numeric ? 'sh-table__num' : undefined}>
                {String(row[column.key])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
