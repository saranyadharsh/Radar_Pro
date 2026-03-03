/**
 * SectorFilter.jsx — NexRadar Pro v4.3
 * Updated sector list: TECHNOLOGY, CONSUMER, BANKING, BIO, BM & UENE, REALCOM, INDUSTRIALS
 */

const SECTORS = [
  'all',
  'TECHNOLOGY',
  'CONSUMER',
  'BANKING',
  'BIO',
  'BM & UENE',
  'REALCOM',
  'INDUSTRIALS',
]

const SECTOR_LABELS = {
  'all':         'All Sectors',
  'TECHNOLOGY':  '💻 Technology',
  'CONSUMER':    '🛍 Consumer',
  'BANKING':     '🏦 Banking',
  'BIO':         '🧬 Bio / Healthcare',
  'BM & UENE':   '⚡ BM & Energy',
  'REALCOM':     '🏢 Real Estate / Comm',
  'INDUSTRIALS': '🏭 Industrials',
}

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
        Sector / Industry
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
            {SECTOR_LABELS[s] || s}
          </option>
        ))}
      </select>

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
            🔵 {SECTOR_LABELS[sector] || sector}
          </span>
          <button
            onClick={() => onSector('all')}
            style={{
              background: 'none', border: 'none', color: '#4a6080',
              fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: 0,
            }}
            title="Clear sector filter"
          >×</button>
        </div>
      )}
    </div>
  )
}
