import { useEffect, useRef } from 'react';

export type ConversationTurn = { messageIndex: number; question: string };

export function ConversationTimeline({ turns, activeTurn, onJump }: { turns: ConversationTurn[]; activeTurn: number; onJump: (index: number) => void }) {
  const timelineRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const timeline = timelineRef.current;
    const active = timeline?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!timeline || !active) return;
    if (active.offsetTop < timeline.scrollTop) timeline.scrollTop = active.offsetTop;
    else if (active.offsetTop + active.offsetHeight > timeline.scrollTop + timeline.clientHeight) {
      timeline.scrollTop = active.offsetTop + active.offsetHeight - timeline.clientHeight;
    }
  }, [activeTurn, turns.length]);
  if (turns.length === 0) return null;
  return (
    <nav className="conversation-timeline" aria-label="对话导航" ref={timelineRef}>
      {turns.map((turn, index) => (
        <button
          key={turn.messageIndex}
          type="button"
          className={`conversation-tick ${index === activeTurn ? 'is-active' : ''}`}
          aria-label={`跳转到第 ${index + 1} 轮对话：${turn.question.slice(0, 60)}`}
          aria-current={index === activeTurn ? 'location' : undefined}
          title={turn.question.slice(0, 80)}
          onClick={() => onJump(index)}
        ><span aria-hidden="true" /></button>
      ))}
    </nav>
  );
}
