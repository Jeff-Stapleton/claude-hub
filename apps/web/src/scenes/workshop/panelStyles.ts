/** Shared foreignObject-panel styles, cloned from the workshop's add-project panel. */

export const panel: React.CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  padding: 14,
  border: '1px solid #4a3624',
  borderRadius: 10,
  background: 'rgba(24, 16, 10, 0.92)',
  color: '#ead6b8',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  boxShadow: '0 8px 22px rgba(0, 0, 0, 0.35)',
  overflow: 'auto',
};

export const panelTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#f0d8b8',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

export const panelInput: React.CSSProperties = {
  minWidth: 0,
  padding: '7px 9px',
  borderRadius: 5,
  border: '1px solid #5a3a22',
  background: '#100b08',
  color: '#eee',
  fontSize: 12,
  fontFamily: 'inherit',
};

export const panelTextarea: React.CSSProperties = {
  ...panelInput,
  resize: 'vertical',
  minHeight: 54,
  fontFamily: 'monospace',
};

export const panelButton: React.CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 12px',
  borderRadius: 5,
  border: '1px solid #6a4a2a',
  background: '#4a3020',
  color: '#f0d8b8',
  cursor: 'pointer',
  fontSize: 12,
};

export const panelDangerButton: React.CSSProperties = {
  ...panelButton,
  border: '1px solid #6a2a2a',
  background: '#4a2020',
  color: '#f2c0b8',
};

export const panelLabel: React.CSSProperties = {
  fontSize: 11,
  color: '#c8a888',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

export const panelRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
};

export const panelError: React.CSSProperties = {
  color: '#ff9a8a',
  fontSize: 11,
  whiteSpace: 'pre-wrap',
};

export const panelHint: React.CSSProperties = {
  fontSize: 10,
  color: '#8a7458',
};

export const panelMono: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 11,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#100b08',
  border: '1px solid #2a1f17',
  borderRadius: 5,
  padding: 8,
  maxHeight: 140,
  overflow: 'auto',
};
