import { triggerScan, ScanStatus as ScanStatusType } from "../lib/api";
import { useState } from "react";

interface Props {
  status: ScanStatusType | null;
  onScanComplete: () => void;
}

export default function ScanStatus({ status, onScanComplete }: Props) {
  const [triggering, setTriggering] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerScan();
      onScanComplete();
    } finally {
      setTriggering(false);
    }
  };

  const isRunning = status?.running || triggering;

  return (
    <div className="scan-status">
      <div className="scan-info">
        <span className={`scan-dot ${isRunning ? "running" : "idle"}`} />
        <span>{isRunning ? "Scan en cours..." : "Scanner idle"}</span>
        {status?.last_run && (
          <span className="scan-last">
            Dernier: {new Date(status.last_run).toLocaleTimeString("fr-FR")}
          </span>
        )}
      </div>
      <button
        className="btn-scan"
        onClick={handleTrigger}
        disabled={isRunning}
      >
        {isRunning ? "Scanning..." : "Lancer scan"}
      </button>
    </div>
  );
}
