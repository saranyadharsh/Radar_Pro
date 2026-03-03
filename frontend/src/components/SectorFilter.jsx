/**
 * SectorFilter.jsx
 * Drop this anywhere — used inside Sidebar when source === 'Stock List'
 * 
 * Props:
 *   sector    : string  — current selected sector ('all' or sector name)
 *   onSector  : fn      — setter
 *   darkMode  : bool
 */

const SECTORS = [
  'all',
  'Technology',
  'Consumer Discretionary',
  'Consumer Staples',
  'Financials',
  'Healthcare',
  'Industrials',
  'Energy',
  'Utilities',
  'Materials',
  'Real Estate',
  'Communication Services',
]

export default function SectorFilter({ sector, onSector, darkMode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <label style={{
        display: 'block',
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        color: '#4a6080',
        marginBottom: 5,
      }}>
        Sector
      </label>
      <select
        value={sector}
        onChange={e => onSector(e.target.value)}
        style={{
          width: '100%',
          padding: '5px 8px',
          borderRadius: 6,
          background: '#0c1828',
          border: `1px solid ${sector !== 'all' ? 'rgba(34,211,238,0.4)' : 'rgba(255,255,255,0.11)'}`,
          color: sector !== 'all' ? '#22d3ee' : '#f1f5f9',
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
          outline: 'none',
          cursor: 'pointer',
          transition: 'border-color 0.15s',
        }}
      >
        {SECTORS.map(s => (
          <option key={s} value={s}>
            {s === 'all' ? 'All Sectors' : s}
          </option>
        ))}
      </select>

      {/* Active sector badge */}
      {sector !== 'all' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 5,
          padding: '3px 7px',
          borderRadius: 5,
          background: 'rgba(34,211,238,0.08)',
          border: '1px solid rgba(34,211,238,0.2)',
        }}>
          <span style={{ fontSize: 8, color: '#22d3ee', letterSpacing: '.06em' }}>
            🔵 {sector}
          </span>
          <button
            onClick={() => onSector('all')}
            style={{
              background: 'none',
              border: 'none',
              color: '#4a6080',
              fontSize: 11,
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
            title="Clear sector filter"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
