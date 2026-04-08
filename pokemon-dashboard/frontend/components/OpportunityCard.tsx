import { Opportunity, markSeen } from "../lib/api";

interface Props {
  opp: Opportunity;
  onMarkSeen: (id: number) => void;
}

function confidenceBadge(c: string) {
  const colors: Record<string, string> = {
    HAUTE: "#3fb950",
    MOYENNE: "#d29922",
    FAIBLE: "#f85149",
  };
  return (
    <span className="badge" style={{ background: colors[c] || "#484f58" }}>
      {c}
    </span>
  );
}

export default function OpportunityCard({ opp, onMarkSeen }: Props) {
  const handleSeen = async () => {
    await markSeen(opp.id);
    onMarkSeen(opp.id);
  };

  return (
    <div className={`opp-card ${opp.seen ? "seen" : ""}`}>
      <div className="opp-header">
        <span className="opp-name">{opp.card_name}</span>
        {confidenceBadge(opp.confidence)}
      </div>
      <div className="opp-prices">
        <div>
          <span className="label">Listing:</span>
          <span className="price listing">${opp.listing_usd.toFixed(2)}</span>
        </div>
        <div>
          <span className="label">Argus:</span>
          <span className="price argus">${opp.argus_usd.toFixed(2)}</span>
        </div>
      </div>
      <div className="opp-discount">
        <div className="discount-bar">
          <div
            className="discount-fill"
            style={{ width: `${Math.min(opp.discount_pct, 100)}%` }}
          />
        </div>
        <span className="discount-text">-{opp.discount_pct.toFixed(1)}%</span>
      </div>
      <div className="opp-actions">
        <a href={opp.url} target="_blank" rel="noopener noreferrer" className="btn-link">
          Voir listing
        </a>
        {!opp.seen && (
          <button onClick={handleSeen} className="btn-seen">Mark seen</button>
        )}
      </div>
    </div>
  );
}
