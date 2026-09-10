export function Trail({ count, current }: { count: number; current: number }) {
  return (
    <div className="trail" role="progressbar" aria-valuemin={1} aria-valuemax={count} aria-valuenow={current + 1}>
      {Array.from({ length: count }, (_, i) => {
        const complete = i < current;
        return (
          <span className="trail-step" key={i}>
            <span className={`trail-node ${complete ? 'complete' : ''} ${i === current ? 'current' : ''}`} />
            {i < count - 1 && <span className={`trail-line ${complete ? 'complete' : ''}`} />}
          </span>
        );
      })}
    </div>
  );
}
