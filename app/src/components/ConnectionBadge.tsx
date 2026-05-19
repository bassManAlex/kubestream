import type { ConnectionStatus } from "../types";
import { ConnectionStatus as CS } from "../types";

interface Props {
  status: ConnectionStatus;
}

const config: Record<ConnectionStatus, { label: string; className: string }> = {
  [CS.Connecting]: {
    label: "Connecting",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  },
  [CS.Connected]: {
    label: "Connected",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
  },
  [CS.Disconnected]: {
    label: "Disconnected",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
  },
  [CS.Reconnecting]: {
    label: "Reconnecting",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  },
};

export function ConnectionBadge({ status }: Props) {
  const { label, className } = config[status];

  return (
    <span className={`text-xs font-mono px-2 py-1 rounded border ${className}`}>
      {label}
    </span>
  );
}
