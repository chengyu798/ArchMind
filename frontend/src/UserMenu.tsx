import { useEffect, useId, useRef, useState } from 'react';
import type { User } from './types';
import './UserMenu.css';

type Destination = 'profile' | 'settings' | 'memories' | 'reports' | 'files';
const sections: { id: Destination; label: string; path: string }[] = [
  { id: 'profile', label: '用户主页信息', path: 'M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0' },
  { id: 'settings', label: '系统设置', path: 'M4 7h16M4 17h16M9 4v6M15 14v6' },
  { id: 'memories', label: '长期记忆', path: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15' },
  { id: 'reports', label: '报告生成', path: 'M14 3H5v18h14V8Zm0 0v5h5M8 16v2m4-5v5m4-7v7' },
  { id: 'files', label: '文档管理', path: 'M3 7h7l2 2h9v12H3ZM3 12h18' },
];

export function UserMenu({ user, activeTab, onNavigate, onLogout, compact = false }: { user: User; activeTab: string; onNavigate: (destination: Destination) => void; onLogout: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="user-menu" ref={container} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} className="user-menu-trigger" type="button" aria-label="打开用户菜单" aria-haspopup="menu" aria-controls={id} aria-expanded={open} onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>
      <span className="sidebar-avatar">{(user.nickname || user.username).charAt(0).toUpperCase()}</span>
      {!compact && <><span className="user-menu-identity"><span className="sidebar-user-name">{user.nickname || user.username}</span><span className="sidebar-user-role">{user.is_admin ? '管理员' : '普通用户'}</span></span>
      <svg className={open ? 'is-open' : ''} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg></>}
    </button>
    {open && <div id={id} ref={menu} className="user-menu-popup" role="menu" aria-label="用户功能" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>
      <div className="user-menu-heading">{user.username}</div>
      {sections.map((section) => <button key={section.id} type="button" role="menuitem" className={activeTab === section.id ? 'is-active' : ''} aria-current={activeTab === section.id ? 'page' : undefined} onClick={() => { close(); onNavigate(section.id); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={section.path} /></svg><span>{section.label}</span>
      </button>)}
      <div className="user-menu-divider" role="separator" />
      <button type="button" role="menuitem" className="user-menu-logout" onClick={() => { close(); onLogout(); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M9 4H4v16h5m5-13 5 5-5 5M8 12h11" /></svg><span>退出登录</span></button>
    </div>}
  </div>;
}

export function UserProfile({ user }: { user: User }) {
  const created = new Date(user.created_at);
  return <section className="user-profile-page">
    <header><h1>用户主页信息</h1></header>
    <div className="user-profile-card"><div className="user-profile-identity"><span className="sidebar-avatar">{(user.nickname || user.username).charAt(0).toUpperCase()}</span><div><h2>{user.nickname || user.username}</h2><p>{user.is_admin ? '管理员' : '普通用户'}</p></div></div>
      <dl>{[['账号', user.username], ['昵称', user.nickname || '未设置'], ['邮箱', user.email || '未设置'], ['注册时间', Number.isNaN(created.getTime()) ? '暂无记录' : created.toLocaleString('zh-CN')]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
  </section>;
}
