// Fixture list without content: scripts/pages-print-check.cjs imports it with
// Node's type stripping, so it must stay dependency-free. `perfOnly` fixtures
// are left out of the print check unless named with --only.
export const PAGES_FIXTURES_META = [
  { id: '01', title: 'Long prose', landscape: true },
  { id: '02', title: 'Headings' },
  { id: '02c', title: 'Headings, H2 collapsed' },
  { id: '03', title: 'Lists' },
  { id: '04', title: 'Tables', landscape: true },
  { id: '05', title: 'Images' },
  { id: '06', title: 'Code blocks' },
  { id: '07', title: 'Mixed fonts and spacing' },
  { id: '08', title: 'Breaks and containers' },
  { id: '09', title: 'Columns' },
  { id: '10', title: 'Proposal' },
  { id: '11', title: 'Large, ~50,000 words', perfOnly: true },
];
