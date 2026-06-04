import { useToastStore } from '../stores/toastStore';

const CFG = {
  success: { bg:'#f0fdf4', border:'#22c55e', text:'#15803d', icon:'✓' },
  error:   { bg:'#fef2f2', border:'#ef4444', text:'#dc2626', icon:'✕' },
  warning: { bg:'#fffbeb', border:'#f59e0b', text:'#92400e', icon:'⚠' },
  info:    { bg:'#eff6ff', border:'#3b82f6', text:'#1e40af', icon:'ℹ' },
};

export default function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  return (
    <div style={{
      position:'fixed', top:16, right:16, zIndex:99999,
      display:'flex', flexDirection:'column', gap:8,
      maxWidth:360, pointerEvents:'none',
    }}>
      {toasts.map(t => {
        const c = CFG[t.type] || CFG.info;
        return (
          <div key={t.id} style={{
            display:'flex', alignItems:'flex-start', gap:10,
            padding:'12px 16px',
            background:c.bg,
            border:`1px solid ${c.border}`,
            borderLeft:`4px solid ${c.border}`,
            borderRadius:8,
            boxShadow:'0 4px 16px rgba(0,0,0,0.14)',
            pointerEvents:'all',
            animation:'toastIn 0.2s ease-out',
          }}>
            <span style={{ color:c.border, fontWeight:700, fontSize:14 }}>{c.icon}</span>
            <span style={{ flex:1, fontSize:13, color:c.text, lineHeight:1.5 }}>
              {t.message}
            </span>
            <button
              onClick={() => removeToast(t.id)}
              style={{ background:'none', border:'none', cursor:'pointer',
                       color:c.text, fontSize:14, opacity:0.6, padding:2 }}
            >✕</button>
          </div>
        );
      })}
    </div>
  );
}
