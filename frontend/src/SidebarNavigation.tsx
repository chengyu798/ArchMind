type Destination = 'files' | 'reports' | 'memories' | 'settings';

const sections: { id: Destination; label: string; icon: React.ReactNode }[] = [
  { id: 'files', label: '文件管理', icon: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z" /><path d="M3 11h18" /></> },
  { id: 'reports', label: '报告中心', icon: <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 16v2m4-5v5m4-7v7" /></> },
  { id: 'memories', label: '长期记忆', icon: <><path d="M12 5c-2.5-2-6-2-9-1v15c3-1 6.5-1 9 1 2.5-2 6-2 9-1V4c-3-1-6.5-1-9 1Zm0 0v15" /></> },
  { id: 'settings', label: '系统设置', icon: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" fill="var(--bg-card)" /><circle cx="15" cy="17" r="3" fill="var(--bg-card)" /></> },
];

export function SidebarNavigation({ activeTab, onNavigate }: { activeTab: string; onNavigate: (destination: Destination) => void }) {
  return (
    <nav className="sidebar-nav" aria-label="功能模块">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          className={`sidebar-link ${activeTab === section.id ? 'active' : ''}`}
          aria-current={activeTab === section.id ? 'page' : undefined}
          onClick={() => onNavigate(section.id)}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{section.icon}</svg>
          <span>{section.label}</span>
        </button>
      ))}
    </nav>
  );
}
