export default function Test() {
  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>✅ React is Working!</h1>
      <p>If you see this, React is rendering correctly.</p>
      <p>Backend URL: {import.meta.env.VITE_API_BASE}</p>
      <p>WebSocket URL: {import.meta.env.VITE_WS_URL}</p>
    </div>
  );
}
