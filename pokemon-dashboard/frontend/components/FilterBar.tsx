interface FilterBarProps {
  minDiscount: number;
  platform: string;
  seenFilter: string;
  onMinDiscountChange: (v: number) => void;
  onPlatformChange: (v: string) => void;
  onSeenFilterChange: (v: string) => void;
}

export default function FilterBar({
  minDiscount, platform, seenFilter,
  onMinDiscountChange, onPlatformChange, onSeenFilterChange,
}: FilterBarProps) {
  return (
    <div className="filter-bar">
      <label>
        Min discount:
        <input
          type="number"
          value={minDiscount}
          onChange={(e) => onMinDiscountChange(Number(e.target.value))}
          min={0}
          max={100}
        />
        <span>%</span>
      </label>
      <label>
        Platform:
        <select value={platform} onChange={(e) => onPlatformChange(e.target.value)}>
          <option value="all">All</option>
          <option value="phygitals">Phygitals</option>
        </select>
      </label>
      <label>
        Show:
        <select value={seenFilter} onChange={(e) => onSeenFilterChange(e.target.value)}>
          <option value="all">All</option>
          <option value="unseen">Unseen</option>
          <option value="seen">Seen</option>
        </select>
      </label>
    </div>
  );
}
